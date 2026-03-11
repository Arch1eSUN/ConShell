/**
 * ResilientHttpClient — wraps globalThis.fetch with:
 * - Configurable retry (default 3 attempts, retries on 429/5xx)
 * - Jittered exponential backoff
 * - Circuit Breaker (closed → open → half-open)
 * - Idempotency key for mutating methods
 * - Configurable per-request timeout via AbortController
 */

// ── Types ──────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface ResilientHttpClientOptions {
    /** Max retry attempts (default 3) */
    readonly maxRetries?: number;
    /** Base delay in ms for exponential backoff (default 500) */
    readonly baseDelayMs?: number;
    /** Circuit breaker: failures before opening (default 5) */
    readonly failureThreshold?: number;
    /** Circuit breaker: cooldown in ms before half-open (default 60000) */
    readonly circuitCooldownMs?: number;
    /** Default timeout per request in ms (default 30000) */
    readonly timeoutMs?: number;
    /** Callback on retry */
    readonly onRetry?: (attempt: number, status: number, url: string) => void;
    /** Callback when circuit opens */
    readonly onCircuitOpen?: () => void;
    /** Callback when circuit closes */
    readonly onCircuitClose?: () => void;
}

export interface FetchOptions extends RequestInit {
    /** Override timeout for this request (ms) */
    readonly timeoutMs?: number;
    /** Override max retries for this request */
    readonly maxRetries?: number;
    /** Custom idempotency key (auto-generated for mutating methods if omitted) */
    readonly idempotencyKey?: string;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<ResilientHttpClientOptions, 'onRetry' | 'onCircuitOpen' | 'onCircuitClose'>> = {
    maxRetries: 3,
    baseDelayMs: 500,
    failureThreshold: 5,
    circuitCooldownMs: 60_000,
    timeoutMs: 30_000,
};

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ── ResilientHttpClient ────────────────────────────────────────────────

export class ResilientHttpClient {
    private readonly opts: Required<Omit<ResilientHttpClientOptions, 'onRetry' | 'onCircuitOpen' | 'onCircuitClose'>>;
    private readonly onRetry?: ResilientHttpClientOptions['onRetry'];
    private readonly onCircuitOpen?: ResilientHttpClientOptions['onCircuitOpen'];
    private readonly onCircuitClose?: ResilientHttpClientOptions['onCircuitClose'];

    // Circuit breaker state
    private circuitState: CircuitState = 'closed';
    private consecutiveFailures = 0;
    private lastFailureTime = 0;

    constructor(options?: ResilientHttpClientOptions) {
        this.opts = { ...DEFAULT_OPTIONS, ...options };
        this.onRetry = options?.onRetry;
        this.onCircuitOpen = options?.onCircuitOpen;
        this.onCircuitClose = options?.onCircuitClose;
    }

    // ── Public API ─────────────────────────────────────────────────────

    /** GET request */
    async get(url: string, options?: FetchOptions): Promise<Response> {
        return this.fetch(url, { ...options, method: 'GET' });
    }

    /** POST request */
    async post(url: string, body: string | Record<string, unknown>, options?: FetchOptions): Promise<Response> {
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            ...(options?.headers as Record<string, string> ?? {}),
        };
        return this.fetch(url, { ...options, method: 'POST', body: bodyStr, headers });
    }

    /** Generic fetch with retry + circuit breaker */
    async fetch(url: string, init?: FetchOptions): Promise<Response> {
        // Circuit breaker check
        this.checkCircuit();

        const method = (init?.method ?? 'GET').toUpperCase();
        const maxRetries = init?.maxRetries ?? this.opts.maxRetries;
        const timeoutMs = init?.timeoutMs ?? this.opts.timeoutMs;

        // Add idempotency key for mutating methods
        const headers = new Headers(init?.headers as Record<string, string> | undefined);
        if (MUTATING_METHODS.has(method) && !headers.has('x-idempotency-key')) {
            headers.set('x-idempotency-key', init?.idempotencyKey ?? generateIdempotencyKey());
        }

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.fetchWithTimeout(url, {
                    ...init,
                    method,
                    headers,
                }, timeoutMs);

                // Success — reset circuit breaker
                if (response.ok) {
                    this.onSuccess();
                    return response;
                }

                // Retryable status?
                if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxRetries) {
                    this.onRetry?.(attempt + 1, response.status, url);
                    await this.backoff(attempt, response);
                    continue;
                }

                // Non-retryable error — still a "successful" network call
                this.onSuccess();
                return response;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (attempt < maxRetries) {
                    this.onRetry?.(attempt + 1, 0, url);
                    await this.backoff(attempt);
                    continue;
                }

                this.onFailure();
            }
        }

        throw lastError ?? new Error(`Request to ${url} failed after ${maxRetries + 1} attempts`);
    }

    /** Get current circuit state */
    getCircuitState(): CircuitState {
        return this.circuitState;
    }

    // ── Private ────────────────────────────────────────────────────────

    private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
        const controller = new AbortController();
        const existingSignal = init.signal;

        // Merge abort signals
        if (existingSignal) {
            existingSignal.addEventListener('abort', () => controller.abort());
        }

        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            return await globalThis.fetch(url, {
                ...init,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    }

    private async backoff(attempt: number, response?: Response): Promise<void> {
        let delay = this.opts.baseDelayMs * Math.pow(2, attempt);

        // Respect Retry-After header if present
        if (response?.headers.has('retry-after')) {
            const retryAfter = parseInt(response.headers.get('retry-after')!, 10);
            if (!isNaN(retryAfter)) {
                delay = retryAfter * 1000;
            }
        }

        // Add jitter (±25%)
        const jitter = delay * 0.25 * (Math.random() * 2 - 1);
        delay = Math.max(100, delay + jitter);

        await new Promise<void>(resolve => setTimeout(resolve, delay));
    }

    private checkCircuit(): void {
        if (this.circuitState === 'open') {
            const elapsed = Date.now() - this.lastFailureTime;
            if (elapsed >= this.opts.circuitCooldownMs) {
                this.circuitState = 'half-open';
            } else {
                throw new Error(
                    `Circuit breaker is OPEN. ${Math.ceil((this.opts.circuitCooldownMs - elapsed) / 1000)}s until half-open.`,
                );
            }
        }
    }

    private onSuccess(): void {
        if (this.circuitState !== 'closed') {
            this.circuitState = 'closed';
            this.consecutiveFailures = 0;
            this.onCircuitClose?.();
        }
        this.consecutiveFailures = 0;
    }

    private onFailure(): void {
        this.consecutiveFailures++;
        this.lastFailureTime = Date.now();

        if (this.consecutiveFailures >= this.opts.failureThreshold && this.circuitState !== 'open') {
            this.circuitState = 'open';
            this.onCircuitOpen?.();
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────

function generateIdempotencyKey(): string {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
