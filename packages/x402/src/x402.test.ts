/**
 * Tests for @web4-agent/x402
 */
import { describe, it, expect } from 'vitest';
import {
    createTestLogger,
} from '@web4-agent/core';
import type {
    PaymentRequirements,
    EthAddress,
    CAIP2NetworkId,
} from '@web4-agent/core';
import { MockFacilitator } from './mock-facilitator.js';
import { X402Server } from './server.js';
import type { SimpleRequest } from './server.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeRequirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
    return {
        scheme: 'exact',
        network: 'eip155:8453' as CAIP2NetworkId,
        maxAmountRequired: '1000',
        resource: '/api/data',
        payTo: '0x1234567890123456789012345678901234567890' as EthAddress,
        asset: 'USDC',
        ...overrides,
    };
}

function makeGatedRequest(path: string, headers: Record<string, string> = {}): SimpleRequest {
    return {
        method: 'GET',
        url: `http://localhost:3402${path}`,
        headers,
    };
}

// ── MockFacilitator ─────────────────────────────────────────────────────

describe('MockFacilitator', () => {
    it('always verifies successfully', async () => {
        const { logger } = createTestLogger();
        const mock = new MockFacilitator(logger);

        const result = await mock.verify({
            paymentPayload: '{}',
            paymentRequirements: makeRequirements(),
        });
        expect(result.valid).toBe(true);
    });

    it('always settles successfully with incrementing tx hash', async () => {
        const { logger } = createTestLogger();
        const mock = new MockFacilitator(logger);

        const r1 = await mock.settle({
            paymentPayload: '{}',
            paymentRequirements: makeRequirements(),
        });
        expect(r1.success).toBe(true);
        expect(r1.txHash).toBeDefined();

        const r2 = await mock.settle({
            paymentPayload: '{}',
            paymentRequirements: makeRequirements(),
        });
        expect(r2.success).toBe(true);
        // tx hashes should be different
        expect(r2.txHash).not.toBe(r1.txHash);
    });
});

// ── X402Server ──────────────────────────────────────────────────────────

describe('X402Server', () => {
    const { logger } = createTestLogger();
    const facilitator = new MockFacilitator(logger);
    const requirements = makeRequirements();
    const routes = new Map([['/api/data', { requirements }]]);

    it('returns gated: false for non-gated routes', async () => {
        const server = new X402Server({ routes, facilitator, logger });
        const result = await server.evaluatePayment(makeGatedRequest('/api/free'));
        expect(result.gated).toBe(false);
    });

    it('returns 402 when no payment header', async () => {
        const server = new X402Server({ routes, facilitator, logger });
        const result = await server.evaluatePayment(makeGatedRequest('/api/data'));

        expect(result.gated).toBe(true);
        if ('response' in result) {
            expect(result.response.status).toBe(402);
            const body = JSON.parse(result.response.body);
            expect(body.error).toBe('Payment Required');
            expect(body.requirements).toBeDefined();
            expect(result.response.headers['x-payment-requirements']).toBeDefined();
        } else {
            throw new Error('Expected response in result');
        }
    });

    it('returns 402 when only payment header but no signature', async () => {
        const server = new X402Server({ routes, facilitator, logger });
        const result = await server.evaluatePayment(
            makeGatedRequest('/api/data', { 'x-payment': btoa('{}') }),
        );

        expect(result.gated).toBe(true);
        if ('response' in result) {
            expect(result.response.status).toBe(402);
        }
    });

    it('verifies and settles valid payment', async () => {
        const server = new X402Server({ routes, facilitator, logger });
        const result = await server.evaluatePayment(
            makeGatedRequest('/api/data', {
                'x-payment': btoa(JSON.stringify({ amount: '1000' })),
                'x-payment-signature': '0xabcdef',
            }),
        );

        expect(result.gated).toBe(true);
        if ('verified' in result) {
            expect(result.verified).toBe(true);
            expect(result.txHash).toBeDefined();
        } else {
            throw new Error('Expected verified result');
        }
    });

    it('returns requirements in correct x402 header format', async () => {
        const server = new X402Server({ routes, facilitator, logger });
        const result = await server.evaluatePayment(makeGatedRequest('/api/data'));

        expect(result.gated).toBe(true);
        if ('response' in result) {
            const reqHeader = result.response.headers['x-payment-requirements'];
            const parsed = JSON.parse(reqHeader);
            expect(parsed.scheme).toBe('exact');
            expect(parsed.network).toBe('eip155:8453');
            expect(parsed.payTo).toMatch(/^0x/);
        }
    });

    it('handles multiple routes independently', async () => {
        const multiRoutes = new Map([
            ['/api/data', { requirements }],
            ['/api/premium', { requirements: makeRequirements({ maxAmountRequired: '5000' }) }],
        ]);
        const server = new X402Server({ routes: multiRoutes, facilitator, logger });

        const freeResult = await server.evaluatePayment(makeGatedRequest('/api/free'));
        expect(freeResult.gated).toBe(false);

        const dataResult = await server.evaluatePayment(makeGatedRequest('/api/data'));
        expect(dataResult.gated).toBe(true);
        if ('response' in dataResult) {
            const parsed = JSON.parse(dataResult.response.headers['x-payment-requirements']);
            expect(parsed.maxAmountRequired).toBe('1000');
        }

        const premiumResult = await server.evaluatePayment(makeGatedRequest('/api/premium'));
        expect(premiumResult.gated).toBe(true);
        if ('response' in premiumResult) {
            const parsed = JSON.parse(premiumResult.response.headers['x-payment-requirements']);
            expect(parsed.maxAmountRequired).toBe('5000');
        }
    });
});
