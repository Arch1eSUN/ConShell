/**
 * Cron API Routes — CRUD for user-defined cron jobs.
 */
import type { Request, Response, RouteRegistrar } from './context.js';
import { CronStore } from '../cron.js';

// Shared cron store singleton
export const cronStore = new CronStore();

export const registerCronRoutes: RouteRegistrar = (router, { agent }) => {

    // List all cron jobs
    router.get('/api/cron', (_req: Request, res: Response) => {
        const jobs = cronStore.list();
        res.json({ jobs, count: jobs.length });
    });

    // Create a cron job
    router.post('/api/cron', (req: Request, res: Response) => {
        try {
            const { name, cronExpression, action, chatMessage, webhookUrl } = req.body as {
                name?: string;
                cronExpression?: string;
                action?: 'chat' | 'webhook' | 'custom';
                chatMessage?: string;
                webhookUrl?: string;
            };

            if (!name || !cronExpression || !action) {
                res.status(400).json({ error: 'name, cronExpression, and action required' });
                return;
            }

            // Validate cron expression (basic check: 5 space-separated fields)
            const parts = cronExpression.trim().split(/\s+/);
            if (parts.length < 5) {
                res.status(400).json({ error: 'cronExpression must have 5 fields (min hour dom month dow)' });
                return;
            }

            const job = cronStore.create({ name, cronExpression, action, chatMessage, webhookUrl });
            agent.logger.info('Cron job created', { jobId: job.id, name, cron: cronExpression });
            res.status(201).json({ job });
        } catch (err) {
            res.status(500).json({ error: 'Failed to create cron job' });
        }
    });

    // Get a specific cron job
    router.get('/api/cron/:id', (req: Request, res: Response) => {
        const job = cronStore.get(req.params.id);
        if (job) {
            res.json({ job });
        } else {
            res.status(404).json({ error: 'Cron job not found' });
        }
    });

    // Update a cron job (enable/disable, rename, change expression)
    router.patch('/api/cron/:id', (req: Request, res: Response) => {
        const updates = req.body as Partial<{
            name: string;
            enabled: boolean;
            cronExpression: string;
            chatMessage: string;
        }>;

        const updated = cronStore.update(req.params.id, updates);
        if (updated) {
            agent.logger.info('Cron job updated', { jobId: req.params.id, updates });
            res.json({ job: updated });
        } else {
            res.status(404).json({ error: 'Cron job not found' });
        }
    });

    // Delete a cron job
    router.delete('/api/cron/:id', (req: Request, res: Response) => {
        const deleted = cronStore.delete(req.params.id);
        if (deleted) {
            agent.logger.info('Cron job deleted', { jobId: req.params.id });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Cron job not found' });
        }
    });
};
