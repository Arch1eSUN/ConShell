import type { UpsertModel } from '@conshell/state';
import { autoGenerateRouting, getRoutingDimensions, getModelClassification } from '@conshell/inference';
import { SECURITY_TIER_PRESETS, detectTier } from '@conshell/policy';
import type { SecurityTier } from '@conshell/core';
import { discoverModels, testProviderConnection } from '../services/model-discovery.js';
import type { Request, Response, RouteRegistrar } from './context.js';

export const registerSettingsRoutes: RouteRegistrar = (router, { agent, wsManager }) => {
    // ── Capabilities ────────────────────────────────────────────────────

    router.get('/api/settings/capabilities', (_req: Request, res: Response) => {
        try {
            const config = agent.capabilityConfig.get();
            const currentTier = detectTier(config);
            res.json({ ...config, currentTier });
        } catch (err) {
            res.status(500).json({ error: 'Failed to get capabilities' });
        }
    });

    router.put('/api/settings/capabilities', (req: Request, res: Response) => {
        try {
            const body = req.body as Record<string, unknown>;
            const current = agent.capabilityConfig.get();
            const previousTier = detectTier(current);

            let updated;
            // If a tier shorthand is provided, apply the full preset
            if (typeof body['tier'] === 'string' && body['tier'] in SECURITY_TIER_PRESETS) {
                updated = SECURITY_TIER_PRESETS[body['tier'] as SecurityTier];
            } else {
                updated = {
                    godMode: typeof body['godMode'] === 'boolean' ? body['godMode'] : current.godMode,
                    capabilities: {
                        ...current.capabilities,
                        ...(typeof body['capabilities'] === 'object' && body['capabilities'] !== null
                            ? body['capabilities'] as Record<string, boolean>
                            : {}),
                    },
                };
            }
            agent.capabilityConfig.set(updated as any);
            const newTier = detectTier(updated as any);

            // Audit log — records every tier/capability change
            if (previousTier !== newTier) {
                agent.logger.info('Security tier changed', {
                    source: 'api',
                    from: previousTier,
                    to: newTier,
                    timestamp: new Date().toISOString(),
                });
            } else {
                agent.logger.info('Capability config updated (same tier)', {
                    source: 'api',
                    tier: newTier,
                    timestamp: new Date().toISOString(),
                });
            }

            wsManager.broadcast('capabilities_changed', { ...updated, currentTier: newTier });
            res.json({ ...updated, currentTier: newTier });
        } catch (err) {
            res.status(500).json({ error: 'Failed to update capabilities' });
        }
    });

    // ── Skills ───────────────────────────────────────────────────────────

    router.get('/api/skills', (_req: Request, res: Response) => {
        try {
            const skills = agent.skillRegistry.listManifests();
            res.json({ skills, total: skills.length });
        } catch (err) {
            res.status(500).json({ error: 'Failed to list skills' });
        }
    });

    router.put('/api/skills/:name', (req: Request, res: Response) => {
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

    router.post('/api/skills/install', async (req: Request, res: Response) => {
        try {
            const { sourcePath, name: skillName } = req.body as { sourcePath: string; name?: string };
            if (!sourcePath) {
                res.status(400).json({ error: 'sourcePath is required' });
                return;
            }
            const fs = await import('node:fs/promises');
            const path = await import('node:path');

            const resolvedName = skillName ?? path.default.basename(sourcePath);
            const targetDir = path.default.join(agent.config.agentHome, 'skills', resolvedName);

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

    // ── Providers ────────────────────────────────────────────────────────

    router.get('/api/settings/providers', (_req: Request, res: Response) => {
        try {
            const providers = agent.repos.providerConfig.listAll();
            res.json({ providers });
        } catch (err) {
            res.status(500).json({ error: 'Failed to list providers' });
        }
    });

    router.post('/api/settings/providers', async (req: Request, res: Response) => {
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

            const internalName = authType === 'proxy' ? 'cliproxyapi' : name.toLowerCase();

            if (endpoint && (enabled !== false)) {
                try {
                    if (authType === 'proxy' || internalName === 'cliproxyapi') {
                        const { CliProxyApiAdapter } = await import('../adapters/cliproxyapi-adapter.js');
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

                    const allAvailable = agent.repos.modelRegistry.listAvailable();
                    const routingEntries = autoGenerateRouting(allAvailable);
                    agent.repos.routingConfig.replaceAll(routingEntries);
                    agent.inferenceRouter.reloadConfig();
                    agent.logger.info('Auto-generated routing', {
                        models: upserts.length,
                        routingEntries: routingEntries.length,
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

    router.put('/api/settings/providers/:name', (req: Request, res: Response) => {
        try {
            const { name } = req.params;
            const body = req.body as Record<string, unknown>;

            if ('enabled' in body && Object.keys(body).filter(k => k !== 'enabled' && k !== 'authType').length === 0) {
                agent.repos.providerConfig.toggle(name, body['enabled'] as boolean);
                wsManager.broadcast('config-updated', { type: 'provider', name });
                res.json({ ok: true });
                return;
            }

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

    router.delete('/api/settings/providers/:name', (req: Request, res: Response) => {
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

    router.post('/api/settings/providers/:name/test', async (req: Request, res: Response) => {
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

    router.post('/api/settings/providers/:name/discover', async (req: Request, res: Response) => {
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

    // ── Models ───────────────────────────────────────────────────────────

    router.get('/api/settings/models', (_req: Request, res: Response) => {
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

    router.put('/api/settings/models/:id', (req: Request, res: Response) => {
        try {
            const modelId = req.params['id'];
            const { available } = req.body as { available?: boolean };
            if (available === undefined) {
                res.status(400).json({ error: 'available (boolean) required' });
                return;
            }

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

            const autoGenerate = (req.query['autoGenerate'] !== 'false');
            if (autoGenerate) {
                const availableModels = agent.repos.modelRegistry.listAvailable();
                const routingEntries = autoGenerateRouting(availableModels);
                agent.repos.routingConfig.replaceAll(routingEntries);
            }

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

    router.post('/api/settings/models/save-selection', (req: Request, res: Response) => {
        try {
            const { selectedIds } = req.body as { selectedIds?: string[] };
            if (!selectedIds || !Array.isArray(selectedIds)) {
                res.status(400).json({ error: 'selectedIds (string[]) required' });
                return;
            }

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

            const availableModels = agent.repos.modelRegistry.listAvailable();
            const routingEntries = autoGenerateRouting(availableModels);
            agent.repos.routingConfig.replaceAll(routingEntries);

            agent.inferenceRouter.reloadConfig();
            wsManager.broadcast('config-updated', { type: 'models-batch' });
            res.json({ ok: true, selectedCount: selectedIds.length, routingEntries: routingEntries.length });
        } catch (err) {
            agent.logger.error('Settings model batch save failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to save model selection' });
        }
    });

    // ── Routing ──────────────────────────────────────────────────────────

    router.get('/api/settings/routing', (_req: Request, res: Response) => {
        try {
            const routingEntries = agent.repos.routingConfig.listAll();
            const dimensions = getRoutingDimensions();
            res.json({ entries: routingEntries, dimensions });
        } catch (err) {
            res.status(500).json({ error: 'Failed to list routing' });
        }
    });

    router.put('/api/settings/routing', (req: Request, res: Response) => {
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

    router.post('/api/settings/routing/reset', (_req: Request, res: Response) => {
        try {
            const availableModels = agent.repos.modelRegistry.listAvailable();
            const routingEntries = autoGenerateRouting(availableModels);
            agent.repos.routingConfig.replaceAll(routingEntries);
            agent.inferenceRouter.reloadConfig();
            wsManager.broadcast('config-updated', { type: 'routing-reset' });
            res.json({ ok: true, entries: routingEntries.length });
        } catch (err) {
            res.status(500).json({ error: 'Failed to reset routing' });
        }
    });

    // ── CLIProxy Detection ──────────────────────────────────────────────

    router.get('/api/settings/cliproxy/detect', async (_req: Request, res: Response) => {
        const endpoints = [
            process.env['CLIPROXYAPI_BASE_URL'] || 'http://localhost:8317',
            'http://localhost:5600',
        ];

        for (const endpoint of endpoints) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3000);
                const response = await fetch(`${endpoint}/v1/models`, {
                    signal: controller.signal,
                    headers: {
                        ...(process.env['CLIPROXYAPI_API_KEY']
                            ? { Authorization: `Bearer ${process.env['CLIPROXYAPI_API_KEY']}` }
                            : {}),
                    },
                });
                clearTimeout(timeout);

                if (response.ok) {
                    const data = await response.json() as { data?: Array<{ id: string }> };
                    const models = (data.data ?? []).map((m: { id: string }) => ({ id: m.id }));
                    res.json({ available: true, endpoint, models });
                    return;
                }
            } catch {
                // Try next endpoint
            }
        }

        res.json({ available: false });
    });
};
