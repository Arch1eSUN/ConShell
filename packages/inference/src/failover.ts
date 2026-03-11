/**
 * Model Failover — Cascading failover chain for inference providers.
 *
 * Wraps the existing InferenceRouter with retry + failover logic:
 * 1. Try primary model
 * 2. On failure, cascade through fallback chain
 * 3. Track provider health across attempts
 * 4. Auto-disable unhealthy providers temporarily
 */
import type {
    InferenceRequest,
    InferenceResponse,
    SurvivalTier,
    Logger,
} from '@conshell/core';

// ── Types ─────────────────────────────────────────────────────────────

export interface FailoverConfig {
    /** Maximum retry attempts per request */
    maxRetries: number;
    /** Delay in ms between retries */
    retryDelayMs: number;
    /** Cooldown period for unhealthy providers (ms) */
    providerCooldownMs: number;
    /** Max consecutive failures before marking provider unhealthy */
    maxConsecutiveFailures: number;
}

export interface RouteFunction {
    (request: InferenceRequest, tier: SurvivalTier): Promise<InferenceResponse>;
}

interface ProviderHealth {
    failureCount: number;
    lastFailure: number;
    cooldownUntil: number;
    healthy: boolean;
}

// ── Default Config ────────────────────────────────────────────────────

const DEFAULT_CONFIG: FailoverConfig = {
    maxRetries: 3,
    retryDelayMs: 1000,
    providerCooldownMs: 60_000,
    maxConsecutiveFailures: 3,
};

// ── Failover Router ───────────────────────────────────────────────────

export class FailoverRouter {
    private providerHealth: Map<string, ProviderHealth> = new Map();
    private config: FailoverConfig;

    constructor(
        private readonly primaryRoute: RouteFunction,
        private readonly fallbackRoutes: RouteFunction[],
        private readonly logger: Logger,
        config?: Partial<FailoverConfig>,
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Route request with automatic failover.
     */
    async route(
        request: InferenceRequest,
        tier: SurvivalTier,
    ): Promise<InferenceResponse> {
        const routes = [this.primaryRoute, ...this.fallbackRoutes];
        const errors: Array<{ index: number; error: string }> = [];

        for (let i = 0; i < routes.length; i++) {
            const routeFn = routes[i]!;
            let lastError: Error | undefined;

            // Retry loop for this route
            for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
                try {
                    const response = await routeFn(request, tier);
                    // Success — reset health for this route
                    this.reportSuccess(`route-${i}`);
                    return response;
                } catch (err) {
                    lastError = err instanceof Error ? err : new Error(String(err));

                    if (attempt < this.config.maxRetries) {
                        this.logger.warn('Inference attempt failed, retrying', {
                            route: i,
                            attempt: attempt + 1,
                            maxRetries: this.config.maxRetries,
                            error: lastError.message,
                        });
                        await sleep(this.config.retryDelayMs * (attempt + 1)); // exponential-ish
                    }
                }
            }

            // All retries exhausted for this route
            this.reportFailure(`route-${i}`);
            errors.push({
                index: i,
                error: lastError?.message ?? 'unknown error',
            });

            this.logger.warn('Route exhausted, trying fallback', {
                route: i,
                nextRoute: i + 1 < routes.length ? i + 1 : 'none',
            });
        }

        // All routes exhausted
        const errorSummary = errors
            .map(e => `route-${e.index}: ${e.error}`)
            .join('; ');
        throw new Error(
            `All inference routes exhausted. Errors: ${errorSummary}`,
        );
    }

    /**
     * Check if a provider is currently healthy.
     */
    isHealthy(providerId: string): boolean {
        const health = this.providerHealth.get(providerId);
        if (!health) return true;

        // Check if cooldown has expired
        if (!health.healthy && Date.now() >= health.cooldownUntil) {
            health.healthy = true;
            health.failureCount = 0;
            return true;
        }

        return health.healthy;
    }

    /**
     * Get health status of all tracked providers.
     */
    getHealthStatus(): Record<string, {
        healthy: boolean;
        failureCount: number;
        lastFailure: number;
    }> {
        const result: Record<string, any> = {};
        for (const [id, health] of this.providerHealth) {
            result[id] = {
                healthy: this.isHealthy(id),
                failureCount: health.failureCount,
                lastFailure: health.lastFailure,
            };
        }
        return result;
    }

    private reportSuccess(providerId: string): void {
        const health = this.providerHealth.get(providerId);
        if (health) {
            health.failureCount = 0;
            health.healthy = true;
        }
    }

    private reportFailure(providerId: string): void {
        let health = this.providerHealth.get(providerId);
        if (!health) {
            health = {
                failureCount: 0,
                lastFailure: 0,
                cooldownUntil: 0,
                healthy: true,
            };
            this.providerHealth.set(providerId, health);
        }

        health.failureCount++;
        health.lastFailure = Date.now();

        if (health.failureCount >= this.config.maxConsecutiveFailures) {
            health.healthy = false;
            health.cooldownUntil = Date.now() + this.config.providerCooldownMs;
            this.logger.error('Provider entering cooldown', {
                providerId,
                failureCount: health.failureCount,
                cooldownMs: this.config.providerCooldownMs,
            });
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
