/**
 * Global constants for the web4-agent runtime.
 * All financial values are integers. Timeouts in milliseconds.
 */

/** Agent home directory name */
export const AGENT_HOME_DIR = '.web4-agent';

/** Database filename */
export const DB_FILENAME = 'state.db';

/** Wallet filename */
export const WALLET_FILENAME = 'wallet.json';

/** Config filename */
export const CONFIG_FILENAME = 'automaton.json';

/** Constitution filename */
export const CONSTITUTION_FILENAME = 'constitution.md';

/** Soul filename */
export const SOUL_FILENAME = 'SOUL.md';

/** Maximum tool result size in bytes (32KB) */
export const MAX_TOOL_RESULT_BYTES = 32_768;

/** Heartbeat interval in milliseconds (60 seconds) */
export const HEARTBEAT_INTERVAL_MS = 60_000;

/** Default command execution timeout in milliseconds (30 seconds) */
export const DEFAULT_EXEC_TIMEOUT_MS = 30_000;

/** Maximum message size in bytes (64KB) */
export const MAX_MESSAGE_BYTES = 65_536;

/** Maximum genesis prompt size in bytes (10KB) */
export const MAX_GENESIS_PROMPT_BYTES = 10_240;

/** Maximum soul section size in bytes (4KB) */
export const MAX_SOUL_SECTION_BYTES = 4_096;

/** Maximum number of children (default) */
export const DEFAULT_MAX_CHILDREN = 3;

/** Wallet file permissions (owner read/write only) */
export const WALLET_FILE_MODE = 0o600;

/** Maximum self-modifications per hour */
export const DEFAULT_MAX_SELF_MOD_PER_HOUR = 10;

/** Maximum tool calls per turn */
export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 20;

/** Maximum dangerous operations per session */
export const DEFAULT_MAX_DANGEROUS_PER_SESSION = 50;

/** Maximum exec calls per hour */
export const DEFAULT_MAX_EXEC_PER_HOUR = 100;

/** Maximum message rate per parent-child pair per hour */
export const MAX_MESSAGES_PER_HOUR = 10;

/** Maximum package/MCP installations per hour */
export const MAX_INSTALLS_PER_HOUR = 5;

/** Distress signal cooldown in milliseconds (15 minutes) */
export const DISTRESS_COOLDOWN_MS = 15 * 60 * 1_000;

/** Health check: cycles before unhealthy */
export const HEALTH_UNHEALTHY_CYCLES = 3;

/** Health check: cycles before dead */
export const HEALTH_DEAD_CYCLES = 10;

/** Health check: consecutive healthy cycles for recovery */
export const HEALTH_RECOVERY_CYCLES = 3;

/** Dead state grace period before cleanup (24 hours, ms) */
export const DEAD_CLEANUP_GRACE_MS = 24 * 60 * 60 * 1_000;

/** Timestamp freshness window for signed messages (5 minutes, ms) */
export const MESSAGE_FRESHNESS_MS = 5 * 60 * 1_000;

/** Append-only audit table retention (90 days, ms) */
export const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

/** Heartbeat history retention (7 days, ms) */
export const HEARTBEAT_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/** Spend tracking retention (30 days, ms) */
export const SPEND_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/** Metric snapshots retention (7 days, ms) */
export const METRIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Protected file basenames — never modifiable by the agent at runtime.
 */
export const PROTECTED_FILE_BASENAMES: ReadonlySet<string> = new Set([
    CONSTITUTION_FILENAME,
    WALLET_FILENAME,
    DB_FILENAME,
    CONFIG_FILENAME,
    'api-key',
    'schema.ts',
]);

/**
 * Protected directory names — all contents protected.
 */
export const PROTECTED_DIRECTORIES: ReadonlySet<string> = new Set(['.git']);

/**
 * Sensitive file patterns — read access denied to agent.
 */
export const SENSITIVE_FILE_PATTERNS: readonly string[] = [
    WALLET_FILENAME,
    '.env',
    'api-key',
    '*.pem',
    '*.key',
];

/**
 * Forbidden shell command patterns — pattern matching is substring-based.
 */
export const FORBIDDEN_COMMAND_PATTERNS: readonly string[] = [
    'rm -rf /',
    'DROP TABLE',
    'kill -9',
    'mkfs',
    'dd if=',
    ':(){ :|:& };:',
    'chmod 777 /',
    '> /dev/sda',
];

/**
 * Valid topup tier amounts in cents.
 */
export const TOPUP_TIERS_CENTS: readonly number[] = [
    500, 2_500, 10_000, 50_000, 100_000, 250_000,
];

/**
 * NPM package name validation pattern.
 */
export const NPM_PACKAGE_NAME_PATTERN = /^[a-z0-9@][a-z0-9._/-]*$/;

/**
 * Default NPM registry.
 */
export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org';

/**
 * Valid MCP transport types.
 */
export const MCP_TRANSPORTS = ['stdio', 'http'] as const;
