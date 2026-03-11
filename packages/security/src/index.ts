/**
 * @conshell/security — Security infrastructure for Conway Automaton.
 *
 * Modules:
 *   - vault:        Encrypted config storage (AES-256-GCM)
 *   - auth:         HTTP/WebSocket authentication middleware
 *   - rate-limiter: Per-IP, per-endpoint rate limiting
 *   - privacy:      PII detection and redaction
 */

export { FileVault, KNOWN_SECRET_KEYS } from './vault.js';
export type { SecureVault } from './vault.js';

export { createAuthMiddleware, verifyAuth, generateToken } from './auth.js';
export type { AuthMode, AuthConfig, AuthResult } from './auth.js';

export { RateLimiter, createRateLimitMiddleware, RATE_LIMITS } from './rate-limiter.js';
export type { RateLimitConfig, RateLimitResult, RateLimitMiddlewareConfig } from './rate-limiter.js';

export { detectPII, hasPII, redactPII, auditPII } from './privacy.js';
export type { PIIMatch, PrivacyReport } from './privacy.js';

export { scanForInjection, isSafeInput } from './injection-defense.js';
export type { InjectionSeverity, InjectionMatch, InjectionScanResult } from './injection-defense.js';

export { PluginSandbox } from './plugin-sandbox.js';
export type { PluginManifest, PluginPermission, SandboxOptions, SandboxResult, PluginState, PluginInfo } from './plugin-sandbox.js';
