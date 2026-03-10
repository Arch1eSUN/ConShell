/**
 * x402 Server Middleware — gates HTTP endpoints behind x402 payment requirements.
 *
 * Flow:
 * 1. Check for payment header
 * 2. If absent → respond with 402 + payment requirements
 * 3. If present → verify via facilitator, settle, serve resource
 */
import type {
    FacilitatorAdapter,
    PaymentRequirements,
    Logger,
} from '@web4-agent/core';

export interface X402RouteConfig {
    /** The payment requirements for this route */
    readonly requirements: PaymentRequirements;
}

export interface X402ServerOptions {
    /** Route configs keyed by path pattern */
    readonly routes: ReadonlyMap<string, X402RouteConfig>;
    /** Facilitator adapter for verify + settle */
    readonly facilitator: FacilitatorAdapter;
    /** Logger */
    readonly logger: Logger;
}

export interface SimpleRequest {
    readonly method: string;
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
}

export interface SimpleResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}

/**
 * x402 Server — evaluates inbound requests against payment requirements.
 */
export class X402Server {
    private readonly routes: ReadonlyMap<string, X402RouteConfig>;
    private readonly facilitator: FacilitatorAdapter;
    private readonly logger: Logger;

    constructor(options: X402ServerOptions) {
        this.routes = options.routes;
        this.facilitator = options.facilitator;
        this.logger = options.logger;
    }

    /**
     * Process an inbound request. Returns null if the path is not gated.
     * Returns a SimpleResponse (402 or error) if payment is needed.
     * Returns { verified: true, txHash } if payment is valid and settled.
     */
    async evaluatePayment(
        request: SimpleRequest,
    ): Promise<{ gated: false } | { gated: true; response: SimpleResponse } | { gated: true; verified: true; txHash?: string }> {
        // Find matching route config
        const url = new URL(request.url, 'http://localhost');
        const routeConfig = this.routes.get(url.pathname);
        if (!routeConfig) {
            return { gated: false };
        }

        // Check for payment headers
        const paymentPayload = request.headers['x-payment'];
        const paymentSignature = request.headers['x-payment-signature'];

        if (!paymentPayload || !paymentSignature) {
            // Return 402 with requirements
            return {
                gated: true,
                response: {
                    status: 402,
                    headers: {
                        'x-payment-requirements': JSON.stringify(routeConfig.requirements),
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({
                        error: 'Payment Required',
                        requirements: routeConfig.requirements,
                    }),
                },
            };
        }

        // Verify payment
        try {
            const decoded = atob(paymentPayload);
            const verifyResult = await this.facilitator.verify({
                paymentPayload: decoded,
                paymentRequirements: routeConfig.requirements,
            });

            if (!verifyResult.valid) {
                this.logger.warn('Payment verification failed', { reason: verifyResult.reason });
                return {
                    gated: true,
                    response: {
                        status: 402,
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            error: 'Payment verification failed',
                            reason: verifyResult.reason,
                        }),
                    },
                };
            }

            // Settle payment
            const settleResult = await this.facilitator.settle({
                paymentPayload: decoded,
                paymentRequirements: routeConfig.requirements,
            });

            if (!settleResult.success) {
                this.logger.error('Payment settlement failed');
                return {
                    gated: true,
                    response: {
                        status: 500,
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ error: 'Payment settlement failed' }),
                    },
                };
            }

            this.logger.info('x402 payment settled', {
                path: url.pathname,
                txHash: settleResult.txHash,
            });

            return { gated: true, verified: true, txHash: settleResult.txHash };
        } catch (err) {
            this.logger.error('x402 server error', { error: err });
            return {
                gated: true,
                response: {
                    status: 500,
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ error: 'Internal payment processing error' }),
                },
            };
        }
    }
}
