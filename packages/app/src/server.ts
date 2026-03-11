/**
 * HTTP Server — Express API for the Conway Automaton dashboard.
 *
 * Endpoints:
 *   GET  /api/status    — Agent status report
 *   GET  /api/logs      — Turn history (query: ?sessionId=X&limit=N)
 *   POST /api/fund      — Add credits (body: { amountCents })
 *   POST /api/chat      — Send message (SSE streaming response)
 *   GET  /api/children  — Child agent list
 *   GET  /api/soul      — Constitution + traits
 *   GET  /api/health    — Simple health check
 *
 * Static files served from ../dashboard/dist
 */
import express from 'express';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Cents } from '@conshell/core';
import type { UpsertModel } from '@conshell/state';
import type { RunningAgent } from './kernel.js';
import { WsManager } from './ws.js';
import { discoverModels, testProviderConnection } from './services/model-discovery.js';
import { autoGenerateRouting, getRoutingDimensions, getModelClassification } from '@conshell/inference';
import {
    createAuthMiddleware,
    generateToken,
    createRateLimitMiddleware,
    type AuthConfig,
} from '@conshell/security';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Create Server ───────────────────────────────────────────────────────

export interface ServerHandle {
    readonly httpServer: ReturnType<typeof createServer>;
    readonly wsManager: WsManager;
    close(): Promise<void>;
}

export function createAppServer(agent: RunningAgent): ServerHandle {
    const app = express();
    const httpServer = createServer(app);

    // ── Security Config ─────────────────────────────────────────────────
    const authSecret = agent.config.authMode === 'token'
        ? (agent.config.authSecret || generateToken())
        : agent.config.authSecret;

    const authConfig: AuthConfig = {
        mode: agent.config.authMode,
        secret: authSecret,
        skipPaths: ['/health', '/api/health', '/.well-known/mcp'],
    };

    // Log auth token at startup (only for token mode)
    if (agent.config.authMode === 'token' && authSecret) {
        agent.logger.info('🔐 Auth token generated (use Bearer header)', { token: authSecret });
    }

    // WebSocket — with auth config for connection verification
    const wsManager = new WsManager(agent.logger, authConfig);
    wsManager.attach(httpServer);

    // Middleware
    app.use(express.json());

    // CORS for local dashboard dev
    app.use((_req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (_req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        next();
    });

    // Rate limiting (before auth to block brute-force attempts)
    app.use(createRateLimitMiddleware() as any);

    // Authentication middleware
    app.use(createAuthMiddleware(authConfig) as any);

    // ── API Routes ──────────────────────────────────────────────────────

    // Health check
    app.get('/api/health', (_req, res) => {
        res.json({
            status: 'ok',
            agent: agent.config.agentName,
            state: agent.getState(),
            uptime: process.uptime(),
            authRequired: agent.config.authMode !== 'none',
        });
    });

    // Agent status
    app.get('/api/status', (_req, res) => {
        try {
            const status = agent.cliAdmin.status();
            res.json(status);
        } catch (err) {
            agent.logger.error('Status endpoint failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to get status' });
        }
    });

    // Logs
    app.get('/api/logs', (req, res) => {
        try {
            const sessionId = req.query['sessionId'] as string | undefined;
            const limit = req.query['limit']
                ? parseInt(req.query['limit'] as string, 10)
                : undefined;

            const logs = agent.cliAdmin.logs({ sessionId, limit });
            res.json({ turns: logs, count: logs.length });
        } catch (err) {
            agent.logger.error('Logs endpoint failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to get logs' });
        }
    });

    // Fund
    app.post('/api/fund', (req, res) => {
        try {
            const { amountCents } = req.body as { amountCents?: number };

            if (!amountCents || typeof amountCents !== 'number') {
                res.status(400).json({ error: 'amountCents (number) required' });
                return;
            }

            const result = agent.cliAdmin.fund(amountCents as Cents);

            if (result.success) {
                // Broadcast balance change
                wsManager.broadcast('balance_change', {
                    amountCents,
                    transactionId: result.transactionId,
                });
            }

            res.json(result);
        } catch (err) {
            agent.logger.error('Fund endpoint failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to process funding' });
        }
    });

    // ── Abort controllers for stop-generation ───────────────────────────
    const activeAbortControllers = new Map<string, AbortController>();

    // Chat (SSE streaming)
    app.post('/api/chat', async (req, res) => {
        // Ollama first inference can take 60+ seconds for model loading
        req.setTimeout(300_000); // 5 minutes
        res.setTimeout(300_000);
        try {
            const { message, sessionId } = req.body as {
                message?: string;
                sessionId?: string;
            };

            if (!message) {
                res.status(400).json({ error: 'message (string) required' });
                return;
            }

            // Set up SSE
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });

            const sid = sessionId || `session-${Date.now()}`;

            // Create abort controller for this session
            const abortController = new AbortController();
            activeAbortControllers.set(sid, abortController);

            // Wire response close to abort (when client disconnects)
            (res as unknown as NodeJS.EventEmitter).on('close', () => {
                abortController.abort();
                activeAbortControllers.delete(sid);
            });

            // Process through agent loop
            try {
                const turn = await agent.agentLoop.executeTurn({
                    role: 'user' as const,
                    content: message,
                    sessionId: sid,
                    signal: abortController.signal,
                });

                // Stream result
                res.write(`data: ${JSON.stringify({ type: 'turn', data: turn })}\n\n`);

                // Broadcast to WebSocket clients
                wsManager.broadcast('new_turn', { sessionId: sid, turn });

            } catch (loopErr) {
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    data: { error: loopErr instanceof Error ? loopErr.message : String(loopErr) },
                })}\n\n`);
            }

            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
            activeAbortControllers.delete(sid);
        } catch (err) {
            agent.logger.error('Chat endpoint failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            if (!res.headersSent) {
                res.status(500).json({ error: 'Chat failed' });
            }
        }
    });

    // ── Chat History Endpoints ───────────────────────────────────────────

    // List all chat sessions
    app.get('/api/chat/sessions', (_req, res) => {
        try {
            const sessions = agent.repos.turns.listSessions();
            res.json({ sessions });
        } catch (err) {
            agent.logger.error('Failed to list sessions', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to list sessions' });
        }
    });

    // Get full history for a session
    app.get('/api/chat/sessions/:id', (req, res) => {
        try {
            const sessionId = req.params.id;
            const turns = agent.repos.turns.findBySession(sessionId);
            const messages = turns.map(t => ({
                role: t.role,
                content: t.content || t.thinking || '',
                timestamp: t.created_at,
                model: t.model,
            }));
            res.json({ sessionId, messages, count: messages.length });
        } catch (err) {
            agent.logger.error('Failed to get session history', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to get session history' });
        }
    });

    // Abort current generation
    app.post('/api/chat/abort', (req, res) => {
        try {
            const { sessionId } = req.body as { sessionId?: string };
            if (!sessionId) {
                res.status(400).json({ error: 'sessionId required' });
                return;
            }
            const controller = activeAbortControllers.get(sessionId);
            if (controller) {
                controller.abort();
                activeAbortControllers.delete(sessionId);
                res.json({ success: true, message: 'Generation aborted' });
            } else {
                res.json({ success: false, message: 'No active generation for this session' });
            }
        } catch (err) {
            agent.logger.error('Failed to abort generation', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to abort' });
        }
    });

    // Children — full list with lifecycle data
    app.get('/api/children', (_req, res) => {
        try {
            const allChildren = agent.repos.children.listAll();
            const aliveCount = agent.repos.children.countAlive();
            res.json({
                children: allChildren.map(c => ({
                    id: c.id,
                    state: c.state,
                    sandbox_id: c.sandbox_id,
                    funded_cents: c.funded_cents,
                    spawned_at: c.created_at,
                    died_at: c.state === 'dead' ? c.updated_at : null,
                })),
                aliveCount,
                totalCount: allChildren.length,
            });
        } catch (err) {
            res.status(500).json({ error: 'Failed to get children' });
        }
    });

    // Soul / Constitution
    app.get('/api/soul', (_req, res) => {
        try {
            const doc = agent.soul.view();
            res.json(doc);
        } catch (err) {
            res.status(500).json({ error: 'Failed to get soul' });
        }
    });

    // ── MCP Gateway (JSON-RPC 2.0) ────────────────────────────────────────

    app.post('/api/mcp', async (req, res) => {
        try {
            const jsonRpcRequest = req.body;

            // Validate basic JSON-RPC structure
            if (!jsonRpcRequest?.jsonrpc || !jsonRpcRequest?.method) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    id: jsonRpcRequest?.id ?? null,
                    error: { code: -32600, message: 'Invalid JSON-RPC request' },
                });
                return;
            }

            // x402 payment gating for tools/call on paid tools
            if (jsonRpcRequest.method === 'tools/call' && jsonRpcRequest.params?.name) {
                const toolPath = `/api/mcp/tool/${jsonRpcRequest.params.name}`;
                const paymentResult = await agent.x402Server.evaluatePayment({
                    method: 'POST',
                    url: toolPath,
                    headers: {
                        'x-payment': (req.headers['x-payment'] as string) ?? '',
                        'x-payment-signature': (req.headers['x-payment-signature'] as string) ?? '',
                    },
                });

                if ('response' in paymentResult && paymentResult.gated) {
                    // 402 Payment Required or payment verification failed
                    const paymentResponse = paymentResult.response;
                    res.status(paymentResponse.status);
                    for (const [key, value] of Object.entries(paymentResponse.headers)) {
                        res.setHeader(key, String(value));
                    }
                    res.send(paymentResponse.body);
                    return;
                }
                // If gated + verified, or not gated, proceed with tool execution
            }

            const response = await agent.mcpGateway.handleRequest(jsonRpcRequest);
            res.json(response);
        } catch (err) {
            agent.logger.error('MCP endpoint failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32603, message: 'Internal server error' },
            });
        }
    });

    // MCP SSE transport — streaming connection for MCP clients
    app.get('/api/mcp/sse', (_req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable nginx buffering
        });

        // Send initial connection event
        res.write(`data: ${JSON.stringify({ type: 'connected', server: agent.config.agentName, version: '0.1.0' })}\n\n`);

        // 30s keepalive to prevent proxy/firewall timeouts
        const keepAlive = setInterval(() => {
            res.write(': keepalive\n\n');
        }, 30_000);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- res extends EventEmitter in Node
        (res as any).on('close', () => {
            clearInterval(keepAlive);
        });
    });

    // MCP discovery
    app.get('/.well-known/mcp', (_req, res) => {
        res.json({
            name: agent.config.agentName,
            version: '0.1.0',
            description: 'Conway Automaton — Sovereign AI Agent',
            endpoints: {
                rpc: '/api/mcp',
                sse: '/api/mcp/sse',
            },
        });
    });

    // ── Dashboard API Endpoints ─────────────────────────────────────────

    // Memory stats
    app.get('/api/memory/stats', (_req, res) => {
        try {
            const stats = agent.memoryManager.stats('default');
            res.json({ tiers: stats });
        } catch (err) {
            res.status(500).json({ error: 'Failed to get memory stats' });
        }
    });

    // Provider status — merge static config + DB-managed providers
    app.get('/api/providers', (_req, res) => {
        try {
            // Static providers from kernel config
            const staticProviders = agent.config.providers.map((p: { name: string; available: boolean; authType?: string; endpoint?: string }) => ({
                name: p.name,
                available: p.available,
                authType: p.authType ?? 'unknown',
                endpoint: p.endpoint ?? '',
                source: 'config' as const,
            }));

            // DB-managed providers from Settings UI
            const dbProviders = agent.repos.providerConfig.listAll().map(p => ({
                name: p.name,
                available: p.enabled === 1,
                authType: p.auth_type,
                endpoint: p.endpoint ?? '',
                source: 'settings' as const,
            }));

            // Merge: DB providers override static ones with same name
            const nameSet = new Set(dbProviders.map(p => p.name));
            const merged = [
                ...dbProviders,
                ...staticProviders.filter(p => !nameSet.has(p.name)),
            ];

            res.json({ providers: merged });
        } catch (err) {
            res.status(500).json({ error: 'Failed to get providers' });
        }
    });

    // Heartbeat status
    app.get('/api/heartbeat', (_req, res) => {
        try {
            res.json({
                running: true, // HeartbeatDaemon is started in kernel
                recentBeats: agent.repos.heartbeat.listEnabled(),
            });
        } catch (err) {
            res.status(500).json({ error: 'Failed to get heartbeat status' });
        }
    });

    // ── Capabilities API ────────────────────────────────────────────────

    app.get('/api/settings/capabilities', (_req, res) => {
        try {
            const config = agent.capabilityConfig.get();
            res.json(config);
        } catch (err) {
            res.status(500).json({ error: 'Failed to get capabilities' });
        }
    });

    app.put('/api/settings/capabilities', (req, res) => {
        try {
            const body = req.body as Record<string, unknown>;
            const current = agent.capabilityConfig.get();
            const updated = {
                godMode: typeof body['godMode'] === 'boolean' ? body['godMode'] : current.godMode,
                capabilities: {
                    ...current.capabilities,
                    ...(typeof body['capabilities'] === 'object' && body['capabilities'] !== null
                        ? body['capabilities'] as Record<string, boolean>
                        : {}),
                },
            };
            agent.capabilityConfig.set(updated as any);
            wsManager.broadcast('capabilities_changed', updated);
            res.json(updated);
        } catch (err) {
            res.status(500).json({ error: 'Failed to update capabilities' });
        }
    });

    // ── Skills API ──────────────────────────────────────────────────────

    app.get('/api/skills', (_req, res) => {
        try {
            const skills = agent.skillRegistry.listManifests();
            res.json({ skills, total: skills.length });
        } catch (err) {
            res.status(500).json({ error: 'Failed to list skills' });
        }
    });

    app.put('/api/skills/:name', (req, res) => {
        try {
            const { name } = req.params;
            const { enabled } = req.body as { enabled: boolean };
            const success = agent.skillRegistry.setEnabled(name, enabled);
            if (!success) {
                res.status(404).json({ error: `Skill "${name}" not found` });
                return;
            }
            wsManager.broadcast('skill_changed', { name, enabled });
            res.json({ name, enabled, success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to update skill' });
        }
    });

    app.post('/api/skills/install', async (req, res) => {
        try {
            const { sourcePath, name: skillName } = req.body as { sourcePath: string; name?: string };
            if (!sourcePath) {
                res.status(400).json({ error: 'sourcePath is required' });
                return;
            }
            const fs = await import('node:fs/promises');
            const path = await import('node:path');

            // Determine skill name from path or explicit name
            const resolvedName = skillName ?? path.default.basename(sourcePath);
            const targetDir = path.default.join(agent.config.agentHome, 'skills', resolvedName);

            // Copy skill directory
            await fs.default.mkdir(targetDir, { recursive: true });
            const entries = await fs.default.readdir(sourcePath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile()) {
                    await fs.default.copyFile(
                        path.default.join(sourcePath, entry.name),
                        path.default.join(targetDir, entry.name),
                    );
                }
            }

            // Reload skills
            const { loadAllSkills } = await import('@conshell/skills');
            const skillsDir = path.default.join(agent.config.agentHome, 'skills');
            const skills = await loadAllSkills({ skillsDir, logger: agent.logger });
            agent.skillRegistry.registerAll(skills);

            wsManager.broadcast('skill_changed', { name: resolvedName, installed: true });
            res.json({ name: resolvedName, installed: true, targetDir });
        } catch (err) {
            agent.logger.warn('Skill install failed', { error: err instanceof Error ? err.message : String(err) });
            res.status(500).json({ error: `Failed to install skill: ${err instanceof Error ? err.message : 'unknown error'}` });
        }
    });

    // ── Settings API ────────────────────────────────────────────────────

    // --- Providers ---

    app.get('/api/settings/providers', (_req, res) => {
        try {
            const providers = agent.repos.providerConfig.listAll();
            res.json({ providers });
        } catch (err) {
            res.status(500).json({ error: 'Failed to list providers' });
        }
    });

    app.post('/api/settings/providers', async (req, res) => {
        try {
            const { name, authType, endpoint, apiKey, enabled, priority } = req.body as {
                name?: string; authType?: string; endpoint?: string;
                apiKey?: string; enabled?: boolean; priority?: number;
            };
            if (!name || !authType) {
                res.status(400).json({ error: 'name and authType required' });
                return;
            }

            agent.repos.providerConfig.upsert({ name, authType, endpoint, apiKey, enabled, priority });

            // Determine internal provider name (must match adapter.name for routing)
            const internalName = authType === 'proxy' ? 'cliproxyapi' : name.toLowerCase();

            // Dynamically create and register adapter
            if (endpoint && (enabled !== false)) {
                try {
                    if (authType === 'proxy' || internalName === 'cliproxyapi') {
                        const { CliProxyApiAdapter } = await import('./adapters/cliproxyapi-adapter.js');
                        const timeoutMs = parseInt(process.env['CLIPROXYAPI_TIMEOUT_MS'] || '120000', 10);
                        agent.inferenceRouter.addAdapter(
                            new CliProxyApiAdapter(endpoint, apiKey ?? '', timeoutMs),
                        );
                        agent.logger.info('Dynamically registered CLIProxyAPI adapter', { endpoint });
                    }
                } catch (adapterErr) {
                    agent.logger.warn('Failed to create adapter', {
                        error: adapterErr instanceof Error ? adapterErr.message : String(adapterErr),
                    });
                }
            }

            // Auto-discover models
            let discovered: Array<{ id: string; name: string }> = [];
            if (endpoint) {
                const models = await discoverModels({
                    providerName: internalName,
                    providerType: authType === 'proxy' ? 'cliproxyapi' : name,
                    endpoint,
                    apiKey,
                }, agent.logger);

                const upserts: UpsertModel[] = models.map(m => ({
                    id: m.id,
                    provider: internalName,
                    name: m.name,
                    inputCostMicro: 0,
                    outputCostMicro: 0,
                    maxTokens: 128_000,
                    capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
                    available: true,
                }));
                if (upserts.length > 0) {
                    agent.repos.modelRegistry.upsertMany(upserts);

                    // Auto-generate routing from all available models
                    const allAvailable = agent.repos.modelRegistry.listAvailable();
                    const entries = autoGenerateRouting(allAvailable);
                    agent.repos.routingConfig.replaceAll(entries);
                    agent.inferenceRouter.reloadConfig();
                    agent.logger.info('Auto-generated routing', {
                        models: upserts.length,
                        routingEntries: entries.length,
                    });
                }
                discovered = models.map(m => ({ id: `${internalName}:${m.externalId}`, name: m.name }));
            }

            wsManager.broadcast('config-updated', { type: 'provider', name });
            res.json({ ok: true, discovered });
        } catch (err) {
            agent.logger.error('Settings provider save failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to save provider' });
        }
    });

    app.put('/api/settings/providers/:name', (req, res) => {
        try {
            const { name } = req.params;
            const body = req.body as Record<string, unknown>;

            // If only toggling enabled state, use the lightweight toggle method
            if ('enabled' in body && Object.keys(body).filter(k => k !== 'enabled' && k !== 'authType').length === 0) {
                agent.repos.providerConfig.toggle(name, body['enabled'] as boolean);
                wsManager.broadcast('config-updated', { type: 'provider', name });
                res.json({ ok: true });
                return;
            }

            // Full update: merge with existing to avoid clobbering unset fields
            const existing = agent.repos.providerConfig.getByName(name);
            agent.repos.providerConfig.upsert({
                name,
                authType: (body['authType'] as string) ?? existing?.auth_type ?? 'apiKey',
                endpoint: (body['endpoint'] as string | undefined) ?? existing?.endpoint ?? undefined,
                apiKey: (body['apiKey'] as string | undefined) ?? existing?.api_key ?? undefined,
                enabled: body['enabled'] !== undefined ? (body['enabled'] as boolean) : existing?.enabled === 1,
                priority: (body['priority'] as number | undefined) ?? existing?.priority ?? 100,
            });
            wsManager.broadcast('config-updated', { type: 'provider', name });
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to update provider' });
        }
    });

    app.delete('/api/settings/providers/:name', (req, res) => {
        try {
            const { name } = req.params;
            const deleted = agent.repos.providerConfig.delete(name);
            if (deleted) {
                wsManager.broadcast('config-updated', { type: 'provider', name });
            }
            res.json({ ok: true, deleted });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete provider' });
        }
    });

    app.post('/api/settings/providers/:name/test', async (req, res) => {
        try {
            const { name } = req.params;
            const config = agent.repos.providerConfig.getByName(name);
            if (!config) {
                res.status(404).json({ error: 'Provider not found' });
                return;
            }
            const result = await testProviderConnection({
                providerName: name,
                providerType: config.auth_type === 'proxy' ? 'cliproxyapi' : name,
                endpoint: config.endpoint ?? '',
                apiKey: config.api_key ?? undefined,
            }, agent.logger);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: 'Test failed' });
        }
    });

    app.post('/api/settings/providers/:name/discover', async (req, res) => {
        try {
            const { name } = req.params;
            const config = agent.repos.providerConfig.getByName(name);
            if (!config) {
                res.status(404).json({ error: 'Provider not found' });
                return;
            }
            const models = await discoverModels({
                providerName: name,
                providerType: config.auth_type === 'proxy' ? 'cliproxyapi' : name,
                endpoint: config.endpoint ?? '',
                apiKey: config.api_key ?? undefined,
            }, agent.logger);

            const upserts: UpsertModel[] = models.map(m => ({
                id: m.id,
                provider: m.provider,
                name: m.name,
                inputCostMicro: 0,
                outputCostMicro: 0,
                maxTokens: 128_000,
                capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
                available: true,
            }));
            if (upserts.length > 0) {
                agent.repos.modelRegistry.upsertMany(upserts);
            }
            res.json({ discovered: models.map(m => ({ id: m.id, name: m.name })) });
        } catch (err) {
            res.status(500).json({ error: 'Discovery failed' });
        }
    });

    // --- Models ---

    app.get('/api/settings/models', (_req, res) => {
        try {
            const models = agent.repos.modelRegistry.listAll();
            const enriched = models.map(m => ({
                ...m,
                classification: getModelClassification(m),
            }));
            res.json({ models: enriched });
        } catch (err) {
            res.status(500).json({ error: 'Failed to list models' });
        }
    });

    app.put('/api/settings/models/:id', (req, res) => {
        try {
            const modelId = req.params['id'];
            const { available } = req.body as { available?: boolean };
            if (available === undefined) {
                res.status(400).json({ error: 'available (boolean) required' });
                return;
            }

            // Update model availability
            const existing = agent.repos.modelRegistry.getById(modelId);
            if (!existing) {
                res.status(404).json({ error: 'Model not found' });
                return;
            }

            agent.repos.modelRegistry.upsert({
                id: existing.id,
                provider: existing.provider,
                name: existing.name,
                inputCostMicro: existing.input_cost_micro,
                outputCostMicro: existing.output_cost_micro,
                maxTokens: existing.max_tokens,
                capabilities: existing.capabilities_json ? JSON.parse(existing.capabilities_json) : [],
                available,
            });

            // Auto-regenerate routing if enabled
            const autoGenerate = (req.query['autoGenerate'] !== 'false');
            if (autoGenerate) {
                const availableModels = agent.repos.modelRegistry.listAvailable();
                const entries = autoGenerateRouting(availableModels);
                agent.repos.routingConfig.replaceAll(entries);
            }

            // Hot-reload router
            agent.inferenceRouter.reloadConfig();
            wsManager.broadcast('config-updated', { type: 'model', id: modelId });
            res.json({ ok: true });
        } catch (err) {
            agent.logger.error('Settings model update failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to update model' });
        }
    });

    app.post('/api/settings/models/save-selection', (req, res) => {
        try {
            const { selectedIds } = req.body as { selectedIds?: string[] };
            if (!selectedIds || !Array.isArray(selectedIds)) {
                res.status(400).json({ error: 'selectedIds (string[]) required' });
                return;
            }

            // Update all models: selected = available, rest = unavailable
            const allModels = agent.repos.modelRegistry.listAll();
            const selectedSet = new Set(selectedIds);

            for (const model of allModels) {
                const shouldBeAvailable = selectedSet.has(model.id);
                if ((model.available === 1) !== shouldBeAvailable) {
                    agent.repos.modelRegistry.upsert({
                        id: model.id,
                        provider: model.provider,
                        name: model.name,
                        inputCostMicro: model.input_cost_micro,
                        outputCostMicro: model.output_cost_micro,
                        maxTokens: model.max_tokens,
                        capabilities: model.capabilities_json ? JSON.parse(model.capabilities_json) : [],
                        available: shouldBeAvailable,
                    });
                }
            }

            // Auto-generate routing from selection
            const availableModels = agent.repos.modelRegistry.listAvailable();
            const entries = autoGenerateRouting(availableModels);
            agent.repos.routingConfig.replaceAll(entries);

            // Hot-reload
            agent.inferenceRouter.reloadConfig();
            wsManager.broadcast('config-updated', { type: 'models-batch' });
            res.json({ ok: true, selectedCount: selectedIds.length, routingEntries: entries.length });
        } catch (err) {
            agent.logger.error('Settings model batch save failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to save model selection' });
        }
    });

    // --- Routing ---

    app.get('/api/settings/routing', (_req, res) => {
        try {
            const entries = agent.repos.routingConfig.listAll();
            const dimensions = getRoutingDimensions();
            res.json({ entries, dimensions });
        } catch (err) {
            res.status(500).json({ error: 'Failed to list routing' });
        }
    });

    app.put('/api/settings/routing', (req, res) => {
        try {
            const { entries } = req.body as {
                entries?: Array<{ tier: string; taskType: string; modelId: string; priority: number; isCustom?: boolean }>;
            };
            if (!entries || !Array.isArray(entries)) {
                res.status(400).json({ error: 'entries array required' });
                return;
            }
            agent.repos.routingConfig.replaceAll(entries);
            agent.inferenceRouter.reloadConfig();
            wsManager.broadcast('config-updated', { type: 'routing' });
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to update routing' });
        }
    });

    app.post('/api/settings/routing/reset', (_req, res) => {
        try {
            // Re-generate from current available models
            const availableModels = agent.repos.modelRegistry.listAvailable();
            const entries = autoGenerateRouting(availableModels);
            agent.repos.routingConfig.replaceAll(entries);
            agent.inferenceRouter.reloadConfig();
            wsManager.broadcast('config-updated', { type: 'routing-reset' });
            res.json({ ok: true, entries: entries.length });
        } catch (err) {
            res.status(500).json({ error: 'Failed to reset routing' });
        }
    });

    // ── WebSocket Real-Time Broadcasts ────────────────────────────────────

    // Periodic status broadcast (state_change detection + heartbeat sync)
    let lastBroadcastState = agent.getState();
    const statusInterval = setInterval(() => {
        const currentState = agent.getState();
        // Detect state transitions
        if (currentState !== lastBroadcastState) {
            wsManager.broadcast('state_change', {
                from: lastBroadcastState,
                to: currentState,
            });
            lastBroadcastState = currentState;
        }
        // Periodic status snapshot for connected clients
        if (wsManager.clientCount > 0) {
            try {
                const status = agent.cliAdmin.status();
                wsManager.broadcast('status_update', {
                    state: currentState,
                    tier: agent.getTier(),
                    balanceCents: status.financial.netBalanceCents,
                    uptime: process.uptime(),
                });
            } catch { /* ignore broadcast errors */ }
        }
    }, 3000);

    // Clean up interval on server close
    httpServer.on('close', () => clearInterval(statusInterval));

    // ── Static Files (Dashboard) ────────────────────────────────────────

    const dashboardPath = resolve(__dirname, '../../dashboard/dist');
    if (existsSync(dashboardPath)) {
        app.use(express.static(dashboardPath));
        // SPA fallback
        app.get('{*path}', (_req, res) => {
            res.sendFile(resolve(dashboardPath, 'index.html'));
        });
        agent.logger.info('Serving dashboard from', { path: dashboardPath });
    }

    // ── Handle ──────────────────────────────────────────────────────────

    return {
        httpServer,
        wsManager,
        async close() {
            wsManager.close();
            await new Promise<void>((resolve) => {
                httpServer.close(() => resolve());
            });
        },
    };
}
