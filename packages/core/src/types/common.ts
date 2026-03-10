/**
 * Common enums and utility types shared across all web4-agent modules.
 */

// ── Lifecycle ──────────────────────────────────────────────────────────

export type AgentState =
    | 'setup'
    | 'waking'
    | 'running'
    | 'sleeping'
    | 'low_compute'
    | 'critical'
    | 'recovering'
    | 'dead';

export type SurvivalTier = 'critical' | 'low' | 'normal' | 'high';

// ── Authority & Risk ───────────────────────────────────────────────────

export type AuthorityLevel = 'creator' | 'self' | 'peer' | 'external';

export type RiskLevel = 'safe' | 'caution' | 'dangerous' | 'forbidden';

// ── Tool Metadata ──────────────────────────────────────────────────────

export type ToolCategory =
    | 'vm'
    | 'financial'
    | 'self_mod'
    | 'survival'
    | 'memory'
    | 'replication'
    | 'git'
    | 'registry'
    | 'skills'
    | 'diagnostics';

export type ToolSource = 'agent' | 'mcp' | 'heartbeat';

// ── Compute ────────────────────────────────────────────────────────────

export type ComputeMode = 'docker' | 'local';

// ── Financial ──────────────────────────────────────────────────────────

export type TransactionType =
    | 'topup'
    | 'transfer'
    | 'x402_payment'
    | 'child_funding';

export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export type SpendType =
    | 'inference'
    | 'transfer'
    | 'x402'
    | 'topup'
    | 'child_funding';

// ── Inference ──────────────────────────────────────────────────────────

export type InferenceProvider = 'anthropic' | 'openai' | 'ollama' | 'gemini';

export type InferenceTaskType =
    | 'reasoning'
    | 'coding'
    | 'conversation'
    | 'analysis'
    | 'planning';

// ── Memory ─────────────────────────────────────────────────────────────

export type MemoryTier =
    | 'working'
    | 'episodic'
    | 'semantic'
    | 'procedural'
    | 'relationship';

export type WorkingMemoryType = 'goal' | 'observation' | 'plan' | 'reflection';

export type SemanticCategory =
    | 'self'
    | 'environment'
    | 'financial'
    | 'agent'
    | 'domain';

export type EntityType = 'agent' | 'human' | 'service';

// ── Replication ────────────────────────────────────────────────────────

export type ChildLifecycleState =
    | 'spawning'
    | 'provisioning'
    | 'configuring'
    | 'starting'
    | 'alive'
    | 'unhealthy'
    | 'recovering'
    | 'dead';

export type ChildMessageType =
    | 'instruction'
    | 'status'
    | 'request'
    | 'response';

// ── Self-modification ──────────────────────────────────────────────────

export type ModificationType =
    | 'file_edit'
    | 'package_install'
    | 'mcp_install'
    | 'upstream_pull'
    | 'config_change'
    | 'skill_create'
    | 'rollback';

// ── MCP ────────────────────────────────────────────────────────────────

export type McpTransport = 'stdio' | 'http';

// ── Messages ───────────────────────────────────────────────────────────

export type InboxMessageState =
    | 'received'
    | 'in_progress'
    | 'processed'
    | 'failed';

// ── Heartbeat ──────────────────────────────────────────────────────────

export type HeartbeatResult = 'success' | 'failure' | 'skipped';

// ── Utility Types ──────────────────────────────────────────────────────

/** ISO 8601 timestamp string. Used for DB columns and serialization. */
export type ISOTimestamp = string & { readonly __brand: 'ISOTimestamp' };

/** Create an ISOTimestamp from the current time. */
export function nowISO(): ISOTimestamp {
    return new Date().toISOString() as ISOTimestamp;
}

/** Create an ISOTimestamp from a Date. */
export function toISO(date: Date): ISOTimestamp {
    return date.toISOString() as ISOTimestamp;
}

/** Ethereum address (0x-prefixed, 42 characters). */
export type EthAddress = `0x${string}`;

/** Validate that a string is a well-formed Ethereum address. */
export function isValidEthAddress(value: string): value is EthAddress {
    return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** SHA-256 hex hash string. */
export type SHA256Hash = string & { readonly __brand: 'SHA256Hash' };

/** UUID string. */
export type UUID = string & { readonly __brand: 'UUID' };

/** CAIP-2 network identifier (e.g., "eip155:8453" for Base). */
export type CAIP2NetworkId = string & { readonly __brand: 'CAIP2NetworkId' };

/** Base network CAIP-2 identifier. */
export const BASE_MAINNET: CAIP2NetworkId = 'eip155:8453' as CAIP2NetworkId;
export const BASE_SEPOLIA: CAIP2NetworkId = 'eip155:84532' as CAIP2NetworkId;
