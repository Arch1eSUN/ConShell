/**
 * Smart Model Router — Task complexity analysis + cost-optimized selection.
 *
 * Goes beyond auto-routing by:
 *   - Analyzing prompt complexity (token count, reasoning required, etc.)
 *   - Cost-optimized selection (same quality → cheapest model)
 *   - Quality monitoring with ELO-like scoring
 *   - Auto-degradation when quality drops
 *   - Prompt caching (dedup identical prompts)
 */
import type { ModelRow } from '@conshell/state';

// ── Types ───────────────────────────────────────────────────────────────

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';

export interface ComplexityAnalysis {
    readonly complexity: TaskComplexity;
    readonly score: number;           // 0-100
    readonly estimatedTokens: number;
    readonly features: ComplexityFeatures;
    readonly recommendedTier: 'fast' | 'strong' | 'flagship';
}

export interface ComplexityFeatures {
    readonly hasCodeRequest: boolean;
    readonly hasReasoningChain: boolean;
    readonly hasMultiStep: boolean;
    readonly hasCreativeWriting: boolean;
    readonly hasMath: boolean;
    readonly hasDataAnalysis: boolean;
    readonly contextLength: number;
    readonly questionDepth: number;
}

export interface SmartRouteResult {
    readonly selectedModel: ModelRow;
    readonly complexity: ComplexityAnalysis;
    readonly costEstimateMicro: number;
    readonly reason: string;
    readonly alternatives: readonly ModelRow[];
}

export interface ModelQualityScore {
    readonly modelId: string;
    readonly elo: number;
    readonly successRate: number;
    readonly avgLatencyMs: number;
    readonly totalCalls: number;
    readonly lastUpdated: string;
}

// ── Complexity Analyzer ─────────────────────────────────────────────────

const CODE_INDICATORS = [
    /\b(function|class|const|let|var|import|export|def|fn|struct)\b/,
    /\b(typescript|javascript|python|rust|go|java|cpp|sql)\b/i,
    /```[\s\S]*```/,
    /\b(debug|error|fix|bug|refactor|implement|build)\b/i,
    /[{}()\[\]]/,
];

const REASONING_INDICATORS = [
    /\b(why|how|explain|analyze|compare|evaluate|prove|derive)\b/i,
    /\b(therefore|because|consequently|implies|if.*then)\b/i,
    /\b(step.by.step|chain.of.thought|logical|reasoning)\b/i,
];

const MATH_INDICATORS = [
    /\b(calculate|compute|solve|equation|formula|integral|derivative)\b/i,
    /[+\-*/=<>]{2,}/,
    /\b(sum|product|limit|matrix|vector|probability)\b/i,
];

const CREATIVE_INDICATORS = [
    /\b(write|compose|create|draft|story|poem|essay|article)\b/i,
    /\b(creative|imaginative|narrative|fiction|dialogue)\b/i,
];

const MULTI_STEP_INDICATORS = [
    /\b(first|then|next|finally|step \d|phase \d)\b/i,
    /\b(plan|pipeline|workflow|sequence|procedure)\b/i,
    /\d+\.\s/,
];

/**
 * Analyze prompt complexity to determine optimal model tier.
 */
export function analyzeComplexity(prompt: string): ComplexityAnalysis {
    const words = prompt.split(/\s+/).length;
    const estimatedTokens = Math.ceil(words * 1.3);

    // Feature detection
    const features: ComplexityFeatures = {
        hasCodeRequest: CODE_INDICATORS.some(r => r.test(prompt)),
        hasReasoningChain: REASONING_INDICATORS.some(r => r.test(prompt)),
        hasMultiStep: MULTI_STEP_INDICATORS.some(r => r.test(prompt)),
        hasCreativeWriting: CREATIVE_INDICATORS.some(r => r.test(prompt)),
        hasMath: MATH_INDICATORS.some(r => r.test(prompt)),
        hasDataAnalysis: /\b(data|dataset|csv|json|analyze|chart|graph|statistics)\b/i.test(prompt),
        contextLength: prompt.length,
        questionDepth: (prompt.match(/\?/g) || []).length,
    };

    // Score computation (0-100)
    let score = 10; // base

    if (features.hasCodeRequest) score += 20;
    if (features.hasReasoningChain) score += 20;
    if (features.hasMultiStep) score += 15;
    if (features.hasMath) score += 15;
    if (features.hasDataAnalysis) score += 10;
    if (features.hasCreativeWriting) score += 5;

    // Context length bonus
    if (estimatedTokens > 2000) score += 10;
    if (estimatedTokens > 5000) score += 10;

    // Question depth bonus
    score += Math.min(features.questionDepth * 3, 10);

    score = Math.min(score, 100);

    // Map score → complexity
    let complexity: TaskComplexity;
    let recommendedTier: 'fast' | 'strong' | 'flagship';

    if (score <= 20) {
        complexity = 'trivial';
        recommendedTier = 'fast';
    } else if (score <= 40) {
        complexity = 'simple';
        recommendedTier = 'fast';
    } else if (score <= 60) {
        complexity = 'moderate';
        recommendedTier = 'strong';
    } else if (score <= 80) {
        complexity = 'complex';
        recommendedTier = 'flagship';
    } else {
        complexity = 'expert';
        recommendedTier = 'flagship';
    }

    return { complexity, score, estimatedTokens, features, recommendedTier };
}

// ── Quality Monitor ─────────────────────────────────────────────────────

export class ModelQualityMonitor {
    private readonly scores = new Map<string, ModelQualityScore>();

    /**
     * Record a model call result for quality tracking.
     */
    recordCall(modelId: string, success: boolean, latencyMs: number): void {
        const existing = this.scores.get(modelId);
        const now = new Date().toISOString();

        if (!existing) {
            this.scores.set(modelId, {
                modelId,
                elo: 1200,  // Default ELO
                successRate: success ? 1.0 : 0.0,
                avgLatencyMs: latencyMs,
                totalCalls: 1,
                lastUpdated: now,
            });
            return;
        }

        const totalCalls = existing.totalCalls + 1;
        const successRate = ((existing.successRate * existing.totalCalls) + (success ? 1 : 0)) / totalCalls;
        const avgLatencyMs = ((existing.avgLatencyMs * existing.totalCalls) + latencyMs) / totalCalls;

        // Simple ELO adjustment: +10 for success, -15 for failure
        const eloChange = success ? 10 : -15;
        const elo = Math.max(800, Math.min(2000, existing.elo + eloChange));

        this.scores.set(modelId, {
            modelId, elo, successRate, avgLatencyMs, totalCalls, lastUpdated: now,
        });
    }

    /**
     * Get quality score for a model.
     */
    getScore(modelId: string): ModelQualityScore | undefined {
        return this.scores.get(modelId);
    }

    /**
     * Get all model quality scores sorted by ELO.
     */
    getAllScores(): ModelQualityScore[] {
        return [...this.scores.values()].sort((a, b) => b.elo - a.elo);
    }

    /**
     * Check if a model should be degraded (removed from rotation).
     */
    shouldDegrade(modelId: string, minElo: number = 900, minSuccessRate: number = 0.5): boolean {
        const score = this.scores.get(modelId);
        if (!score || score.totalCalls < 10) return false; // Not enough data
        return score.elo < minElo || score.successRate < minSuccessRate;
    }
}

// ── Smart Router ────────────────────────────────────────────────────────

export class SmartRouter {
    private readonly qualityMonitor = new ModelQualityMonitor();
    private readonly promptCache = new Map<string, { modelId: string; timestamp: number }>();
    private readonly cacheMaxAge = 300_000; // 5 min

    /**
     * Select the optimal model for a prompt based on complexity + cost + quality.
     */
    route(prompt: string, availableModels: readonly ModelRow[]): SmartRouteResult {
        if (availableModels.length === 0) {
            throw new Error('No models available for routing');
        }

        const complexity = analyzeComplexity(prompt);

        // Check prompt cache (dedup)
        const cacheKey = this.hashPrompt(prompt);
        const cached = this.promptCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
            const cachedModel = availableModels.find(m => m.id === cached.modelId);
            if (cachedModel) {
                return {
                    selectedModel: cachedModel,
                    complexity,
                    costEstimateMicro: this.estimateCost(cachedModel, complexity.estimatedTokens),
                    reason: 'Cached result from identical prompt',
                    alternatives: [],
                };
            }
        }

        // Filter models by recommended tier
        const tierModels = this.filterByTier(availableModels, complexity.recommendedTier);

        // Sort by cost efficiency (quality/cost ratio)
        const ranked = this.rankByCostEfficiency(
            tierModels.length > 0 ? tierModels : [...availableModels],
        );

        // Filter out degraded models
        const healthy = ranked.filter(m => !this.qualityMonitor.shouldDegrade(m.id));
        const candidates = healthy.length > 0 ? healthy : ranked;

        const selected = candidates[0]!;
        const alternatives = candidates.slice(1, 4);

        // Cache the result
        this.promptCache.set(cacheKey, { modelId: selected.id, timestamp: Date.now() });

        const reason = this.buildReason(complexity, selected);

        return {
            selectedModel: selected,
            complexity,
            costEstimateMicro: this.estimateCost(selected, complexity.estimatedTokens),
            reason,
            alternatives,
        };
    }

    /**
     * Record a call result for quality monitoring.
     */
    recordResult(modelId: string, success: boolean, latencyMs: number): void {
        this.qualityMonitor.recordCall(modelId, success, latencyMs);
    }

    /**
     * Get quality scores for all monitored models.
     */
    getQualityScores(): ModelQualityScore[] {
        return this.qualityMonitor.getAllScores();
    }

    // ── Private helpers ─────────────────────────────────────────────────

    private filterByTier(models: readonly ModelRow[], tier: 'fast' | 'strong' | 'flagship'): ModelRow[] {
        const costThresholds: Record<string, { min: number; max: number }> = {
            fast: { min: 0, max: 2_000 },
            strong: { min: 0, max: 10_000 },
            flagship: { min: 2_000, max: Infinity },
        };

        const { min, max } = costThresholds[tier]!;
        return models.filter(m => {
            const cost = m.input_cost_micro + m.output_cost_micro;
            // Zero-cost models (local/proxy) match any tier
            if (cost === 0) return true;
            return cost >= min && cost <= max;
        });
    }

    private rankByCostEfficiency(models: ModelRow[]): ModelRow[] {
        return [...models].sort((a, b) => {
            const aScore = this.qualityMonitor.getScore(a.id);
            const bScore = this.qualityMonitor.getScore(b.id);
            const aElo = aScore?.elo ?? 1200;
            const bElo = bScore?.elo ?? 1200;

            const aCost = a.input_cost_micro + a.output_cost_micro || 1;
            const bCost = b.input_cost_micro + b.output_cost_micro || 1;

            // Quality/cost ratio — higher is better
            const aRatio = aElo / aCost;
            const bRatio = bElo / bCost;

            return bRatio - aRatio; // Descending
        });
    }

    private estimateCost(model: ModelRow, estimatedTokens: number): number {
        // Assume 50/50 input/output split
        const inputTokens = Math.ceil(estimatedTokens * 0.5);
        const outputTokens = Math.ceil(estimatedTokens * 0.5);
        return (
            (inputTokens * model.input_cost_micro) / 1_000_000 +
            (outputTokens * model.output_cost_micro) / 1_000_000
        );
    }

    private hashPrompt(prompt: string): string {
        const { createHash } = require('node:crypto') as typeof import('node:crypto');
        return createHash('md5').update(prompt).digest('hex');
    }

    private buildReason(complexity: ComplexityAnalysis, model: ModelRow): string {
        const parts: string[] = [];
        parts.push(`Complexity: ${complexity.complexity} (score: ${complexity.score})`);
        parts.push(`Model: ${model.name} (${model.provider})`);

        const cost = model.input_cost_micro + model.output_cost_micro;
        if (cost === 0) {
            parts.push('Cost: Free (zero-cost model)');
        } else {
            parts.push(`Est. cost: $${this.estimateCost(model, complexity.estimatedTokens).toFixed(4)}`);
        }

        const score = this.qualityMonitor.getScore(model.id);
        if (score) {
            parts.push(`Quality: ELO ${score.elo}, ${(score.successRate * 100).toFixed(0)}% success`);
        }

        return parts.join(' | ');
    }
}
