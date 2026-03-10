/**
 * AutomatonConfig — the runtime configuration loaded from automaton.json.
 * All financial values are integer Cents.
 */
import { z } from 'zod';
import type { Cents } from '../money/money.js';
import type {
    ComputeMode,
    InferenceProvider,
    McpTransport,
} from './common.js';

// ── Treasury Policy ────────────────────────────────────────────────────

export interface TreasuryPolicy {
    /** Maximum single payment in cents (default: 100_000 = $1000) */
    readonly maxPaymentCents: Cents;
    /** Hourly transfer cap in cents */
    readonly hourlyTransferCapCents: Cents;
    /** Daily transfer cap in cents */
    readonly dailyTransferCapCents: Cents;
    /** Minimum reserve — never drop below this (default: 100 = $1.00) */
    readonly minimumReserveCents: Cents;
    /** Daily inference budget in cents */
    readonly inferenceDailyBudgetCents: Cents;
    /** Domains allowed for x402 fetch */
    readonly x402DomainAllowlist: readonly string[];
    /** Topup tiers enabled */
    readonly topupTiersCents: readonly Cents[];
}

// ── Model Strategy ─────────────────────────────────────────────────────

export interface ModelStrategy {
    /** Default provider */
    readonly defaultProvider: InferenceProvider;
    /** API keys by provider (never logged, never exposed via tools) */
    readonly apiKeys: Readonly<Partial<Record<InferenceProvider, string>>>;
    /** Model preferences by task type (provider-specific model IDs) */
    readonly preferences: Readonly<Record<string, readonly string[]>>;
}

// ── MCP Config ─────────────────────────────────────────────────────────

export interface McpConfig {
    /** Whether MCP gateway is enabled */
    readonly enabled: boolean;
    /** Transport type */
    readonly transport: McpTransport;
    /** HTTP port (only used when transport is 'http') */
    readonly httpPort: number;
    /** Tools exposure: list of additional caution-level tools to expose */
    readonly allowedCautionTools: readonly string[];
    /** Whether x402 payment gating is enabled for MCP */
    readonly x402Gating: boolean;
}

// ── Replication Config ─────────────────────────────────────────────────

export interface ReplicationConfig {
    /** Maximum number of children */
    readonly maxChildren: number;
    /** Minimum funding for children in cents */
    readonly minChildFundingCents: Cents;
}

// ── Self-modification Config ───────────────────────────────────────────

export interface SelfModConfig {
    /** Maximum self-modifications per hour */
    readonly maxSelfModPerHour: number;
    /** Maximum tool calls per turn */
    readonly maxToolCallsPerTurn: number;
    /** Maximum dangerous operations per session */
    readonly maxDangerousPerSession: number;
    /** Maximum exec calls per hour */
    readonly maxExecPerHour: number;
    /** Allowed NPM registries */
    readonly allowedRegistries: readonly string[];
}

// ── Root Config ────────────────────────────────────────────────────────

export interface AutomatonConfig {
    /** Agent display name */
    readonly name: string;
    /** Genesis prompt (seed instruction) */
    readonly genesisPrompt: string;
    /** Creator's Ethereum address (optional) */
    readonly creatorAddress?: string;
    /** Compute mode (docker or local) */
    readonly computeMode: ComputeMode;
    /** Log level */
    readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
    /** Treasury policy */
    readonly treasury: TreasuryPolicy;
    /** Model/inference strategy */
    readonly model: ModelStrategy;
    /** MCP gateway config */
    readonly mcp: McpConfig;
    /** Replication config */
    readonly replication: ReplicationConfig;
    /** Self-modification config */
    readonly selfMod: SelfModConfig;
    /** Git remote URL for upstream sync (optional) */
    readonly gitRemoteUrl?: string;
}

// ── Zod Schema for Runtime Validation ──────────────────────────────────

const intCents = z.number().int();

export const treasuryPolicySchema = z.object({
    maxPaymentCents: intCents.default(100_000),
    hourlyTransferCapCents: intCents.default(500_000),
    dailyTransferCapCents: intCents.default(1_000_000),
    minimumReserveCents: intCents.default(100),
    inferenceDailyBudgetCents: intCents.default(50_000),
    x402DomainAllowlist: z.array(z.string()).default([]),
    topupTiersCents: z.array(intCents).default([500, 2_500, 10_000, 50_000, 100_000, 250_000]),
});

export const modelStrategySchema = z.object({
    defaultProvider: z.enum(['anthropic', 'openai', 'ollama', 'gemini']).default('anthropic'),
    apiKeys: z.record(z.string()).default({}),
    preferences: z.record(z.array(z.string())).default({}),
});

export const mcpConfigSchema = z.object({
    enabled: z.boolean().default(false),
    transport: z.enum(['stdio', 'http']).default('stdio'),
    httpPort: z.number().int().min(1024).max(65535).default(3402),
    allowedCautionTools: z.array(z.string()).default([]),
    x402Gating: z.boolean().default(false),
});

export const replicationConfigSchema = z.object({
    maxChildren: z.number().int().min(0).max(10).default(3),
    minChildFundingCents: intCents.min(0).default(500),
});

export const selfModConfigSchema = z.object({
    maxSelfModPerHour: z.number().int().min(1).default(10),
    maxToolCallsPerTurn: z.number().int().min(1).default(20),
    maxDangerousPerSession: z.number().int().min(1).default(50),
    maxExecPerHour: z.number().int().min(1).default(100),
    allowedRegistries: z.array(z.string()).default(['https://registry.npmjs.org']),
});

export const automatonConfigSchema = z.object({
    name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/i, 'Name must be alphanumeric with hyphens'),
    genesisPrompt: z.string().min(1).max(10_240),
    creatorAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    computeMode: z.enum(['docker', 'local']).default('docker'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    treasury: treasuryPolicySchema.default({}),
    model: modelStrategySchema.default({}),
    mcp: mcpConfigSchema.default({}),
    replication: replicationConfigSchema.default({}),
    selfMod: selfModConfigSchema.default({}),
    gitRemoteUrl: z.string().url().optional(),
});

export type AutomatonConfigInput = z.input<typeof automatonConfigSchema>;
