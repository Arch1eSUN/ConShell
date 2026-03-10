/**
 * Default model seed data.
 *
 * Pricing: microcents per million tokens (integer only).
 * Per ADR-003: Gemini models seeded with available: false.
 */
import type { UpsertModel } from '@web4-agent/state';

export const DEFAULT_MODEL_SEED: readonly UpsertModel[] = [
    // ── Anthropic ──────────────────────────────────────────────────────
    {
        id: 'anthropic:claude-sonnet-4-20250514',
        provider: 'anthropic',
        name: 'Claude Sonnet 4',
        inputCostMicro: 300_000,   // $3.00 per 1M tokens
        outputCostMicro: 1_500_000, // $15.00 per 1M tokens
        maxTokens: 200_000,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
        available: true,
    },
    {
        id: 'anthropic:claude-3-5-haiku-20241022',
        provider: 'anthropic',
        name: 'Claude 3.5 Haiku',
        inputCostMicro: 80_000,    // $0.80 per 1M tokens
        outputCostMicro: 400_000,  // $4.00 per 1M tokens
        maxTokens: 200_000,
        capabilities: ['coding', 'conversation', 'analysis'],
        available: true,
    },

    // ── OpenAI ─────────────────────────────────────────────────────────
    {
        id: 'openai:gpt-4o',
        provider: 'openai',
        name: 'GPT-4o',
        inputCostMicro: 250_000,   // $2.50 per 1M tokens
        outputCostMicro: 1_000_000, // $10.00 per 1M tokens
        maxTokens: 128_000,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
        available: true,
    },
    {
        id: 'openai:gpt-4o-mini',
        provider: 'openai',
        name: 'GPT-4o mini',
        inputCostMicro: 15_000,    // $0.15 per 1M tokens
        outputCostMicro: 60_000,   // $0.60 per 1M tokens
        maxTokens: 128_000,
        capabilities: ['coding', 'conversation'],
        available: true,
    },

    // ── Ollama (local, zero cost) ──────────────────────────────────────
    {
        id: 'ollama:llama3.1-8b',
        provider: 'ollama',
        name: 'Llama 3.1 8B',
        inputCostMicro: 0,
        outputCostMicro: 0,
        maxTokens: 8_192,
        capabilities: ['conversation'],
        available: true,
    },

    // ── Gemini (ADR-003: seeded as unavailable, stub only) ─────────────
    {
        id: 'gemini:gemini-pro',
        provider: 'gemini',
        name: 'Gemini Pro',
        inputCostMicro: 125_000,
        outputCostMicro: 375_000,
        maxTokens: 128_000,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation'],
        available: false,
    },
];
