/**
 * @conshell/core — Public API
 *
 * Shared types, config, money primitives, logger, errors, and constants.
 * This package has ZERO external runtime dependencies beyond zod.
 */

// Types — all shared vocabulary
export * from './types/index.js';

// Money — integer-only financial arithmetic
export * from './money/index.js';

// Config — loader and validation
export * from './config/index.js';

// Logger — structured JSON logging
export * from './logger/index.js';

// Errors — full error hierarchy
export * from './errors/index.js';

// Constants — runtime limits, protected patterns, timings
export * from './constants.js';

// Constitution — Three Laws of Sovereign AI
export * from './constitution.js';

// Observability — Metrics, Alerts, Monitoring
export * from './observability.js';

// Identity — AgentCard, SIWE, AgentRegistry
export * from './identity/index.js';

// HTTP Client — resilient fetch with retry, circuit breaker
export * from './http-client.js';

// Replication — Child agent lifecycle management
export * from './replication/index.js';

// Social — Agent-to-Agent communication
export * from './social/index.js';

// Plugins — lifecycle hooks and manifest system
export * from './plugins/index.js';

// Channels — multi-platform messaging
export * from './channels/index.js';

// Backup — state backup and restore
export * from './backup/index.js';

// Updater — self-update lifecycle
export * from './updater/index.js';

// Onboard — first-time setup wizard
export * from './onboard/index.js';

// TUI — terminal UI renderer
export * from './tui/index.js';
