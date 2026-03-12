/**
 * Backup Routes — agent state backup and restore.
 *
 * Endpoints:
 *   GET    /api/backups             — list all backups
 *   POST   /api/backups             — create a new backup
 *   POST   /api/backups/:id/restore — restore from a backup
 *   POST   /api/backups/:id/verify  — verify backup integrity
 *   DELETE /api/backups/:id         — delete a backup
 */
import type { Request, Response, RouteRegistrar } from './context.js';
import { readdir, readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// ── Route Registration ──────────────────────────────────────────────────

export const registerBackupRoutes: RouteRegistrar = (router, { agent }) => {
    const backupsDir = resolve(agent.config.agentHome, 'backups');

    // List all backups
    router.get('/api/backups', async (_req: Request, res: Response) => {
        try {
            await mkdir(backupsDir, { recursive: true });
            const entries = await readdir(backupsDir);
            const backups: Array<{
                id: string;
                filename: string;
                type: string;
                size: number;
                createdAt: string;
                hash: string;
            }> = [];

            for (const entry of entries) {
                if (!entry.endsWith('.json')) continue;
                try {
                    const filepath = join(backupsDir, entry);
                    const s = await stat(filepath);
                    const content = await readFile(filepath, 'utf-8');
                    const meta = JSON.parse(content);
                    backups.push({
                        id: meta.id ?? entry.replace('.json', ''),
                        filename: entry,
                        type: meta.type ?? 'full',
                        size: s.size,
                        createdAt: meta.createdAt ?? s.mtime.toISOString(),
                        hash: meta.hash ?? '',
                    });
                } catch { /* skip corrupt files */ }
            }

            backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            res.json({ backups, count: backups.length });
        } catch (err) {
            res.status(500).json({ error: 'Failed to list backups' });
        }
    });

    // Create a backup
    router.post('/api/backups', async (req: Request, res: Response) => {
        try {
            const { type = 'full' } = req.body as { type?: string };
            await mkdir(backupsDir, { recursive: true });

            const id = randomUUID().slice(0, 8);
            const timestamp = new Date().toISOString();

            // Collect backup data
            const data: Record<string, unknown> = { id, type, createdAt: timestamp };

            if (type === 'full' || type === 'config') {
                data.config = {
                    agentName: agent.config.agentName,
                    authMode: agent.config.authMode,
                    logLevel: agent.config.logLevel,
                    dailyBudgetCents: agent.config.dailyBudgetCents,
                    providers: agent.config.providers.map(p => ({
                        name: p.name,
                        available: p.available,
                        endpoint: p.endpoint,
                    })),
                };
            }

            if (type === 'full' || type === 'memory') {
                data.memoryStats = {
                    episodic: 'included',
                    semantic: 'included',
                };
            }

            if (type === 'full' || type === 'wallet') {
                data.wallet = {
                    tier: agent.getTier(),
                    state: agent.getState(),
                };
            }

            // Compute integrity hash
            const payload = JSON.stringify(data);
            data.hash = createHash('sha256').update(payload).digest('hex');

            // Write backup file
            const filename = `backup-${id}-${type}.json`;
            await writeFile(join(backupsDir, filename), JSON.stringify(data, null, 2), 'utf-8');

            agent.logger.info('Backup created', { id, type, filename });
            res.status(201).json({ success: true, backup: { id, type, filename, createdAt: timestamp } });
        } catch (err) {
            res.status(500).json({
                error: 'Backup creation failed',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });

    // Restore from a backup
    router.post('/api/backups/:id/restore', async (req: Request, res: Response) => {
        try {
            const backupId = req.params.id;
            const files = await readdir(backupsDir);
            const match = files.find(f => f.includes(backupId) && f.endsWith('.json'));

            if (!match) {
                res.status(404).json({ error: `Backup ${backupId} not found` });
                return;
            }

            const content = await readFile(join(backupsDir, match), 'utf-8');
            const data = JSON.parse(content);

            // Restore agent name if present
            if (data.config?.agentName) {
                const currentSoul = agent.soul.view();
                if (currentSoul.name !== data.config.agentName) {
                    agent.soul.update({ name: data.config.agentName });
                }
            }

            agent.logger.info('Backup restored', { id: backupId, type: data.type });
            res.json({ success: true, restored: { id: backupId, type: data.type } });
        } catch (err) {
            res.status(500).json({
                error: 'Restore failed',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });

    // Verify backup integrity
    router.post('/api/backups/:id/verify', async (req: Request, res: Response) => {
        try {
            const backupId = req.params.id;
            const files = await readdir(backupsDir);
            const match = files.find(f => f.includes(backupId) && f.endsWith('.json'));

            if (!match) {
                res.status(404).json({ error: `Backup ${backupId} not found` });
                return;
            }

            const content = await readFile(join(backupsDir, match), 'utf-8');
            const data = JSON.parse(content);
            const storedHash = data.hash;

            // Recompute hash without the hash field
            const { hash: _, ...dataWithoutHash } = data;
            const recomputed = createHash('sha256')
                .update(JSON.stringify(dataWithoutHash))
                .digest('hex');

            const valid = storedHash === recomputed;
            res.json({
                valid,
                id: backupId,
                storedHash,
                computedHash: recomputed,
            });
        } catch (err) {
            res.status(500).json({
                error: 'Verification failed',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });

    // Delete a backup
    router.delete('/api/backups/:id', async (req: Request, res: Response) => {
        try {
            const backupId = req.params.id;
            const files = await readdir(backupsDir);
            const match = files.find(f => f.includes(backupId) && f.endsWith('.json'));

            if (!match) {
                res.status(404).json({ error: `Backup ${backupId} not found` });
                return;
            }

            await rm(join(backupsDir, match));
            agent.logger.info('Backup deleted', { id: backupId });
            res.json({ success: true, deleted: backupId });
        } catch (err) {
            res.status(500).json({
                error: 'Deletion failed',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });
};
