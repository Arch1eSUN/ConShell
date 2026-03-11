/**
 * SelfEvolutionEngine — recursive self-improvement engine for the Conway Automaton.
 *
 * Periodically analyzes agent performance metrics (task success rate, inference
 * costs, memory recall quality) and generates code patches to improve itself.
 *
 * Governed by:
 * - selfModConfig.maxSelfModPerHour (rate limit via PolicyEngine)
 * - SurvivalTier (more aggressive at high tier, conservative at low)
 * - All changes go through ComputeProvider sandbox for isolation
 */
import type { Logger, SurvivalTier } from '@conshell/core';
import type { ComputeProvider } from '@conshell/compute';
import type { HeartbeatTask, HeartbeatContext } from './heartbeat.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface SelfEvolutionDeps {
    readonly logger: Logger;
    readonly compute: ComputeProvider;
    /** Max self-mod operations per hour (from config.selfMod) */
    readonly maxSelfModPerHour: number;
    /** Callback when self-mod is applied */
    readonly onEvolution?: (patch: EvolutionPatch) => void;
}

export interface EvolutionPatch {
    readonly id: string;
    readonly description: string;
    readonly targetFile: string;
    readonly diff: string;
    readonly appliedAt: string;
    readonly reason: 'performance' | 'cost_optimization' | 'capability' | 'reliability';
}

interface PerformanceMetrics {
    readonly taskSuccessRate: number;  // 0-1
    readonly avgInferenceCostCents: number;
    readonly memoryRecallQuality: number; // 0-1
    readonly errorRate: number; // 0-1
}

// ── Evolution Engine ────────────────────────────────────────────────────

export class SelfEvolutionEngine {
    private readonly logger: Logger;
    private readonly compute: ComputeProvider;
    private readonly maxSelfModPerHour: number;
    private readonly onEvolution?: (patch: EvolutionPatch) => void;
    private selfModCount = 0;
    private lastResetHour = new Date().getHours();

    constructor(deps: SelfEvolutionDeps) {
        this.logger = deps.logger;
        this.compute = deps.compute;
        this.maxSelfModPerHour = deps.maxSelfModPerHour;
        this.onEvolution = deps.onEvolution;
    }

    /**
     * Analyze current performance and decide if self-modification is needed.
     */
    async analyze(metrics: PerformanceMetrics, tier: SurvivalTier): Promise<EvolutionPatch | null> {
        // Reset hourly counter
        const currentHour = new Date().getHours();
        if (currentHour !== this.lastResetHour) {
            this.selfModCount = 0;
            this.lastResetHour = currentHour;
        }

        // Rate limit check
        if (this.selfModCount >= this.maxSelfModPerHour) {
            this.logger.debug('Self-mod rate limit reached', {
                count: this.selfModCount,
                max: this.maxSelfModPerHour,
            });
            return null;
        }

        // Tier-based decision: only self-modify at high or normal tiers
        if (tier === 'critical' || tier === 'low') {
            this.logger.debug('Skipping self-evolution at low/critical tier', { tier });
            return null;
        }

        // Analyze metrics for improvement opportunities
        const opportunity = this.identifyOpportunity(metrics);
        if (!opportunity) {
            this.logger.debug('No self-evolution opportunity found');
            return null;
        }

        this.logger.info('Self-evolution opportunity identified', {
            reason: opportunity.reason,
            description: opportunity.description,
        });

        // In sandbox: generate and test the patch
        const patch = await this.generatePatch(opportunity);
        if (patch) {
            this.selfModCount++;
            this.onEvolution?.(patch);
        }

        return patch;
    }

    /**
     * Identify improvement opportunities from metrics.
     */
    private identifyOpportunity(metrics: PerformanceMetrics): { reason: EvolutionPatch['reason']; description: string } | null {
        // High error rate → reliability improvement
        if (metrics.errorRate > 0.2) {
            return {
                reason: 'reliability',
                description: `Error rate ${(metrics.errorRate * 100).toFixed(1)}% exceeds 20% threshold — analyzing error patterns`,
            };
        }

        // High inference cost → cost optimization
        if (metrics.avgInferenceCostCents > 50) {
            return {
                reason: 'cost_optimization',
                description: `Average inference cost ${metrics.avgInferenceCostCents}¢ exceeds 50¢ — exploring cheaper model routing`,
            };
        }

        // Low memory recall → capability improvement
        if (metrics.memoryRecallQuality < 0.5) {
            return {
                reason: 'capability',
                description: `Memory recall quality ${(metrics.memoryRecallQuality * 100).toFixed(1)}% below 50% — improving retrieval`,
            };
        }

        // Low task success → performance improvement
        if (metrics.taskSuccessRate < 0.7) {
            return {
                reason: 'performance',
                description: `Task success rate ${(metrics.taskSuccessRate * 100).toFixed(1)}% below 70% — analyzing failure patterns`,
            };
        }

        return null;
    }

    /**
     * Generate a code patch in a sandboxed environment.
     */
    private async generatePatch(opportunity: { reason: EvolutionPatch['reason']; description: string }): Promise<EvolutionPatch | null> {
        try {
            // Create a sandbox for isolated self-modification
            const sandboxId = await this.compute.createSandbox({
                name: `evolution-${Date.now()}`,
                memoryMb: 256,
                cpuShares: 512,
            });

            this.logger.info('Evolution sandbox created', { sandboxId });

            // For now, log the opportunity — actual AI-driven patch generation
            // would use the inference router to analyze code and propose changes
            const patch: EvolutionPatch = {
                id: `evo-${Date.now()}`,
                description: opportunity.description,
                targetFile: 'packages/runtime/src/heartbeat-tasks.ts', // Placeholder
                diff: `// Self-evolution: ${opportunity.reason}\n// ${opportunity.description}\n// Applied at: ${new Date().toISOString()}`,
                appliedAt: new Date().toISOString(),
                reason: opportunity.reason,
            };

            // Clean up sandbox
            await this.compute.destroySandbox(sandboxId);

            return patch;
        } catch (err) {
            this.logger.error('Self-evolution patch generation failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    }
}

// ── Heartbeat Task Factory ──────────────────────────────────────────────

export function createSelfEvolutionTask(engine: SelfEvolutionEngine): HeartbeatTask {
    return {
        name: 'self_evolution',
        cronExpression: '0 */6 * * *', // Every 6 hours
        minTier: 'normal' as SurvivalTier,
        handler: async (ctx: HeartbeatContext): Promise<'success' | 'failure'> => {
            // Placeholder metrics — in production, these come from actual repos
            const metrics: PerformanceMetrics = {
                taskSuccessRate: 0.85,
                avgInferenceCostCents: 20,
                memoryRecallQuality: 0.7,
                errorRate: 0.05,
            };

            const patch = await engine.analyze(metrics, ctx.tier);
            if (patch) {
                return 'success';
            }
            return 'success'; // No patch needed is also success
        },
    };
}
