/**
 * Account Pool — Multi-account round-robin load balancing.
 *
 * Manages multiple API accounts/keys for providers, distributing requests
 * across them in a round-robin pattern. Supports:
 * - Per-account rate limiting
 * - Health tracking (mark accounts as unhealthy on errors)
 * - CLIProxyAPI-style key format (cpk-XXXX-YYYY)
 * - Automatic recovery after cooldown
 */

import type { Logger } from '@conshell/core';

// ── Types ─────────────────────────────────────────────────────────────

export interface ProxyAccount {
    /** Unique identifier for this account */
    readonly id: string;
    /** Provider name (openai, anthropic, gemini, cliproxyapi, etc.) */
    readonly provider: string;
    /** API key or token */
    readonly apiKey: string;
    /** Optional display name */
    readonly label?: string;
    /** Optional base URL override */
    readonly baseUrl?: string;
    /** Maximum requests per minute for this account (0 = unlimited) */
    readonly rpmLimit?: number;
}

interface AccountState {
    readonly account: ProxyAccount;
    requestCount: number;
    lastRequestTime: number;
    healthy: boolean;
    errorCount: number;
    cooldownUntil: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_COOLDOWN_MS = 60_000; // 1 minute cooldown on error
const MAX_ERROR_COUNT = 5;          // Mark unhealthy after N consecutive errors
const RPM_WINDOW_MS = 60_000;       // 1 minute window for RPM tracking

// ── CLIProxy Key Parser ───────────────────────────────────────────────

/**
 * Parse CLIProxy-style API key format.
 * Format: cpk-{provider}-{key} or standard API key.
 */
export function parseCLIProxyKey(key: string): {
    provider: string;
    apiKey: string;
    isCLIProxy: boolean;
} {
    if (key.startsWith('cpk-')) {
        const parts = key.slice(4).split('-', 2);
        if (parts.length === 2 && parts[0] && parts[1]) {
            return {
                provider: parts[0],
                apiKey: parts[1],
                isCLIProxy: true,
            };
        }
    }
    return { provider: 'unknown', apiKey: key, isCLIProxy: false };
}

// ── Account Pool ──────────────────────────────────────────────────────

export class AccountPool {
    private accounts: Map<string, AccountState[]> = new Map();
    private roundRobinIndex: Map<string, number> = new Map();

    constructor(
        private readonly logger: Logger,
        private readonly cooldownMs: number = DEFAULT_COOLDOWN_MS,
    ) {}

    /**
     * Add an account to the pool.
     */
    addAccount(account: ProxyAccount): void {
        const states = this.accounts.get(account.provider) ?? [];
        // Deduplicate by ID
        if (states.some(s => s.account.id === account.id)) {
            this.logger.warn('Account already exists, replacing', {
                id: account.id,
                provider: account.provider,
            });
            const idx = states.findIndex(s => s.account.id === account.id);
            states[idx] = {
                account,
                requestCount: 0,
                lastRequestTime: 0,
                healthy: true,
                errorCount: 0,
                cooldownUntil: 0,
            };
        } else {
            states.push({
                account,
                requestCount: 0,
                lastRequestTime: 0,
                healthy: true,
                errorCount: 0,
                cooldownUntil: 0,
            });
        }
        this.accounts.set(account.provider, states);
        this.logger.info('Account added to pool', {
            id: account.id,
            provider: account.provider,
            totalForProvider: states.length,
        });
    }

    /**
     * Remove an account from the pool.
     */
    removeAccount(provider: string, accountId: string): boolean {
        const states = this.accounts.get(provider);
        if (!states) return false;
        const idx = states.findIndex(s => s.account.id === accountId);
        if (idx < 0) return false;
        states.splice(idx, 1);
        if (states.length === 0) {
            this.accounts.delete(provider);
            this.roundRobinIndex.delete(provider);
        }
        return true;
    }

    /**
     * Get the next available account for a provider using round-robin.
     * Skips unhealthy accounts and accounts at their RPM limit.
     */
    getNext(provider: string): ProxyAccount | null {
        const states = this.accounts.get(provider);
        if (!states || states.length === 0) return null;

        const now = Date.now();
        let idx = this.roundRobinIndex.get(provider) ?? 0;

        // Try each account in round-robin order
        for (let attempts = 0; attempts < states.length; attempts++) {
            idx = idx % states.length;
            const state = states[idx]!;

            // Check cooldown
            if (!state.healthy && now < state.cooldownUntil) {
                idx++;
                continue;
            }

            // Auto-recover from cooldown
            if (!state.healthy && now >= state.cooldownUntil) {
                state.healthy = true;
                state.errorCount = 0;
                this.logger.info('Account recovered from cooldown', {
                    id: state.account.id,
                    provider,
                });
            }

            // Check RPM limit
            if (state.account.rpmLimit && state.account.rpmLimit > 0) {
                if (now - state.lastRequestTime < RPM_WINDOW_MS &&
                    state.requestCount >= state.account.rpmLimit) {
                    idx++;
                    continue;
                }
                // Reset counter if window passed
                if (now - state.lastRequestTime >= RPM_WINDOW_MS) {
                    state.requestCount = 0;
                }
            }

            // Found a viable account
            state.requestCount++;
            state.lastRequestTime = now;
            this.roundRobinIndex.set(provider, idx + 1);
            return state.account;
        }

        // No available account
        this.logger.warn('No available account in pool', { provider, total: states.length });
        return null;
    }

    /**
     * Report a successful request for an account.
     */
    reportSuccess(provider: string, accountId: string): void {
        const found = this.findState(provider, accountId);
        if (found) {
            found.errorCount = 0;
            found.healthy = true;
        }
    }

    /**
     * Report a failed request for an account.
     * After MAX_ERROR_COUNT consecutive failures, account enters cooldown.
     */
    reportError(provider: string, accountId: string): void {
        const found = this.findState(provider, accountId);
        if (!found) return;
        found.errorCount++;
        if (found.errorCount >= MAX_ERROR_COUNT) {
            found.healthy = false;
            found.cooldownUntil = Date.now() + this.cooldownMs;
            this.logger.warn('Account entering cooldown', {
                id: accountId,
                provider,
                errorCount: found.errorCount,
                cooldownMs: this.cooldownMs,
            });
        }
    }

    /**
     * Get pool status for all providers.
     */
    getStatus(): Record<string, {
        total: number;
        healthy: number;
        accounts: Array<{
            id: string;
            label?: string;
            healthy: boolean;
            requestCount: number;
            errorCount: number;
        }>;
    }> {
        const result: Record<string, any> = {};
        for (const [provider, states] of this.accounts) {
            result[provider] = {
                total: states.length,
                healthy: states.filter(s => s.healthy).length,
                accounts: states.map(s => ({
                    id: s.account.id,
                    label: s.account.label,
                    healthy: s.healthy,
                    requestCount: s.requestCount,
                    errorCount: s.errorCount,
                })),
            };
        }
        return result;
    }

    /**
     * List all providers with accounts.
     */
    listProviders(): string[] {
        return Array.from(this.accounts.keys());
    }

    private findState(provider: string, accountId: string): AccountState | undefined {
        return this.accounts.get(provider)?.find(s => s.account.id === accountId);
    }
}
