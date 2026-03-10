/**
 * AppConfig — loads .env and auto-detects LLM providers.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY     — Anthropic Claude
 *   OPENAI_API_KEY        — OpenAI GPT
 *   GEMINI_API_KEY        — Google Gemini
 *   NVIDIA_API_KEY        — NVIDIA NIM
 *   OPENCLAW_OAUTH_TOKEN  — OpenClaw OAuth (Codex / Antigravity)
 *   OPENCLAW_ENDPOINT     — OpenClaw API endpoint (default: https://api.openclaw.com)
 *   OLLAMA_URL            — Local Ollama endpoint (default: http://localhost:11434)
 *   AGENT_NAME            — Agent display name
 *   GENESIS_PROMPT        — Initial system prompt
 *   PORT                  — HTTP server port (default: 4200)
 *   DB_PATH               — SQLite database path (default: ./state.db)
 *   LOG_LEVEL             — Logging level (default: info)
 *   WALLET_PRIVATE_KEY    — Wallet private key (auto-generated on first run)
 *   DAILY_BUDGET_CENTS    — Daily inference budget in cents (default: 5000)
 */
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import type { InferenceAuthType } from '@web4-agent/core';

// ── Types ───────────────────────────────────────────────────────────────

export interface LlmProviderConfig {
    readonly name: string;
    readonly authType: InferenceAuthType;
    readonly available: boolean;
    readonly endpoint?: string;
    readonly apiKey?: string;
    readonly oauthToken?: string;
}

export interface AppConfig {
    // Agent identity
    readonly agentName: string;
    readonly genesisPrompt: string;

    // Server
    readonly port: number;
    readonly dbPath: string;
    readonly logLevel: string;
    readonly agentHome: string;

    // Wallet
    readonly walletPrivateKey?: string;

    // LLM providers (auto-detected)
    readonly providers: readonly LlmProviderConfig[];

    // Budget
    readonly dailyBudgetCents: number;
}

// ── Provider detection ──────────────────────────────────────────────────

function detectProviders(): LlmProviderConfig[] {
    const providers: LlmProviderConfig[] = [];

    // Ollama (local, always assumed available)
    const ollamaUrl = process.env['OLLAMA_URL'] || 'http://localhost:11434';
    providers.push({
        name: 'ollama',
        authType: 'local',
        available: true,
        endpoint: ollamaUrl,
    });

    // OpenAI
    const openaiKey = process.env['OPENAI_API_KEY'];
    providers.push({
        name: 'openai',
        authType: 'apiKey',
        available: !!openaiKey,
        apiKey: openaiKey,
    });

    // Anthropic
    const anthropicKey = process.env['ANTHROPIC_API_KEY'];
    providers.push({
        name: 'anthropic',
        authType: 'apiKey',
        available: !!anthropicKey,
        apiKey: anthropicKey,
    });

    // Gemini
    const geminiKey = process.env['GEMINI_API_KEY'];
    providers.push({
        name: 'gemini',
        authType: 'apiKey',
        available: !!geminiKey,
        apiKey: geminiKey,
    });

    // OpenClaw (OAuth → Codex / Antigravity)
    const openclawToken = process.env['OPENCLAW_OAUTH_TOKEN'];
    const openclawEndpoint = process.env['OPENCLAW_ENDPOINT'] || 'https://api.openclaw.com';
    providers.push({
        name: 'openclaw',
        authType: 'oauth',
        available: !!openclawToken,
        endpoint: openclawEndpoint,
        oauthToken: openclawToken,
    });

    // NVIDIA NIM
    const nvidiaKey = process.env['NVIDIA_API_KEY'];
    providers.push({
        name: 'nvidia',
        authType: 'apiKey',
        available: !!nvidiaKey,
        apiKey: nvidiaKey,
    });

    // CLIProxyAPI (subscription/OAuth proxy gateway)
    const cliproxyapiKey = process.env['CLIPROXYAPI_API_KEY'];
    const cliproxyapiUrl = process.env['CLIPROXYAPI_BASE_URL'] || 'http://localhost:8317';
    const cliproxyapiEnabled = process.env['CLIPROXYAPI_ENABLED'] !== 'false';
    providers.push({
        name: 'cliproxyapi',
        authType: 'proxy' as import('@web4-agent/core').InferenceAuthType,
        available: !!cliproxyapiKey && cliproxyapiEnabled,
        endpoint: cliproxyapiUrl,
        apiKey: cliproxyapiKey,
    });

    return providers;
}

// ── Load config ─────────────────────────────────────────────────────────

export function loadConfig(envPath?: string): AppConfig {
    // Load .env file
    loadDotenv({ path: envPath ?? resolve(process.cwd(), '.env') });

    const agentHome = process.env['AGENT_HOME'] || process.cwd();
    const providers = detectProviders();

    return {
        agentName: process.env['AGENT_NAME'] || 'conway-automaton',
        genesisPrompt: process.env['GENESIS_PROMPT'] || 'You are a sovereign AI agent.',
        port: parseInt(process.env['PORT'] || '4200', 10),
        dbPath: process.env['DB_PATH'] || resolve(agentHome, 'state.db'),
        logLevel: process.env['LOG_LEVEL'] || 'info',
        agentHome,
        walletPrivateKey: process.env['WALLET_PRIVATE_KEY'],
        providers,
        dailyBudgetCents: parseInt(process.env['DAILY_BUDGET_CENTS'] || '5000', 10),
    };
}

/**
 * Pretty-print detected providers.
 */
export function formatProviderStatus(config: AppConfig): string {
    const lines = config.providers
        .filter(p => p.available)
        .map(p => {
            const auth = p.authType === 'local' ? '' : ` [${p.authType}]`;
            const ep = p.endpoint ? ` (${p.endpoint})` : '';
            return `  ✓ ${p.name}${auth}${ep}`;
        });

    if (lines.length === 0) {
        return '  ⚠ No LLM providers configured. Add API keys to .env';
    }
    return lines.join('\n');
}
