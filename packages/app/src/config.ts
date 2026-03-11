/**
 * AppConfig — hybrid loader: ~/.conshell/config.json → .env → defaults.
 *
 * Precedence (highest wins):
 *   1. Environment variables / .env file
 *   2. ~/.conshell/config.json (created by `conshell init`)
 *   3. Hard-coded defaults
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
import { readFileSync } from 'node:fs';
import type { InferenceAuthType } from '@conshell/core';

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

    // Security
    readonly securityLevel: import('@conshell/core').SecurityTier;
    readonly authMode: 'none' | 'token' | 'password';
    readonly authSecret?: string;

    // Identity (populated at runtime from wallet)
    readonly walletAddress?: string;
}

// ── Provider detection ──────────────────────────────────────────────────

function detectProviders(json: Record<string, unknown>): LlmProviderConfig[] {
    const providers: LlmProviderConfig[] = [];

    // Helper: env var > config.json value > default
    const get = (envKey: string, jsonKey?: string, fallback?: string): string | undefined =>
        process.env[envKey] || (json[jsonKey ?? envKey] as string | undefined) || fallback;

    // Ollama (local, always assumed available)
    const ollamaUrl = get('OLLAMA_URL', 'ollamaUrl', 'http://localhost:11434')!;
    providers.push({
        name: 'ollama',
        authType: 'local',
        available: true,
        endpoint: ollamaUrl,
    });

    // OpenAI
    const openaiKey = get('OPENAI_API_KEY');
    providers.push({
        name: 'openai',
        authType: 'apiKey',
        available: !!openaiKey,
        apiKey: openaiKey,
    });

    // Anthropic
    const anthropicKey = get('ANTHROPIC_API_KEY');
    providers.push({
        name: 'anthropic',
        authType: 'apiKey',
        available: !!anthropicKey,
        apiKey: anthropicKey,
    });

    // Gemini
    const geminiKey = get('GEMINI_API_KEY');
    providers.push({
        name: 'gemini',
        authType: 'apiKey',
        available: !!geminiKey,
        apiKey: geminiKey,
    });

    // OpenClaw (OAuth → Codex / Antigravity)
    const openclawToken = get('OPENCLAW_OAUTH_TOKEN');
    const openclawEndpoint = get('OPENCLAW_ENDPOINT', undefined, 'https://api.openclaw.com')!;
    providers.push({
        name: 'openclaw',
        authType: 'oauth',
        available: !!openclawToken,
        endpoint: openclawEndpoint,
        oauthToken: openclawToken,
    });

    // NVIDIA NIM
    const nvidiaKey = get('NVIDIA_API_KEY');
    providers.push({
        name: 'nvidia',
        authType: 'apiKey',
        available: !!nvidiaKey,
        apiKey: nvidiaKey,
    });

    // CLIProxyAPI (subscription/OAuth proxy gateway)
    const cliproxyapiKey = get('CLIPROXYAPI_API_KEY');
    const cliproxyapiUrl = get('CLIPROXYAPI_BASE_URL', undefined, 'http://localhost:8317')!;
    const cliproxyapiEnabled = get('CLIPROXYAPI_ENABLED') !== 'false';
    providers.push({
        name: 'cliproxyapi',
        authType: 'proxy' as import('@conshell/core').InferenceAuthType,
        available: !!cliproxyapiKey && cliproxyapiEnabled,
        endpoint: cliproxyapiUrl,
        apiKey: cliproxyapiKey,
    });

    return providers;
}

// ── Config JSON loader ──────────────────────────────────────────────────

function loadConfigJson(): Record<string, unknown> {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
    const configPath = resolve(home, '.conshell', 'config.json');
    try {
        const data = readFileSync(configPath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

// ── Load config ─────────────────────────────────────────────────────────

export function loadConfig(envPath?: string): AppConfig {
    // Load .env file
    loadDotenv({ path: envPath ?? resolve(process.cwd(), '.env') });

    // Load ~/.conshell/config.json (created by `conshell init`)
    const json = loadConfigJson();

    const agentHome = process.env['AGENT_HOME'] || (json.agentHome as string | undefined) || process.cwd();
    const providers = detectProviders(json);

    const authMode = (process.env['CONSHELL_AUTH_MODE'] || (json.authMode as string | undefined) || 'none') as 'none' | 'token' | 'password';

    return {
        agentName: process.env['AGENT_NAME'] || (json.agentName as string | undefined) || 'ConShell Agent',
        genesisPrompt: process.env['GENESIS_PROMPT'] || (json.genesisPrompt as string | undefined) || 'You are a sovereign AI agent.',
        port: parseInt(process.env['PORT'] || String(json.port ?? 4200), 10),
        dbPath: process.env['DB_PATH'] || (json.dbPath as string | undefined) || resolve(agentHome, 'state.db'),
        logLevel: process.env['LOG_LEVEL'] || (json.logLevel as string | undefined) || 'info',
        agentHome,
        walletPrivateKey: process.env['WALLET_PRIVATE_KEY'],
        providers,
        dailyBudgetCents: parseInt(process.env['DAILY_BUDGET_CENTS'] || String(json.dailyBudgetCents ?? 5000), 10),
        securityLevel: ((json.securityLevel as string | undefined) || 'standard') as import('@conshell/core').SecurityTier,
        authMode,
        authSecret: process.env['CONSHELL_AUTH_SECRET'] || (json.authSecret as string | undefined),
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
