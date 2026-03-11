/**
 * Tests for ResilientHttpClient
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResilientHttpClient } from './http-client.js';

// ── Mock fetch ─────────────────────────────────────────────────────────

function mockFetch(responses: Array<{ status: number; body?: string; headers?: Record<string, string> }>) {
    let callIndex = 0;
    return vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
        const resp = responses[callIndex] ?? responses[responses.length - 1]!;
        callIndex++;
        return new Response(resp.body ?? '', {
            status: resp.status,
            headers: resp.headers,
        });
    });
}

function mockFetchThrow(errorMsg: string, afterAttempts: number = 0) {
    let callIndex = 0;
    return vi.fn(async (): Promise<Response> => {
        callIndex++;
        if (callIndex > afterAttempts) {
            throw new Error(errorMsg);
        }
        return new Response('ok', { status: 200 });
    });
}

describe('ResilientHttpClient', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.useRealTimers();
    });

    it('makes a simple GET request', async () => {
        const mock = mockFetch([{ status: 200, body: 'hello' }]);
        globalThis.fetch = mock as unknown as typeof fetch;

        const client = new ResilientHttpClient();
        const response = await client.get('https://example.com');
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('hello');
    });

    it('retries on 500 errors', async () => {
        const mock = mockFetch([
            { status: 500, body: 'error' },
            { status: 500, body: 'error' },
            { status: 200, body: 'success' },
        ]);
        globalThis.fetch = mock as unknown as typeof fetch;

        const retries: number[] = [];
        const client = new ResilientHttpClient({
            baseDelayMs: 1,
            onRetry: (attempt) => retries.push(attempt),
        });

        const response = await client.get('https://example.com');
        expect(response.status).toBe(200);
        expect(retries).toEqual([1, 2]);
        expect(mock).toHaveBeenCalledTimes(3);
    });

    it('retries on 429 Too Many Requests', async () => {
        const mock = mockFetch([
            { status: 429 },
            { status: 200, body: 'ok' },
        ]);
        globalThis.fetch = mock as unknown as typeof fetch;

        const client = new ResilientHttpClient({ baseDelayMs: 1 });
        const response = await client.get('https://example.com');
        expect(response.status).toBe(200);
        expect(mock).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 4xx (non-429)', async () => {
        const mock = mockFetch([{ status: 404, body: 'not found' }]);
        globalThis.fetch = mock as unknown as typeof fetch;

        const client = new ResilientHttpClient({ baseDelayMs: 1 });
        const response = await client.get('https://example.com');
        expect(response.status).toBe(404);
        expect(mock).toHaveBeenCalledTimes(1);
    });

    it('throws after max retries exhausted', async () => {
        const mock = mockFetchThrow('network error');
        globalThis.fetch = mock as unknown as typeof fetch;

        const client = new ResilientHttpClient({ maxRetries: 2, baseDelayMs: 1 });
        await expect(client.get('https://example.com')).rejects.toThrow('network error');
        expect(mock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('adds idempotency key for POST', async () => {
        let capturedHeaders: Headers | null = null;
        globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
            capturedHeaders = new Headers(init?.headers as HeadersInit);
            return new Response('ok', { status: 200 });
        }) as unknown as typeof fetch;

        const client = new ResilientHttpClient();
        await client.post('https://example.com/api', { data: 'test' });

        expect(capturedHeaders!.has('x-idempotency-key')).toBe(true);
        expect(capturedHeaders!.get('x-idempotency-key')!.length).toBe(32); // 16 bytes = 32 hex chars
    });

    it('does not add idempotency key for GET', async () => {
        let capturedHeaders: Headers | null = null;
        globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
            capturedHeaders = new Headers(init?.headers as HeadersInit);
            return new Response('ok', { status: 200 });
        }) as unknown as typeof fetch;

        const client = new ResilientHttpClient();
        await client.get('https://example.com');

        expect(capturedHeaders!.has('x-idempotency-key')).toBe(false);
    });

    it('circuit breaker opens after threshold failures', async () => {
        const mock = mockFetchThrow('connection refused');
        globalThis.fetch = mock as unknown as typeof fetch;

        let circuitOpened = false;
        const client = new ResilientHttpClient({
            maxRetries: 0,
            failureThreshold: 3,
            baseDelayMs: 1,
            onCircuitOpen: () => { circuitOpened = true; },
        });

        // 3 failures to trigger circuit open
        for (let i = 0; i < 3; i++) {
            await expect(client.get('https://example.com')).rejects.toThrow();
        }

        expect(circuitOpened).toBe(true);
        expect(client.getCircuitState()).toBe('open');

        // Next request should fail immediately with circuit breaker error
        await expect(client.get('https://example.com')).rejects.toThrow('Circuit breaker is OPEN');
    });

    it('circuit breaker transitions to half-open after cooldown', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));

        const mock = mockFetchThrow('fail');
        globalThis.fetch = mock as unknown as typeof fetch;

        const client = new ResilientHttpClient({
            maxRetries: 0,
            failureThreshold: 2,
            circuitCooldownMs: 5000,
            baseDelayMs: 1,
        });

        // Open circuit
        await expect(client.get('https://x.com')).rejects.toThrow();
        await expect(client.get('https://x.com')).rejects.toThrow();
        expect(client.getCircuitState()).toBe('open');

        // Advance past cooldown
        vi.advanceTimersByTime(6000);

        // Replace with a successful fetch
        globalThis.fetch = mockFetch([{ status: 200 }]) as unknown as typeof fetch;

        const response = await client.get('https://x.com');
        expect(response.status).toBe(200);
        expect(client.getCircuitState()).toBe('closed');
    });

    it('starts in closed circuit state', () => {
        const client = new ResilientHttpClient();
        expect(client.getCircuitState()).toBe('closed');
    });

    it('sets content-type on post', async () => {
        let capturedHeaders: Headers | null = null;
        globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
            capturedHeaders = new Headers(init?.headers as HeadersInit);
            return new Response('ok', { status: 200 });
        }) as unknown as typeof fetch;

        const client = new ResilientHttpClient();
        await client.post('https://example.com/api', { key: 'value' });

        expect(capturedHeaders!.get('content-type')).toBe('application/json');
    });
});
