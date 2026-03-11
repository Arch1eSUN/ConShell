/**
 * Admin Routes — fund, logs, children, soul, providers overview.
 */
import type { Cents } from '@conshell/core';
import type { Request, Response, RouteRegistrar } from './context.js';

export const registerAdminRoutes: RouteRegistrar = (router, { agent, wsManager }) => {
    router.get('/api/logs', (req: Request, res: Response) => {
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

    router.post('/api/fund', (req: Request, res: Response) => {
        try {
            const { amountCents } = req.body as { amountCents?: number };

            if (!amountCents || typeof amountCents !== 'number') {
                res.status(400).json({ error: 'amountCents (number) required' });
                return;
            }

            const result = agent.cliAdmin.fund(amountCents as Cents);

            if (result.success) {
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

    router.get('/api/children', (_req: Request, res: Response) => {
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

    router.get('/api/soul', (_req: Request, res: Response) => {
        try {
            const doc = agent.soul.view();
            res.json(doc);
        } catch (err) {
            res.status(500).json({ error: 'Failed to get soul' });
        }
    });

    router.get('/api/providers', (_req: Request, res: Response) => {
        try {
            const staticProviders = agent.config.providers.map((p: { name: string; available: boolean; authType?: string; endpoint?: string }) => ({
                name: p.name,
                available: p.available,
                authType: p.authType ?? 'unknown',
                endpoint: p.endpoint ?? '',
                source: 'config' as const,
            }));

            const dbProviders = agent.repos.providerConfig.listAll().map(p => ({
                name: p.name,
                available: p.enabled === 1,
                authType: p.auth_type,
                endpoint: p.endpoint ?? '',
                source: 'settings' as const,
            }));

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
};
