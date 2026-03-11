/**
 * Proxy Routes — OpenAI-compatible /v1/* API endpoints.
 */
import { ProxyHandler } from '@conshell/proxy';
import type { Request, Response, RouteRegistrar } from './context.js';

export const registerProxyRoutes: RouteRegistrar = (router, { agent }) => {
    const proxyHandler = new ProxyHandler({
        router: agent.inferenceRouter,
        logger: agent.logger,
        getTier: () => agent.getTier?.() ?? 'normal',
    });

    router.post('/v1/chat/completions', async (req: Request, res: Response) => {
        try {
            const body = req.body;
            const isStream = body.stream === true;

            if (isStream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                await proxyHandler.handleChatCompletion(
                    body,
                    (chunk: string) => res.write(chunk),
                    () => res.end(),
                );
            } else {
                const result = await proxyHandler.handleChatCompletion(body);
                res.status(result.status).json(result.body);
            }
        } catch (err) {
            agent.logger.error('Proxy /v1/chat/completions failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({
                error: {
                    message: err instanceof Error ? err.message : 'Internal server error',
                    type: 'server_error',
                    param: null,
                    code: 'internal_error',
                },
            });
        }
    });

    router.get('/v1/models', (_req: Request, res: Response) => {
        res.json(proxyHandler.handleListModels());
    });

    router.get('/v1/models/:id', (req: Request, res: Response) => {
        const model = proxyHandler.handleGetModel(req.params.id);
        if (!model) {
            res.status(404).json({
                error: { message: `Model '${req.params.id}' not found`, type: 'invalid_request_error' },
            });
        } else {
            res.json(model);
        }
    });

    router.get('/api/proxy/status', (_req: Request, res: Response) => {
        res.json(proxyHandler.getPoolStatus());
    });

    router.post('/api/proxy/accounts', (req: Request, res: Response) => {
        try {
            const { apiKey, label, baseUrl, rpmLimit } = req.body;
            if (!apiKey) {
                res.status(400).json({ error: 'apiKey is required' });
                return;
            }
            const account = proxyHandler.addAccountFromKey(apiKey, { label, baseUrl, rpmLimit });
            res.json({ ok: true, account: { id: account.id, provider: account.provider } });
        } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add account' });
        }
    });
};
