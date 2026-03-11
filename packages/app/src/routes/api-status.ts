/**
 * Status Routes — health check, agent status, heartbeat, memory.
 */
import type { Request, Response, RouteRegistrar } from './context.js';

export const registerStatusRoutes: RouteRegistrar = (router, { agent }) => {
    router.get('/api/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            agent: agent.config.agentName,
            state: agent.getState(),
            uptime: process.uptime(),
            authRequired: agent.config.authMode !== 'none',
        });
    });

    router.get('/api/status', (_req: Request, res: Response) => {
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

    router.get('/api/heartbeat', (_req: Request, res: Response) => {
        try {
            res.json({
                running: true,
                recentBeats: agent.repos.heartbeat.listEnabled(),
            });
        } catch (err) {
            res.status(500).json({ error: 'Failed to get heartbeat status' });
        }
    });

    router.get('/api/memory/stats', (_req: Request, res: Response) => {
        try {
            const stats = agent.memoryManager.stats('default');
            res.json({ tiers: stats });
        } catch (err) {
            res.status(500).json({ error: 'Failed to get memory stats' });
        }
    });
};
