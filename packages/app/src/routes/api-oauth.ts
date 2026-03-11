/**
 * OAuth Routes — Browser-based OAuth login for API providers.
 *
 * Endpoints:
 *   POST   /api/oauth/:provider/start    — Initiate OAuth flow
 *   GET    /api/oauth/:provider/callback  — OAuth redirect callback
 *   GET    /api/oauth/:provider/status    — Poll flow status
 *   POST   /api/oauth/:provider/manual    — Submit manually-obtained key
 *   DELETE /api/oauth/:provider           — Disconnect provider
 *   GET    /api/oauth/providers           — List all provider statuses
 */

import { OAuthManager, type OAuthProvider, type OAuthProviderConfig } from '@conshell/proxy';
import { discoverModels } from '../services/model-discovery.js';
import type { UpsertModel } from '@conshell/state';
import { autoGenerateRouting } from '@conshell/inference';
import type { Request, Response, RouteRegistrar } from './context.js';

const VALID_PROVIDERS = new Set<OAuthProvider>(['github', 'google', 'claude', 'openai']);

function isValidProvider(p: string): p is OAuthProvider {
    return VALID_PROVIDERS.has(p as OAuthProvider);
}

/**
 * Map OAuth provider names to internal provider config names
 * used by the existing provider_config / model_registry.
 */
function toInternalProviderName(provider: OAuthProvider): string {
    switch (provider) {
        case 'github': return 'github-copilot';
        case 'google': return 'google-antigravity';
        case 'claude': return 'anthropic';
        case 'openai': return 'openai';
    }
}

function toEndpoint(provider: OAuthProvider): string {
    switch (provider) {
        case 'github': return 'https://api.githubcopilot.com';
        case 'google': return 'https://generativelanguage.googleapis.com';
        case 'claude': return 'https://api.anthropic.com';
        case 'openai': return 'https://api.openai.com';
    }
}

export const registerOAuthRoutes: RouteRegistrar = (router, { agent, wsManager }) => {
    // Build OAuth config from environment
    const oauthConfig: OAuthProviderConfig = {
        github: process.env['GITHUB_OAUTH_CLIENT_ID']
            ? { clientId: process.env['GITHUB_OAUTH_CLIENT_ID'] }
            : undefined,
        google: process.env['GOOGLE_OAUTH_CLIENT_ID']
            ? {
                clientId: process.env['GOOGLE_OAUTH_CLIENT_ID']!,
                clientSecret: process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? '',
                redirectUri: process.env['GOOGLE_OAUTH_REDIRECT_URI']
                    ?? `http://localhost:${process.env['PORT'] ?? '3402'}/api/oauth/google/callback`,
            }
            : undefined,
    };

    const oauth = new OAuthManager(oauthConfig, agent.logger);

    // ── POST /api/oauth/:provider/start ─────────────────────────────

    router.post('/api/oauth/:provider/start', async (req: Request, res: Response) => {
        try {
            const { provider } = req.params;
            if (!isValidProvider(provider)) {
                res.status(400).json({ error: `Invalid provider: ${provider}. Valid: ${[...VALID_PROVIDERS].join(', ')}` });
                return;
            }

            const flow = await oauth.startFlow(provider);
            res.json({ flow });
        } catch (err) {
            agent.logger.error('OAuth start failed', { error: String(err) });
            res.status(500).json({ error: String(err) });
        }
    });

    // ── GET /api/oauth/:provider/callback ───────────────────────────

    router.get('/api/oauth/:provider/callback', async (req: Request, res: Response) => {
        try {
            const { provider } = req.params;
            if (!isValidProvider(provider)) {
                res.status(400).send('Invalid provider');
                return;
            }

            const code = req.query?.['code'] as string | undefined;
            if (!code) {
                res.status(400).send('Missing authorization code');
                return;
            }

            const credential = await oauth.handleCallback(provider, code);

            // Auto-register provider
            await autoRegisterProvider(provider, credential.accessToken);

            // Respond with HTML that closes the popup window
            res.setHeader('Content-Type', 'text/html');
            res.send(`
                <!DOCTYPE html>
                <html>
                <head><title>Authorization Complete</title></head>
                <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#00ff88;">
                    <div style="text-align:center">
                        <h1>✅ ${provider} Connected</h1>
                        <p>You can close this window now.</p>
                        <script>setTimeout(() => window.close(), 2000);</script>
                    </div>
                </body>
                </html>
            `);
        } catch (err) {
            agent.logger.error('OAuth callback failed', { error: String(err) });
            res.status(500).send(`Authorization failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        }
    });

    // ── GET /api/oauth/:provider/status ─────────────────────────────

    router.get('/api/oauth/:provider/status', (req: Request, res: Response) => {
        const { provider } = req.params;
        if (!isValidProvider(provider)) {
            res.status(400).json({ error: 'Invalid provider' });
            return;
        }

        const flow = oauth.getFlowStatus(provider);
        const credential = oauth.getCredential(provider);

        res.json({
            provider,
            connected: !!credential,
            flow: flow ? {
                status: flow.status,
                flowType: flow.flowType,
                userCode: flow.userCode,
                verificationUri: flow.verificationUri,
                authUrl: flow.authUrl,
                guideUrl: flow.guideUrl,
                error: flow.error,
            } : null,
        });
    });

    // ── POST /api/oauth/:provider/manual ────────────────────────────

    router.post('/api/oauth/:provider/manual', async (req: Request, res: Response) => {
        try {
            const { provider } = req.params;
            if (!isValidProvider(provider)) {
                res.status(400).json({ error: 'Invalid provider' });
                return;
            }

            const { apiKey } = req.body as { apiKey?: string };
            if (!apiKey) {
                res.status(400).json({ error: 'apiKey required' });
                return;
            }

            const credential = await oauth.submitManualKey(provider, apiKey);

            // Auto-register provider
            await autoRegisterProvider(provider, credential.accessToken);

            res.json({ ok: true, provider, connected: true });
        } catch (err) {
            res.status(400).json({ error: String(err) });
        }
    });

    // ── DELETE /api/oauth/:provider ─────────────────────────────────

    router.delete('/api/oauth/:provider', (req: Request, res: Response) => {
        const { provider } = req.params;
        if (!isValidProvider(provider)) {
            res.status(400).json({ error: 'Invalid provider' });
            return;
        }

        const removed = oauth.disconnect(provider);

        // Also remove from provider_config
        const internalName = toInternalProviderName(provider);
        agent.repos.providerConfig.delete(internalName);

        wsManager.broadcast('config-updated', { type: 'oauth-disconnected', provider });
        res.json({ ok: true, removed });
    });

    // ── GET /api/oauth/providers ────────────────────────────────────

    router.get('/api/oauth/providers', (_req: Request, res: Response) => {
        const providers = (['github', 'google', 'claude', 'openai'] as const).map(p => ({
            provider: p,
            connected: !!oauth.getCredential(p),
            displayName: {
                github: 'GitHub Copilot',
                google: 'Google Antigravity',
                claude: 'Claude (Anthropic)',
                openai: 'OpenAI Codex',
            }[p],
            flowType: {
                github: 'device_code',
                google: 'authorization_code',
                claude: 'guided_key',
                openai: 'guided_key',
            }[p],
            flow: oauth.getFlowStatus(p) ?? null,
        }));
        res.json({ providers });
    });

    // ── Internal: auto-register provider after OAuth ────────────────

    async function autoRegisterProvider(provider: OAuthProvider, token: string): Promise<void> {
        const internalName = toInternalProviderName(provider);
        const endpoint = toEndpoint(provider);

        // 1. Upsert provider config
        agent.repos.providerConfig.upsert({
            name: internalName,
            authType: 'oauth',
            endpoint,
            apiKey: token,
            enabled: true,
            priority: 50,
        });

        // 2. Discover models
        try {
            const models = await discoverModels({
                providerName: internalName,
                providerType: internalName,
                endpoint,
                apiKey: token,
            }, agent.logger);

            if (models.length > 0) {
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

                agent.repos.modelRegistry.upsertMany(upserts);

                // Auto-generate routing
                const allAvailable = agent.repos.modelRegistry.listAvailable();
                const routingEntries = autoGenerateRouting(allAvailable);
                agent.repos.routingConfig.replaceAll(routingEntries);
                agent.inferenceRouter.reloadConfig();

                agent.logger.info(`OAuth: Auto-registered ${internalName}`, {
                    models: upserts.length,
                    routingEntries: routingEntries.length,
                });
            }
        } catch (err) {
            agent.logger.warn(`OAuth: Model discovery for ${internalName} failed (token may have limited scope)`, {
                error: err instanceof Error ? err.message : String(err),
            });
        }

        // 3. Broadcast update
        wsManager.broadcast('config-updated', { type: 'oauth-connected', provider: internalName });
    }

    agent.logger.info('🔐 OAuth routes registered (github, google, claude, openai)');
};
