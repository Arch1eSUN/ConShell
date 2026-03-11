/**
 * Default model seed data.
 *
 * Pricing: microcents per million tokens (integer only).
 * Availability depends on API key presence — seeded as enabled.
 * OpenClaw sub-providers (Codex/Antigravity) are seeded as available.
 */
import type { UpsertModel } from '@conshell/state';

export const DEFAULT_MODEL_SEED: readonly UpsertModel[] = [
    // ── Ollama (local, zero cost) ──────────────────────────────────────
    {
        id: 'ollama:llama3.2',
        provider: 'ollama',
        name: 'Llama 3.2 3B',
        inputCostMicro: 0,
        outputCostMicro: 0,
        maxTokens: 8_192,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
        available: true,
    },
    {
        id: 'ollama:llama3.1-8b',
        provider: 'ollama',
        name: 'Llama 3.1 8B',
        inputCostMicro: 0,
        outputCostMicro: 0,
        maxTokens: 8_192,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
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

    // ── Gemini ─────────────────────────────────────────────────────────
    {
        id: 'gemini:gemini-2.0-flash',
        provider: 'gemini',
        name: 'Gemini 2.0 Flash',
        inputCostMicro: 10_000,    // $0.10 per 1M tokens
        outputCostMicro: 40_000,   // $0.40 per 1M tokens
        maxTokens: 1_000_000,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
        available: true,
    },
    {
        id: 'gemini:gemini-pro',
        provider: 'gemini',
        name: 'Gemini Pro',
        inputCostMicro: 125_000,   // $1.25 per 1M tokens
        outputCostMicro: 375_000,  // $3.75 per 1M tokens
        maxTokens: 128_000,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation'],
        available: true,
    },

    // ── OpenClaw (OAuth → digital lives) ───────────────────────────────
    {
        id: 'openclaw:codex',
        provider: 'openclaw',
        name: 'OpenClaw Codex',
        inputCostMicro: 0,         // Billed via OAuth/subscription
        outputCostMicro: 0,
        maxTokens: 128_000,
        capabilities: ['coding', 'reasoning', 'analysis', 'planning'],
        available: true,
    },
    {
        id: 'openclaw:antigravity',
        provider: 'openclaw',
        name: 'OpenClaw Antigravity',
        inputCostMicro: 0,         // Billed via OAuth/subscription
        outputCostMicro: 0,
        maxTokens: 200_000,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
        available: true,
    },

    // ── NVIDIA NIM ─────────────────────────────────────────────────────
    {
        id: 'nvidia:llama-3.1-nemotron-70b-instruct',
        provider: 'nvidia',
        name: 'Llama 3.1 Nemotron 70B',
        inputCostMicro: 200_000,   // $2.00 per 1M tokens
        outputCostMicro: 800_000,  // $8.00 per 1M tokens
        maxTokens: 128_000,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
        available: true,
    },
    {
        id: 'nvidia:mistral-nemo-12b',
        provider: 'nvidia',
        name: 'Mistral Nemo 12B',
        inputCostMicro: 30_000,    // $0.30 per 1M tokens
        outputCostMicro: 100_000,  // $1.00 per 1M tokens
        maxTokens: 128_000,
        capabilities: ['coding', 'conversation', 'analysis'],
        available: true,
    },

    // ── CLIProxyAPI (subscription/OAuth pool, zero marginal cost) ──────
    {
        id: 'cliproxyapi:claude-sonnet-4',
        provider: 'cliproxyapi',
        name: 'Claude Sonnet 4 (via Proxy)',
        inputCostMicro: 0,         // Billed via subscription/OAuth
        outputCostMicro: 0,
        maxTokens: 200_000,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
        available: true,
    },
    {
        id: 'cliproxyapi:gemini-2.5-pro',
        provider: 'cliproxyapi',
        name: 'Gemini 2.5 Pro (via Proxy)',
        inputCostMicro: 0,         // Billed via subscription/OAuth
        outputCostMicro: 0,
        maxTokens: 1_000_000,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
        available: true,
    },
    {
        id: 'cliproxyapi:gpt-4o',
        provider: 'cliproxyapi',
        name: 'GPT-4o (via Proxy)',
        inputCostMicro: 0,         // Billed via subscription/OAuth
        outputCostMicro: 0,
        maxTokens: 128_000,
        capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'],
        available: true,
    },
];
