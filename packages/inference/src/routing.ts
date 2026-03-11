/**
 * Routing Matrix — maps SurvivalTier × InferenceTaskType to ordered model preferences.
 *
 * Higher survival tiers get cheaper models. Critical tier uses local/free models only.
 *
 * Provider hierarchy:
 *   cliproxyapi → subscription/OAuth pool (zero marginal cost)
 *   ollama    → local, zero cost
 *   openai    → API key
 *   anthropic → API key
 *   gemini    → API key
 *   openclaw  → OAuth (Codex / Antigravity)
 *   nvidia    → API key
 */
import type { SurvivalTier, InferenceTaskType } from '@conshell/core';

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
            { modelId: 'cliproxyapi:claude-sonnet-4' },
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'openclaw:antigravity' },
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
            { modelId: 'nvidia:llama-3.1-nemotron-70b-instruct' },
            { modelId: 'gemini:gemini-pro' },
            { modelId: 'ollama:llama3.2' },
        ],
        coding: [
            { modelId: 'cliproxyapi:claude-sonnet-4' },
            { modelId: 'cliproxyapi:gpt-4o' },
            { modelId: 'openclaw:codex' },
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
            { modelId: 'nvidia:llama-3.1-nemotron-70b-instruct' },
            { modelId: 'gemini:gemini-pro' },
            { modelId: 'ollama:llama3.2' },
        ],
        analysis: [
            { modelId: 'cliproxyapi:claude-sonnet-4' },
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'openclaw:antigravity' },
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
            { modelId: 'gemini:gemini-pro' },
            { modelId: 'nvidia:llama-3.1-nemotron-70b-instruct' },
            { modelId: 'ollama:llama3.2' },
        ],
        conversation: [
            { modelId: 'cliproxyapi:claude-sonnet-4' },
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'gemini:gemini-2.0-flash' },
            { modelId: 'nvidia:mistral-nemo-12b' },
            { modelId: 'ollama:llama3.2' },
        ],
        planning: [
            { modelId: 'cliproxyapi:claude-sonnet-4' },
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'openclaw:antigravity' },
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
            { modelId: 'nvidia:llama-3.1-nemotron-70b-instruct' },
            { modelId: 'gemini:gemini-pro' },
            { modelId: 'ollama:llama3.2' },
        ],
    },
    normal: {
        reasoning: [
            { modelId: 'cliproxyapi:claude-sonnet-4' },
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
            { modelId: 'gemini:gemini-pro' },
            { modelId: 'nvidia:llama-3.1-nemotron-70b-instruct' },
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'gemini:gemini-2.0-flash' },
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        coding: [
            { modelId: 'cliproxyapi:claude-sonnet-4' },
            { modelId: 'cliproxyapi:gpt-4o' },
            { modelId: 'openclaw:codex' },
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
            { modelId: 'nvidia:llama-3.1-nemotron-70b-instruct' },
            { modelId: 'gemini:gemini-pro' },
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        analysis: [
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'cliproxyapi:claude-sonnet-4' },
            { modelId: 'openai:gpt-4o' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
            { modelId: 'gemini:gemini-pro' },
            { modelId: 'nvidia:llama-3.1-nemotron-70b-instruct' },
            { modelId: 'gemini:gemini-2.0-flash' },
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        conversation: [
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
            { modelId: 'gemini:gemini-2.0-flash' },
            { modelId: 'nvidia:mistral-nemo-12b' },
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        planning: [
            { modelId: 'cliproxyapi:claude-sonnet-4' },
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'anthropic:claude-sonnet-4-20250514' },
            { modelId: 'openai:gpt-4o' },
            { modelId: 'gemini:gemini-pro' },
            { modelId: 'nvidia:llama-3.1-nemotron-70b-instruct' },
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
    },
    low: {
        reasoning: [
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'gemini:gemini-2.0-flash' },
            { modelId: 'nvidia:mistral-nemo-12b' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        coding: [
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'gemini:gemini-2.0-flash' },
            { modelId: 'nvidia:mistral-nemo-12b' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        analysis: [
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'gemini:gemini-2.0-flash' },
            { modelId: 'nvidia:mistral-nemo-12b' },
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        conversation: [
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'gemini:gemini-2.0-flash' },
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
            { modelId: 'nvidia:mistral-nemo-12b' },
            { modelId: 'openai:gpt-4o-mini' },
        ],
        planning: [
            { modelId: 'cliproxyapi:gemini-2.5-pro' },
            { modelId: 'openai:gpt-4o-mini' },
            { modelId: 'gemini:gemini-2.0-flash' },
            { modelId: 'nvidia:mistral-nemo-12b' },
            { modelId: 'anthropic:claude-3-5-haiku-20241022' },
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
    },
    critical: {
        reasoning: [
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        coding: [
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        analysis: [
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        conversation: [
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
        planning: [
            { modelId: 'ollama:llama3.2' },
            { modelId: 'ollama:llama3.1-8b' },
        ],
    },
    emergency: {
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
