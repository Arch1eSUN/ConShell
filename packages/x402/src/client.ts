/**
 * x402 Client — handles HTTP 402 Payment Required flows.
 *
 * 1. Makes initial request
 * 2. If 402 received → parse PAYMENT-REQUIRED header
 * 3. Sign payment with wallet
 * 4. Retry with PAYMENT-SIGNATURE header
 */
import type {
    WalletAccount,
    PaymentRequirements,
    FacilitatorAdapter,
    Logger,
} from '@conshell/core';

export interface X402ClientOptions {
    /** Maximum payment per request in cents */
    readonly maxPaymentCents: number;
}

export interface X402Request {
    readonly url: string;
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
}

export interface X402Response {
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly paymentReceipt?: PaymentReceipt;
}

export interface PaymentReceipt {
    readonly amountCents: number;
    readonly payTo: string;
    readonly scheme: string;
    readonly network: string;
    readonly txHash?: string;
}

/**
 * Parse the x402 payment requirements from a 402 response.
 */
function parsePaymentRequirements(headers: Headers): PaymentRequirements | null {
    const raw = headers.get('x-payment-requirements') ?? headers.get('payment-requirements');
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        // x402 spec: requirements is an array, take the first
        const req = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!req) return null;
        return req as PaymentRequirements;
    } catch {
        return null;
    }
}

/**
 * Convert response headers to a plain object.
 */
function headersToObject(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        result[key] = value;
    });
    return result;
}

export class X402Client {
    private readonly maxPaymentCents: number;

    constructor(
        private readonly wallet: WalletAccount,
        _facilitator: FacilitatorAdapter,
        options: X402ClientOptions,
        private readonly logger: Logger,
    ) {
        this.maxPaymentCents = options.maxPaymentCents;
    }

    /**
     * Make an HTTP request, automatically handling 402 flows.
     */
    async fetch(request: X402Request): Promise<X402Response> {
        // Step 1: Initial request
        const initialResponse = await globalThis.fetch(request.url, {
            method: request.method ?? 'GET',
            headers: request.headers,
            body: request.body,
        });

        // If not 402 → return as-is
        if (initialResponse.status !== 402) {
            return {
                status: initialResponse.status,
                headers: headersToObject(initialResponse.headers),
                body: await initialResponse.text(),
            };
        }

        // Step 2: Parse payment requirements
        const requirements = parsePaymentRequirements(initialResponse.headers);
        if (!requirements) {
            this.logger.error('402 received but no payment requirements header');
            return {
                status: 402,
                headers: headersToObject(initialResponse.headers),
                body: await initialResponse.text(),
            };
        }

        // Step 3: Check amount cap
        const amountCents = Math.round(Number(requirements.maxAmountRequired));
        if (amountCents > this.maxPaymentCents) {
            this.logger.warn('Payment amount exceeds cap', {
                required: amountCents,
                cap: this.maxPaymentCents,
            });
            throw new Error(
                `Payment of ${amountCents} cents exceeds per-payment cap of ${this.maxPaymentCents} cents`,
            );
        }

        // Step 4: Sign payment
        const paymentPayload = JSON.stringify({
            scheme: requirements.scheme,
            network: requirements.network,
            amount: requirements.maxAmountRequired,
            payTo: requirements.payTo,
            resource: requirements.resource,
            nonce: Date.now().toString(),
            expiry: Math.floor(Date.now() / 1000) + (requirements.maxTimeoutSeconds ?? 300),
        });

        const signature = await this.wallet.sign(paymentPayload);

        this.logger.info('x402 payment signed', {
            url: request.url,
            amountCents,
            payTo: requirements.payTo,
        });

        // Step 5: Retry with payment header
        const retryResponse = await globalThis.fetch(request.url, {
            method: request.method ?? 'GET',
            headers: {
                ...request.headers,
                'x-payment': btoa(paymentPayload),
                'x-payment-signature': signature,
            },
            body: request.body,
        });

        const responseHeaders = headersToObject(retryResponse.headers);
        const txHash = responseHeaders['x-payment-response'] ?? undefined;

        return {
            status: retryResponse.status,
            headers: responseHeaders,
            body: await retryResponse.text(),
            paymentReceipt: {
                amountCents,
                payTo: requirements.payTo,
                scheme: requirements.scheme,
                network: requirements.network,
                txHash,
            },
        };
    }
}
