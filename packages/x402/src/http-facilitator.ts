/**
 * HttpFacilitator — real HTTP facilitator adapter.
 *
 * Calls a facilitator endpoint for verify/settle with retry + timeout.
 */
import type { FacilitatorAdapter, VerifyRequest, VerifyResult, SettleRequest, SettleResult, Logger } from '@web4-agent/core';

export interface HttpFacilitatorOptions {
    /** Facilitator base URL (e.g. https://facilitator.x402.org) */
    readonly baseUrl: string;
    /** Request timeout in ms (default: 10000) */
    readonly timeoutMs?: number;
    /** Max retries (default: 2) */
    readonly maxRetries?: number;
}

export class HttpFacilitator implements FacilitatorAdapter {
    private readonly baseUrl: string;
    private readonly timeoutMs: number;
    private readonly maxRetries: number;

    constructor(
        options: HttpFacilitatorOptions,
        private readonly logger: Logger,
    ) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.timeoutMs = options.timeoutMs ?? 10_000;
        this.maxRetries = options.maxRetries ?? 2;
    }

    async verify(request: VerifyRequest): Promise<VerifyResult> {
        return this.post<VerifyResult>('/verify', request);
    }

    async settle(request: SettleRequest): Promise<SettleResult> {
        return this.post<SettleResult>('/settle', request);
    }

    private async post<T>(path: string, body: unknown): Promise<T> {
        let lastError: Error | undefined;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

                const response = await fetch(`${this.baseUrl}${path}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    throw new Error(`Facilitator returned ${response.status}: ${await response.text()}`);
                }

                return (await response.json()) as T;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                this.logger.warn('Facilitator request failed', {
                    path,
                    attempt: attempt + 1,
                    error: lastError.message,
                });
                if (attempt < this.maxRetries) {
                    // Exponential backoff: 500ms, 1000ms
                    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                }
            }
        }
        throw new Error(`Facilitator network error after ${this.maxRetries + 1} attempts: ${lastError?.message}`);
    }
}
