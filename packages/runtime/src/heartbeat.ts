/**
 * Heartbeat Daemon — setTimeout-based scheduler with cron, leases, and wake events.
 *
 * Ticks every 60s. Evaluates cron expressions. Uses lease-based execution
 * to prevent double-runs. Inserts wake events for the agent loop.
 */
import type { Logger, SurvivalTier, HeartbeatResult } from '@conshell/core';
import type { HeartbeatRepository } from '@conshell/state';

export interface HeartbeatTask {
    readonly name: string;
    readonly cronExpression: string;
    readonly minTier: SurvivalTier;
    readonly handler: (ctx: HeartbeatContext) => Promise<HeartbeatResult>;
}

export interface HeartbeatContext {
    readonly taskName: string;
    readonly logger: Logger;
    readonly tier: SurvivalTier;
}

export interface HeartbeatDaemonDeps {
    readonly heartbeatRepo: HeartbeatRepository;
    readonly logger: Logger;
    readonly getTier: () => SurvivalTier;
    readonly instanceId: string;
}

const TICK_INTERVAL_MS = 60_000;
const LEASE_TTL_MS = 60_000;

const TIER_ORDER: Record<SurvivalTier, number> = {
    high: 4,
    normal: 3,
    low: 2,
    critical: 1,
    emergency: 0,
};

/**
 * Simple cron match: supports basic minute/hour patterns.
 * For v1, uses timestamp-based modulo matching.
 */
function shouldRunNow(cronExpression: string, lastRun: string | null): boolean {
    if (!lastRun) return true;
    const elapsed = Date.now() - new Date(lastRun).getTime();
    const match = cronExpression.match(/^\*\/(\d+)/);
    if (match) {
        const intervalMin = parseInt(match[1]!, 10);
        return elapsed >= intervalMin * 60_000;
    }
    return elapsed >= TICK_INTERVAL_MS;
}

export class HeartbeatDaemon {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly tasks: Map<string, HeartbeatTask> = new Map();
    private running = false;

    constructor(private readonly deps: HeartbeatDaemonDeps) { }

    registerTask(task: HeartbeatTask): void {
        this.tasks.set(task.name, task);
        this.deps.heartbeatRepo.upsertSchedule({
            name: task.name,
            cron: task.cronExpression,
            enabled: true,
            minTier: task.minTier,
        });
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.deps.logger.info('Heartbeat daemon starting');
        this.scheduleTick();
    }

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.deps.logger.info('Heartbeat daemon stopped');
    }

    get isRunning(): boolean {
        return this.running;
    }

    private scheduleTick(): void {
        if (!this.running) return;
        this.timer = setTimeout(async () => {
            await this.tick();
            this.scheduleTick();
        }, TICK_INTERVAL_MS);
    }

    /**
     * Execute one heartbeat tick. Public for testing.
     */
    async tick(): Promise<void> {
        const currentTier = this.deps.getTier();

        for (const [name, task] of this.tasks) {
            try {
                // Check tier gate
                if (TIER_ORDER[currentTier] < TIER_ORDER[task.minTier]) {
                    continue;
                }

                // Check schedule
                const schedule = this.deps.heartbeatRepo.findSchedule(name);
                if (!schedule || !schedule.enabled) continue;

                // Cron check
                if (!shouldRunNow(task.cronExpression, schedule.last_run)) {
                    continue;
                }

                // Lease acquisition (3 args: taskName, holderId, expiresAt)
                const leaseExpiry = new Date(Date.now() + LEASE_TTL_MS).toISOString();
                const leaseAcquired = this.deps.heartbeatRepo.acquireLease(
                    name,
                    this.deps.instanceId,
                    leaseExpiry,
                );
                if (!leaseAcquired) {
                    this.deps.logger.debug('Lease not acquired, skipping', { task: name });
                    continue;
                }

                // Execute task
                const startMs = Date.now();
                const result = await task.handler({
                    taskName: name,
                    logger: this.deps.logger,
                    tier: currentTier,
                });
                const durationMs = Date.now() - startMs;

                // Record history (positional args: taskName, result, durationMs, error?, shouldWake?)
                this.deps.heartbeatRepo.insertHistory(
                    name,
                    result,
                    durationMs,
                    undefined, // no error
                    false,     // shouldWake
                );

                // Update last_run (no args — uses internal nowISO)
                this.deps.heartbeatRepo.updateLastRun(name);

                // Release lease
                this.deps.heartbeatRepo.releaseLease(name, this.deps.instanceId);

                this.deps.logger.debug('Heartbeat task completed', {
                    task: name,
                    durationMs,
                });
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                this.deps.logger.error('Heartbeat task failed', {
                    task: name,
                    error: errorMsg,
                });

                // Record failure
                this.deps.heartbeatRepo.insertHistory(
                    name,
                    'error' as HeartbeatResult,
                    0,
                    errorMsg,
                    false,
                );

                // Release lease on failure
                this.deps.heartbeatRepo.releaseLease(name, this.deps.instanceId);
            }
        }
    }
}
