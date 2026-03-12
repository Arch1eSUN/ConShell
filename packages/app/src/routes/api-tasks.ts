/**
 * Task Routes — CRUD for async agent tasks.
 */
import type { Request, Response, RouteRegistrar } from './context.js';

export const registerTaskRoutes: RouteRegistrar = (router, { agent }) => {
    /**
     * GET /api/tasks — list all tasks
     */
    router.get('/api/tasks', (_req: Request, res: Response) => {
        try {
            const status = (_req.query as Record<string, string>).status;
            const tasks = agent.taskQueue
                ? agent.taskQueue.list(status as 'pending' | 'running' | 'completed' | 'failed' | undefined)
                : [];
            res.json({ tasks, total: tasks.length });
        } catch (err) {
            agent.logger.error('Failed to list tasks', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to list tasks' });
        }
    });

    /**
     * POST /api/tasks — create a new async task
     */
    router.post('/api/tasks', (req: Request, res: Response) => {
        try {
            const { goal } = req.body as { goal?: string };
            if (!goal || !goal.trim()) {
                res.status(400).json({ error: 'goal (string) required' });
                return;
            }
            if (!agent.taskQueue) {
                res.status(501).json({ error: 'Task system not initialized' });
                return;
            }
            const task = agent.taskQueue.enqueue(goal.trim());
            res.status(201).json({ task });
        } catch (err) {
            agent.logger.error('Failed to create task', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to create task' });
        }
    });

    /**
     * GET /api/tasks/:id — get single task
     */
    router.get('/api/tasks/:id', (req: Request, res: Response) => {
        try {
            const task = agent.taskQueue?.get(req.params.id);
            if (!task) {
                res.status(404).json({ error: 'Task not found' });
                return;
            }
            res.json({ task });
        } catch (err) {
            agent.logger.error('Failed to get task', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to get task' });
        }
    });

    /**
     * POST /api/tasks/:id/cancel — cancel a pending/running task
     */
    router.post('/api/tasks/:id/cancel', (req: Request, res: Response) => {
        try {
            const ok = agent.taskQueue?.cancel(req.params.id);
            res.json({ success: !!ok });
        } catch (err) {
            agent.logger.error('Failed to cancel task', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to cancel task' });
        }
    });
};
