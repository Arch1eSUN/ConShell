/**
 * Error hierarchy for web4-agent.
 *
 * All errors extend Web4Error which carries a machine-readable `code`.
 * Modules define domain errors by extending the appropriate category class.
 */

export class Web4Error extends Error {
    /** Machine-readable error code (e.g. "CONFIG_NOT_FOUND") */
    readonly code: string;

    constructor(code: string, message: string, cause?: Error) {
        super(message, { cause });
        this.name = this.constructor.name;
        this.code = code;
        // Fix prototype chain for instanceof checks
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ── Config Errors ──────────────────────────────────────────────────────

export class ConfigNotFoundError extends Web4Error {
    constructor(path: string) {
        super('CONFIG_NOT_FOUND', `Configuration file not found: ${path}`);
    }
}

export class ConfigValidationError extends Web4Error {
    readonly validationErrors: readonly string[];

    constructor(errors: readonly string[]) {
        super('CONFIG_VALIDATION', `Configuration validation failed:\n${errors.join('\n')}`);
        this.validationErrors = errors;
    }
}

export class SchemaVersionError extends Web4Error {
    constructor(expected: number, actual: number) {
        super(
            'SCHEMA_VERSION',
            `Schema version mismatch: expected ${expected}, got ${actual}`,
        );
    }
}

// ── Database Errors ────────────────────────────────────────────────────

export class MigrationError extends Web4Error {
    constructor(version: number, cause?: Error) {
        super('MIGRATION_FAILED', `Migration to v${version} failed`, cause);
    }
}

export class DatabaseCorruptionError extends Web4Error {
    constructor(detail: string) {
        super('DB_CORRUPTION', `Database corruption detected: ${detail}`);
    }
}

export class QueryError extends Web4Error {
    constructor(query: string, cause?: Error) {
        super('QUERY_FAILED', `Query failed: ${query}`, cause);
    }
}

// ── Policy Errors ──────────────────────────────────────────────────────

export class PolicyEvaluationError extends Web4Error {
    constructor(toolName: string, cause?: Error) {
        super(
            'POLICY_EVALUATION',
            `Policy evaluation failed for tool: ${toolName}`,
            cause,
        );
    }
}

// ── Financial Errors ───────────────────────────────────────────────────

export class SpendRecordError extends Web4Error {
    constructor(cause?: Error) {
        super('SPEND_RECORD', 'Failed to record spend entry', cause);
    }
}

export class PaymentRequiredError extends Web4Error {
    constructor(url: string) {
        super('PAYMENT_REQUIRED', `Payment required for: ${url}`);
    }
}

export class UnsupportedSchemeError extends Web4Error {
    constructor(scheme: string) {
        super('UNSUPPORTED_SCHEME', `Unsupported payment scheme: ${scheme}`);
    }
}

export class SigningError extends Web4Error {
    constructor(detail: string, cause?: Error) {
        super('SIGNING_FAILED', `Signing failed: ${detail}`, cause);
    }
}

export class PaymentRejectedError extends Web4Error {
    constructor(reason: string) {
        super('PAYMENT_REJECTED', `Payment rejected: ${reason}`);
    }
}

export class PaymentAmountExceededError extends Web4Error {
    constructor(requestedCents: number, maxCents: number) {
        super(
            'PAYMENT_AMOUNT_EXCEEDED',
            `Payment amount ${requestedCents} cents exceeds cap of ${maxCents} cents`,
        );
    }
}

export class InferenceBudgetExceededError extends Web4Error {
    constructor(budgetCents: number, currentCents: number) {
        super(
            'INFERENCE_BUDGET_EXCEEDED',
            `Inference budget exceeded: ${currentCents}/${budgetCents} cents`,
        );
    }
}

// ── Facilitator Errors ─────────────────────────────────────────────────

export class FacilitatorNetworkError extends Web4Error {
    constructor(url: string, cause?: Error) {
        super('FACILITATOR_NETWORK', `Facilitator unreachable at: ${url}`, cause);
    }
}

export class FacilitatorRejectionError extends Web4Error {
    constructor(reason: string) {
        super('FACILITATOR_REJECTION', `Facilitator rejected: ${reason}`);
    }
}

export class VerificationFailedError extends Web4Error {
    constructor(reason: string) {
        super('VERIFICATION_FAILED', `Payment verification failed: ${reason}`);
    }
}

export class SettlementFailedError extends Web4Error {
    constructor(reason: string) {
        super('SETTLEMENT_FAILED', `Payment settlement failed: ${reason}`);
    }
}

// ── Wallet/Identity Errors ─────────────────────────────────────────────

export class WalletNotFoundError extends Web4Error {
    constructor(path: string) {
        super('WALLET_NOT_FOUND', `Wallet file not found: ${path}`);
    }
}

export class WalletCorruptedError extends Web4Error {
    constructor(detail: string) {
        super('WALLET_CORRUPTED', `Wallet file corrupted: ${detail}`);
    }
}

// ── Inference Errors ───────────────────────────────────────────────────

export class NoViableModelError extends Web4Error {
    constructor(taskType: string, tier: string) {
        super(
            'NO_VIABLE_MODEL',
            `No viable model for task "${taskType}" at tier "${tier}"`,
        );
    }
}

export class ProviderError extends Web4Error {
    constructor(provider: string, detail: string, cause?: Error) {
        super('PROVIDER_ERROR', `Provider "${provider}" error: ${detail}`, cause);
    }
}

export class ProviderNotImplementedError extends Web4Error {
    constructor(provider: string) {
        super(
            'PROVIDER_NOT_IMPLEMENTED',
            `Provider "${provider}" is a stub and not available in v1`,
        );
    }
}

export class InferenceTimeoutError extends Web4Error {
    constructor(model: string, timeoutMs: number) {
        super(
            'INFERENCE_TIMEOUT',
            `Inference timed out for model "${model}" after ${timeoutMs}ms`,
        );
    }
}

// ── Tool Errors ────────────────────────────────────────────────────────

export class ToolNotFoundError extends Web4Error {
    constructor(name: string) {
        super('TOOL_NOT_FOUND', `Tool not found: ${name}`);
    }
}

export class ToolExecutionError extends Web4Error {
    constructor(name: string, detail: string, cause?: Error) {
        super('TOOL_EXECUTION', `Tool "${name}" execution failed: ${detail}`, cause);
    }
}

export class ToolDeniedError extends Web4Error {
    readonly ruleName: string;
    readonly ruleCategory: string;

    constructor(toolName: string, ruleName: string, ruleCategory: string, reason: string) {
        super('TOOL_DENIED', `Tool "${toolName}" denied by ${ruleCategory}/${ruleName}: ${reason}`);
        this.ruleName = ruleName;
        this.ruleCategory = ruleCategory;
    }
}

// ── Self-modification Errors ───────────────────────────────────────────

export class ProtectedFileError extends Web4Error {
    constructor(path: string) {
        super('PROTECTED_FILE', `File is protected and cannot be modified: ${path}`);
    }
}

export class RateLimitExceededError extends Web4Error {
    constructor(category: string, limit: number, window: string) {
        super(
            'RATE_LIMIT_EXCEEDED',
            `Rate limit exceeded for ${category}: ${limit} per ${window}`,
        );
    }
}

export class GitCommitError extends Web4Error {
    constructor(detail: string, cause?: Error) {
        super('GIT_COMMIT', `Git commit failed: ${detail}`, cause);
    }
}

export class PackageInstallError extends Web4Error {
    constructor(packageName: string, detail: string, cause?: Error) {
        super(
            'PACKAGE_INSTALL',
            `Package install failed for "${packageName}": ${detail}`,
            cause,
        );
    }
}

// ── Replication Errors ─────────────────────────────────────────────────

export class MaxChildrenExceededError extends Web4Error {
    constructor(max: number) {
        super('MAX_CHILDREN_EXCEEDED', `Maximum children limit reached: ${max}`);
    }
}

export class InvalidTransitionError extends Web4Error {
    constructor(from: string, to: string) {
        super(
            'INVALID_TRANSITION',
            `Invalid lifecycle transition: ${from} → ${to}`,
        );
    }
}

export class ConstitutionMismatchError extends Web4Error {
    constructor(expected: string, actual: string) {
        super(
            'CONSTITUTION_MISMATCH',
            `Constitution hash mismatch: expected ${expected}, got ${actual}`,
        );
    }
}

export class SpawnFailedError extends Web4Error {
    constructor(childName: string, detail: string, cause?: Error) {
        super('SPAWN_FAILED', `Failed to spawn child "${childName}": ${detail}`, cause);
    }
}

// ── Compute Errors ─────────────────────────────────────────────────────

export class CommandTimeoutError extends Web4Error {
    constructor(command: string, timeoutMs: number) {
        super(
            'COMMAND_TIMEOUT',
            `Command timed out after ${timeoutMs}ms: ${command}`,
        );
    }
}

export class FileAccessError extends Web4Error {
    constructor(path: string, operation: 'read' | 'write', cause?: Error) {
        super('FILE_ACCESS', `File ${operation} failed: ${path}`, cause);
    }
}

export class SandboxNotFoundError extends Web4Error {
    constructor(sandboxId: string) {
        super('SANDBOX_NOT_FOUND', `Sandbox not found: ${sandboxId}`);
    }
}

export class DockerNotAvailableError extends Web4Error {
    constructor(cause?: Error) {
        super('DOCKER_NOT_AVAILABLE', 'Docker is not available on this system', cause);
    }
}

// ── MCP Errors ─────────────────────────────────────────────────────────

export class McpProtocolError extends Web4Error {
    constructor(detail: string) {
        super('MCP_PROTOCOL', `MCP protocol error: ${detail}`);
    }
}

export class McpSessionExpiredError extends Web4Error {
    constructor(sessionId: string) {
        super('MCP_SESSION_EXPIRED', `MCP session expired: ${sessionId}`);
    }
}

export class McpToolDeniedError extends Web4Error {
    constructor(toolName: string, reason: string) {
        super('MCP_TOOL_DENIED', `MCP tool denied "${toolName}": ${reason}`);
    }
}

// ── Memory Errors ──────────────────────────────────────────────────────

export class MemoryBudgetExceededError extends Web4Error {
    constructor(budgetTokens: number) {
        super('MEMORY_BUDGET_EXCEEDED', `Memory budget exceeded: ${budgetTokens} tokens`);
    }
}

export class IngestionError extends Web4Error {
    constructor(detail: string, cause?: Error) {
        super('INGESTION_FAILED', `Memory ingestion failed: ${detail}`, cause);
    }
}

// ── Soul / Constitution Errors ─────────────────────────────────────────

export class SoulValidationError extends Web4Error {
    constructor(detail: string) {
        super('SOUL_VALIDATION', `Soul validation failed: ${detail}`);
    }
}

export class SoulParseError extends Web4Error {
    constructor(detail: string) {
        super('SOUL_PARSE', `Soul parse failed: ${detail}`);
    }
}

// ── Git Errors ─────────────────────────────────────────────────────────

export class GitNotInitializedError extends Web4Error {
    constructor(path: string) {
        super('GIT_NOT_INITIALIZED', `Git repository not initialized at: ${path}`);
    }
}

export class GitConflictError extends Web4Error {
    constructor(detail: string) {
        super('GIT_CONFLICT', `Git conflict: ${detail}`);
    }
}

export class GitRemoteError extends Web4Error {
    constructor(detail: string, cause?: Error) {
        super('GIT_REMOTE', `Git remote error: ${detail}`, cause);
    }
}

// ── Social Relay Errors ────────────────────────────────────────────────

export class RelayNotConfiguredError extends Web4Error {
    constructor() {
        super(
            'RELAY_NOT_CONFIGURED',
            'Social relay is not configured in v1 (ADR-006). Use compute-provider IPC for parent-child messaging.',
        );
    }
}

export class SignatureVerificationError extends Web4Error {
    constructor(detail: string) {
        super('SIGNATURE_VERIFICATION', `Signature verification failed: ${detail}`);
    }
}

export class MessageExpiredError extends Web4Error {
    constructor(ageMs: number, maxMs: number) {
        super(
            'MESSAGE_EXPIRED',
            `Message expired: age ${ageMs}ms exceeds max ${maxMs}ms`,
        );
    }
}

// ── Registry Errors ────────────────────────────────────────────────────

export class ModelNotFoundError extends Web4Error {
    constructor(modelId: string) {
        super('MODEL_NOT_FOUND', `Model not found: ${modelId}`);
    }
}

export class RegistryRefreshError extends Web4Error {
    constructor(cause?: Error) {
        super('REGISTRY_REFRESH', 'Failed to refresh model registry', cause);
    }
}

// ── CLI Errors ─────────────────────────────────────────────────────────

export class AgentNotRunningError extends Web4Error {
    constructor() {
        super('AGENT_NOT_RUNNING', 'Agent is not running');
    }
}

export class DatabaseLockedError extends Web4Error {
    constructor(cause?: Error) {
        super('DB_LOCKED', 'Database is locked by another process', cause);
    }
}
