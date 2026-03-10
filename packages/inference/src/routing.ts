/**
 * Routing Matrix — maps SurvivalTier × InferenceTaskType to ordered model preferences.
 *
 * Higher survival tiers get cheaper models. Critical tier uses local/free models only.
 */
import type { SurvivalTier, InferenceTaskType } from '@web4-agent/core';

export interface ModelPreference {
    /** Model ID (matches seed data) */
    readonly modelId: string;
    /** Maximum tokens to request */
    readonly maxTokens?: number;
}

/**
 * The static routing matrix. First viable model wins.
 */
const ROUTING_MATRIX: Record<SurvivalTier, Record<InferenceTaskType, readonly ModelPreference[]>> = {
    high: {
        reasoning: [
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
        ],
        coding: [
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
        ],
        analysis: [
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
        ],
        conversation: [
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
            { modelId: 'openai:gpt-4o-mini' },
        ],
        planning: [
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
        ],
    },
    normal: {
        reasoning: [
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
            { modelId: 'openai:gpt-4o-mini' },
        ],
        coding: [
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
        ],
        analysis: [
            { modelId: 'openai:gpt-4o' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
        ],
        conversation: [
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        planning: [
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
        ],
    },
    low: {
        reasoning: [
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        coding: [
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
        ],
        analysis: [
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        conversation: [
            { modelId: 'ollama:llama3.1-8b' },
            { modelId: 'openai:gpt-4o-mini' },
        ],
        planning: [
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
        ],
    },
    critical: {
        reasoning: [
            { modelId: 'ollama:llama3.1-8b' },
        ],
        coding: [
            { modelId: 'ollama:llama3.1-8b' },
        ],
        analysis: [
            { modelId: 'ollama:llama3.1-8b' },
        ],
        conversation: [
            { modelId: 'ollama:llama3.1-8b' },
        ],
        planning: [
            { modelId: 'ollama:llama3.1-8b' },
        ],
    },
};

/**
 * Get ordered model preferences for a given tier and task type.
 */
export function getModelPreferences(
    tier: SurvivalTier,
    taskType: InferenceTaskType,
): readonly ModelPreference[] {
    return ROUTING_MATRIX[tier][taskType];
}
