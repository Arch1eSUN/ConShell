/**
 * Auto-routing — Intelligent routing matrix generation from user-selected models.
 *
 * Given the set of enabled models, auto-generates a routing matrix
 * that assigns models to tier × taskType cells based on:
 *   1. Zero-cost models (subscription/local) always prioritized over paid API
 *   2. Within zero-cost: sorted by capability match for the task type
 *   3. Paid models sorted by capability/cost ratio
 *   4. Local models (ollama) as fallback at the end
 */
import type { ModelRow } from '@web4-agent/state';
import type { InsertRoutingEntry } from '@web4-agent/state';

// ── Model capability tiers ──────────────────────────────────────────────

export type ModelTier = 'flagship' | 'strong' | 'fast' | 'local';

/** Known model capability classifications. Unknown models are inferred from cost. */
const MODEL_TIER_MAP: Record<string, ModelTier> = {
    // Flagship — best reasoning & coding
    'claude-sonnet-4': 'flagship',
    'claude-opus': 'flagship',
    'claude-3-5-sonnet': 'flagship',
    'gpt-4o': 'flagship',
    'gpt-4-turbo': 'flagship',
    'gemini-2.5-pro': 'flagship',
    'gemini-1.5-pro': 'flagship',
    'deepseek-r1': 'flagship',
    'qwen-max': 'flagship',

    // Strong — capable but not top-tier
    'claude-3-5-haiku': 'strong',
    'gpt-4': 'strong',
    'gemini-2.0-flash-thinking': 'strong',

    // Fast — small, cheap, quick
    'gpt-4o-mini': 'fast',
    'gpt-3.5-turbo': 'fast',
    'gemini-2.0-flash': 'fast',
    'gemini-1.5-flash': 'fast',
    'claude-3-haiku': 'fast',
    'mistral-nemo': 'fast',
    'mistral-small': 'fast',

    // Local — self-hosted
    'llama3.2': 'local',
    'llama3.1': 'local',
    'llama3.1-8b': 'local',
    'llama3-8b': 'local',
    'mistral:7b': 'local',
    'codellama': 'local',
    'phi-3': 'local',
    'qwen2': 'local',
};

/** Task type preference: which model tiers are best for each task */
const TASK_TIER_PREFERENCE: Record<string, readonly ModelTier[]> = {
    reasoning: ['flagship', 'strong', 'fast', 'local'],
    coding: ['flagship', 'strong', 'fast', 'local'],
    planning: ['flagship', 'strong', 'fast', 'local'],
    analysis: ['flagship', 'strong', 'fast', 'local'],
    conversation: ['fast', 'strong', 'flagship', 'local'], // cheap models first
};

const SURVIVAL_TIERS = ['high', 'normal', 'low', 'critical'] as const;
const TASK_TYPES = ['reasoning', 'coding', 'conversation', 'analysis', 'planning'] as const;

// ── Helper functions ────────────────────────────────────────────────────

/** Infer a model's capability tier from its ID or cost. */
function inferModelTier(model: ModelRow): ModelTier {
    // Check exact match first
    const id = model.id.replace(/^[^:]+:/, ''); // strip provider prefix like "cliproxyapi:"
    if (MODEL_TIER_MAP[id]) return MODEL_TIER_MAP[id];

    // Check partial name match
    for (const [pattern, tier] of Object.entries(MODEL_TIER_MAP)) {
        if (id.includes(pattern) || model.name.includes(pattern)) return tier;
    }

    // Infer from cost: expensive = flagship, cheap = fast, zero = depends on provider
    if (model.provider === 'ollama') return 'local';
    const totalCost = model.input_cost_micro + model.output_cost_micro;
    if (totalCost === 0) return 'strong'; // zero-cost proxy models default to strong
    if (totalCost > 10_000) return 'flagship'; // > $10/M tokens
    if (totalCost > 2_000) return 'strong';   // > $2/M tokens
    return 'fast';
}

/** Is this model zero-cost (subscription, local, proxy)? */
function isZeroCost(model: ModelRow): boolean {
    return model.input_cost_micro === 0 && model.output_cost_micro === 0;
}

/** Sort models for a given task type. */
function sortModelsForTask(models: readonly ModelRow[], taskType: string): ModelRow[] {
    const tierPreference = TASK_TIER_PREFERENCE[taskType] ?? TASK_TIER_PREFERENCE['conversation'];

    return [...models].sort((a, b) => {
        const aZero = isZeroCost(a);
        const bZero = isZeroCost(b);

        // Rule 1: Zero-cost always first
        if (aZero && !bZero) return -1;
        if (!aZero && bZero) return 1;

        const aTier = inferModelTier(a);
        const bTier = inferModelTier(b);

        // Rule 4: Local models always last within their cost group
        if (aTier === 'local' && bTier !== 'local') return 1;
        if (bTier === 'local' && aTier !== 'local') return -1;

        // Rule 2/3: Sort by tier preference for this task type
        const aIdx = tierPreference!.indexOf(aTier);
        const bIdx = tierPreference!.indexOf(bTier);
        if (aIdx !== bIdx) return aIdx - bIdx;

        // Tiebreaker: cheaper first within same tier
        const aCost = a.input_cost_micro + a.output_cost_micro;
        const bCost = b.input_cost_micro + b.output_cost_micro;
        return aCost - bCost;
    });
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Auto-generate a full routing matrix from user-selected models.
 *
 * @param selectedModels - Models the user has enabled (available=1)
 * @returns Routing entries ready to write to routing_config table
 */
export function autoGenerateRouting(selectedModels: readonly ModelRow[]): InsertRoutingEntry[] {
    if (selectedModels.length === 0) return [];

    const entries: InsertRoutingEntry[] = [];

    for (const tier of SURVIVAL_TIERS) {
        for (const taskType of TASK_TYPES) {
            const sorted = sortModelsForTask(selectedModels, taskType);

            sorted.forEach((model, index) => {
                entries.push({
                    tier,
                    taskType,
                    modelId: model.id,
                    priority: index,
                    isCustom: false,
                });
            });
        }
    }

    return entries;
}

/**
 * Get the survival tiers and task types available for routing.
 */
export function getRoutingDimensions() {
    return {
        tiers: [...SURVIVAL_TIERS],
        taskTypes: [...TASK_TYPES],
    };
}

/**
 * Get human-readable info about a model's classification.
 */
export function getModelClassification(model: ModelRow): {
    tier: ModelTier;
    isZeroCost: boolean;
    label: string;
} {
    const tier = inferModelTier(model);
    const zeroCost = isZeroCost(model);
    const labels: Record<ModelTier, string> = {
        flagship: '旗舰',
        strong: '高能力',
        fast: '快速/低成本',
        local: '本地',
    };
    return { tier, isZeroCost: zeroCost, label: labels[tier] };
}
