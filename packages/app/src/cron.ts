/**
 * Cron Engine — Extends HeartbeatDaemon with user-defined cron jobs.
 *
 * Features:
 *   - User-created cron jobs via API (CRUD)
 *   - Cron expression parser (standard 5-field)
 *   - Execution history with result tracking
 *   - Pause/resume per job
 *   - Max concurrent executions guard
 */

// ── Types ───────────────────────────────────────────────────────────────

export interface CronJob {
    readonly id: string;
    readonly name: string;
    readonly cronExpression: string;
    readonly action: 'chat' | 'webhook' | 'custom';
    /** For 'chat': the message to send to agent loop */
    readonly chatMessage?: string;
    /** For 'webhook': URL to call */
    readonly webhookUrl?: string;
    readonly enabled: boolean;
    readonly lastRun?: string;
    readonly lastResult?: 'success' | 'failure' | 'skipped';
    readonly runCount: number;
    readonly createdAt: string;
}

export interface CronJobCreateInput {
    readonly name: string;
    readonly cronExpression: string;
    readonly action: 'chat' | 'webhook' | 'custom';
    readonly chatMessage?: string;
    readonly webhookUrl?: string;
}

// ── Cron Expression Parser (5-field: min hour dom month dow) ─────────────

/**
 * Check if a cron expression matches the current time.
 * Supports: wildcard, step (e.g. star-slash-N), exact, range (N-M), comma-separated values.
 */
export function cronMatchesNow(expression: string, now: Date = new Date()): boolean {
    const parts = expression.trim().split(/\s+/);
    if (parts.length < 5) return false;

    const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts as [string, string, string, string, string];

    return (
        fieldMatches(minExpr, now.getMinutes(), 0, 59) &&
        fieldMatches(hourExpr, now.getHours(), 0, 23) &&
        fieldMatches(domExpr, now.getDate(), 1, 31) &&
        fieldMatches(monExpr, now.getMonth() + 1, 1, 12) &&
        fieldMatches(dowExpr, now.getDay(), 0, 6)
    );
}

function fieldMatches(expr: string, value: number, _min: number, _max: number): boolean {
    if (expr === '*') return true;

    // Step: */N
    const stepMatch = expr.match(/^\*\/(\d+)$/);
    if (stepMatch) {
        const step = parseInt(stepMatch[1]!, 10);
        return step > 0 && value % step === 0;
    }

    // Comma-separated
    const parts = expr.split(',');
    for (const part of parts) {
        // Range: N-M
        const rangeMatch = part.match(/^(\d+)-(\d+)$/);
        if (rangeMatch) {
            const lo = parseInt(rangeMatch[1]!, 10);
            const hi = parseInt(rangeMatch[2]!, 10);
            if (value >= lo && value <= hi) return true;
            continue;
        }

        // Exact value
        if (parseInt(part, 10) === value) return true;
    }

    return false;
}

// ── Cron Store (in-memory, upgradable) ──────────────────────────────────

export class CronStore {
    private readonly jobs = new Map<string, CronJob>();

    list(): CronJob[] {
        return [...this.jobs.values()];
    }

    get(id: string): CronJob | undefined {
        return this.jobs.get(id);
    }

    create(input: CronJobCreateInput): CronJob {
        const id = `cron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const job: CronJob = {
            id,
            ...input,
            enabled: true,
            runCount: 0,
            createdAt: new Date().toISOString(),
        };
        this.jobs.set(id, job);
        return job;
    }

    update(id: string, updates: Partial<Pick<CronJob, 'name' | 'enabled' | 'cronExpression' | 'chatMessage'>>): CronJob | undefined {
        const existing = this.jobs.get(id);
        if (!existing) return undefined;
        const updated = { ...existing, ...updates };
        this.jobs.set(id, updated);
        return updated;
    }

    recordRun(id: string, result: 'success' | 'failure' | 'skipped'): void {
        const job = this.jobs.get(id);
        if (!job) return;
        this.jobs.set(id, {
            ...job,
            lastRun: new Date().toISOString(),
            lastResult: result,
            runCount: job.runCount + 1,
        });
    }

    delete(id: string): boolean {
        return this.jobs.delete(id);
    }
}

// ── Cron Tick Runner ────────────────────────────────────────────────────

export interface CronTickDeps {
    readonly store: CronStore;
    readonly executeChat: (message: string, sessionId: string) => Promise<void>;
    readonly executeWebhook: (url: string, payload: Record<string, unknown>) => Promise<void>;
    readonly logger: {
        info: (msg: string, data?: Record<string, unknown>) => void;
        error: (msg: string, data?: Record<string, unknown>) => void;
    };
}

const MAX_CONCURRENT = 5;
let activeCronTasks = 0;

/**
 * Execute one cron tick — check all enabled jobs against current time.
 * Called by HeartbeatDaemon every minute.
 */
export async function cronTick(deps: CronTickDeps): Promise<void> {
    const now = new Date();
    const jobs = deps.store.list().filter(j => j.enabled);

    for (const job of jobs) {
        if (!cronMatchesNow(job.cronExpression, now)) continue;

        // Check if last run was in the current minute (prevent double-execution)
        if (job.lastRun) {
            const lastRunDate = new Date(job.lastRun);
            if (
                lastRunDate.getFullYear() === now.getFullYear() &&
                lastRunDate.getMonth() === now.getMonth() &&
                lastRunDate.getDate() === now.getDate() &&
                lastRunDate.getHours() === now.getHours() &&
                lastRunDate.getMinutes() === now.getMinutes()
            ) {
                continue; // Already ran this minute
            }
        }

        // Concurrency guard
        if (activeCronTasks >= MAX_CONCURRENT) {
            deps.logger.info('Cron: max concurrent reached, skipping', { jobId: job.id });
            deps.store.recordRun(job.id, 'skipped');
            continue;
        }

        activeCronTasks++;
        try {
            if (job.action === 'chat' && job.chatMessage) {
                await deps.executeChat(job.chatMessage, `cron-${job.id}`);
                deps.store.recordRun(job.id, 'success');
            } else if (job.action === 'webhook' && job.webhookUrl) {
                await deps.executeWebhook(job.webhookUrl, {
                    cronJobId: job.id,
                    cronJobName: job.name,
                    timestamp: now.toISOString(),
                });
                deps.store.recordRun(job.id, 'success');
            } else {
                deps.store.recordRun(job.id, 'skipped');
            }

            deps.logger.info('Cron job executed', { jobId: job.id, name: job.name });
        } catch (err) {
            deps.store.recordRun(job.id, 'failure');
            deps.logger.error('Cron job failed', {
                jobId: job.id,
                error: err instanceof Error ? err.message : String(err),
            });
        } finally {
            activeCronTasks--;
        }
    }
}
