/**
 * HTTP Server — Express application for the Conway Automaton.
 *
 * This thin orchestrator wires middleware and delegates to route modules:
 *   routes/api-status.ts   — health, status, heartbeat, memory
 *   routes/api-chat.ts     — chat SSE, sessions, abort
 *   routes/api-admin.ts    — fund, logs, children, soul, providers
 *   routes/api-settings.ts — providers CRUD, models, routing, capabilities, skills
 *   routes/api-proxy.ts    — OpenAI-compatible /v1/* endpoints
 *   routes/api-mcp.ts      — MCP JSON-RPC + SSE + discovery
 *
 * Static files served from ../dashboard/dist
 */
import express from 'express';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RunningAgent } from './kernel.js';
import { WsManager } from './ws.js';
import {
    createAuthMiddleware,
    generateToken,
    createRateLimitMiddleware,
    type AuthConfig,
} from '@conshell/security';
import {
    registerStatusRoutes,
    registerChatRoutes,
    registerAdminRoutes,
    registerSettingsRoutes,
    registerProxyRoutes,
    registerMcpRoutes,
    registerWebhookRoutes,
    registerCronRoutes,
    registerSkillsMarketplaceRoutes,
    registerOAuthRoutes,
    registerSocialRoutes,
    registerIdentityRoutes,
    registerBackupRoutes,
    registerPluginRoutes,
    registerSecurityRoutes,
    registerTaskRoutes,
} from './routes/index.js';
import { registerMediaRoutes } from './media.js';
import { registerFederationRoutes } from './federation.js';
import { registerVoiceRoutes } from './voice.js';
import { registerCanvasRoutes } from './canvas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ───────────────────────────────────────────────────────────────

export interface ServerHandle {
    readonly httpServer: ReturnType<typeof createServer>;
    readonly wsManager: WsManager;
    close(): Promise<void>;
}

// ── Create Server ───────────────────────────────────────────────────────

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

    if (agent.config.authMode === 'token' && authSecret) {
        agent.logger.info('🔐 Auth token generated (use Bearer header)', { token: authSecret });
    }

    // ── WebSocket ───────────────────────────────────────────────────────
    const wsManager = new WsManager(agent.logger, authConfig);
    wsManager.attach(httpServer);

    // ── Global Middleware ────────────────────────────────────────────────
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

    // ── Register Routes ─────────────────────────────────────────────────
    const ctx = { agent, wsManager };

    // Cast to `any` because the Express `Application` implements Router
    // methods at runtime but our custom d.ts Router type is a subset.
    const r = app as any;
    registerStatusRoutes(r, ctx);
    registerChatRoutes(r, ctx);
    registerAdminRoutes(r, ctx);
    registerMcpRoutes(r, ctx);
    registerProxyRoutes(r, ctx);
    registerSettingsRoutes(r, ctx);
    registerWebhookRoutes(r, ctx);
    registerCronRoutes(r, ctx);
    registerSkillsMarketplaceRoutes(r, ctx);
    registerMediaRoutes(r, ctx);
    registerFederationRoutes(r, ctx);
    registerVoiceRoutes(r, ctx);
    registerCanvasRoutes(r, ctx);
    registerOAuthRoutes(r, ctx);
    registerSocialRoutes(r, ctx);
    registerIdentityRoutes(r, ctx);
    registerBackupRoutes(r, ctx);
    registerPluginRoutes(r, ctx);
    registerSecurityRoutes(r, ctx);
    registerTaskRoutes(r, ctx);

    // ── Start Task Runner (async background goals) ───────────────────────
    if (agent.taskRunner) {
        // Inject WebSocket broadcast so task events push to connected clients
        (agent.taskRunner as unknown as { deps: { broadcast: (type: string, data: unknown) => void } }).deps.broadcast =
            (type: string, data: unknown) => wsManager.broadcast(type, data);
        agent.taskRunner.start();
    }

    // ── WebSocket Real-Time Broadcasts ──────────────────────────────────
    let lastBroadcastState = agent.getState();
    const statusInterval = setInterval(() => {
        const currentState = agent.getState();
        if (currentState !== lastBroadcastState) {
            wsManager.broadcast('state_change', {
                from: lastBroadcastState,
                to: currentState,
            });
            lastBroadcastState = currentState;
        }
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

    httpServer.on('close', () => {
        clearInterval(statusInterval);
        agent.taskRunner?.stop();
    });

    // ── Static Files (Dashboard) ────────────────────────────────────────
    const dashboardPath = resolve(__dirname, '../../dashboard/dist');
    if (existsSync(dashboardPath)) {
        app.use(express.static(dashboardPath));
        // SPA fallback
        app.get('{*path}', (_req, res) => {
            res.sendFile(resolve(dashboardPath, 'index.html'));
        });
        agent.logger.info('Serving dashboard from', { path: dashboardPath });
    } else {
        // Fallback when dashboard isn't built
        app.get('/', (_req, res) => {
            res.status(200).send(`<!DOCTYPE html>
<html><head><title>ConShell</title><meta charset="utf-8">
<style>body{font-family:system-ui;background:#0f0f23;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;padding:2rem;border:1px solid #333;border-radius:12px;max-width:500px}
h1{color:#00b894;margin-bottom:.5rem}code{background:#1a1a2e;padding:2px 8px;border-radius:4px;color:#74b9ff}
a{color:#6c5ce7}</style></head>
<body><div class="box">
<h1>🐢 ConShell API</h1>
<p>Server is running. Dashboard not built yet.</p>
<p>Build it: <code>pnpm build</code></p>
<p>API health: <a href="/health">/health</a></p>
</div></body></html>`);
        });
        agent.logger.warn('Dashboard not found at', { path: dashboardPath });
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
