/**
 * Rate Limiter — In-memory sliding window rate limiter.
 *
 * Zero external dependencies. Per-IP tracking with configurable
 * limits per endpoint group.
 *
 * Default limits:
 *   /api/chat     → 20 req/min  (LLM inference cost)
 *   /api/paid/*   → 10 req/min  (payment verification)
 *   /api/*        → 200 req/min  (general)
 *   /health       → unlimited
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

// ── Types ───────────────────────────────────────────────────────────────

export interface RateLimitConfig {
    /** Max requests per window. Default: 200 */
    readonly maxRequests: number;
    /** Window size in milliseconds. Default: 60_000 (1 minute) */
    readonly windowMs: number;
}

export interface RateLimitResult {
    readonly allowed: boolean;
    readonly remaining: number;
    readonly resetAt: number; // Unix timestamp ms
    readonly limit: number;
}

interface WindowEntry {
    count: number;
    resetAt: number;
}

// ── Rate Limiter ────────────────────────────────────────────────────────

export class RateLimiter {
    private readonly windows = new Map<string, WindowEntry>();
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly maxRequests: number = 200,
        private readonly windowMs: number = 60_000,
    ) {
        // Periodically clean up expired entries to prevent memory leaks
        this.cleanupTimer = setInterval(() => this.cleanup(), this.windowMs * 2);
        // Allow Node to exit even if timer is active
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    /**
     * Check if a request from the given key is allowed.
     */
    check(key: string): RateLimitResult {
        const now = Date.now();
        let entry = this.windows.get(key);

        // Create new window or reset expired window
        if (!entry || now >= entry.resetAt) {
            entry = { count: 0, resetAt: now + this.windowMs };
            this.windows.set(key, entry);
        }

        entry.count++;

        const allowed = entry.count <= this.maxRequests;
        const remaining = Math.max(0, this.maxRequests - entry.count);

        return { allowed, remaining, resetAt: entry.resetAt, limit: this.maxRequests };
    }

    /**
     * Remove expired entries.
     */
    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.windows) {
            if (now >= entry.resetAt) {
                this.windows.delete(key);
            }
        }
    }

    /**
     * Destroy the limiter (clear cleanup timer).
     */
    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.windows.clear();
    }
}

// ── Preset Configurations ───────────────────────────────────────────────

export const RATE_LIMITS = {
    /** Chat endpoint — conservative due to LLM cost */
    chat: { maxRequests: 20, windowMs: 60_000 } satisfies RateLimitConfig,
    /** Paid endpoints — very conservative */
    paid: { maxRequests: 10, windowMs: 60_000 } satisfies RateLimitConfig,
    /** General API — generous for local dashboard usage */
    general: { maxRequests: 200, windowMs: 60_000 } satisfies RateLimitConfig,
} as const;

// ── Middleware ───────────────────────────────────────────────────────────

export interface RateLimitMiddlewareConfig {
    /** Paths that bypass rate limiting entirely. Default: ['/health', '/api/health'] */
    readonly skipPaths?: readonly string[];
    /** Path prefix → config mapping for per-endpoint limits */
    readonly rules?: ReadonlyArray<{
        readonly pathPrefix: string;
        readonly config: RateLimitConfig;
    }>;
}

/**
 * Creates an Express-compatible rate-limiting middleware.
 *
 * Supports per-endpoint limits via path prefix matching.
 * Falls back to the general limit if no specific rule matches.
 */
export function createRateLimitMiddleware(
    config?: RateLimitMiddlewareConfig,
): (
    req: IncomingMessage & { path?: string; ip?: string },
    res: ServerResponse & { status?: (code: number) => any; json?: (data: any) => any; setHeader?: (name: string, value: string | number) => any },
    next: () => void,
) => void {
    const skipPaths = new Set(config?.skipPaths ?? ['/health', '/api/health']);

    // Create limiters per rule
    const rules = (config?.rules ?? [
        { pathPrefix: '/api/chat', config: RATE_LIMITS.chat },
        { pathPrefix: '/api/paid', config: RATE_LIMITS.paid },
    ]).map(rule => ({
        pathPrefix: rule.pathPrefix,
        limiter: new RateLimiter(rule.config.maxRequests, rule.config.windowMs),
    }));

    // Fallback general limiter
    const generalLimiter = new RateLimiter(RATE_LIMITS.general.maxRequests, RATE_LIMITS.general.windowMs);

    return (req, res, next) => {
        const urlPath = req.path ?? new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

        // Skip rate limiting for excluded paths
        if (skipPaths.has(urlPath)) {
            next();
            return;
        }

        // Get client IP
        const ip = req.ip
            ?? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
            ?? (req as any).socket?.remoteAddress
            ?? 'unknown';

        // Find matching rule
        const matchedRule = rules.find(r => urlPath.startsWith(r.pathPrefix));
        const limiter = matchedRule?.limiter ?? generalLimiter;
        const key = `${ip}:${matchedRule?.pathPrefix ?? 'general'}`;

        const result = limiter.check(key);

        // Set rate limit headers
        if (typeof res.setHeader === 'function') {
            res.setHeader('X-RateLimit-Limit', result.limit);
            res.setHeader('X-RateLimit-Remaining', result.remaining);
            res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
        }

        if (!result.allowed) {
            const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
            if (typeof res.setHeader === 'function') {
                res.setHeader('Retry-After', retryAfter);
            }
            if (typeof res.status === 'function' && typeof res.json === 'function') {
                res.status(429).json({
                    error: 'Too Many Requests',
                    retryAfter,
                    limit: result.limit,
                });
            } else {
                res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) });
                res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter }));
            }
            return;
        }

        next();
    };
}
