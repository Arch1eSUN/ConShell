/**
 * MockFacilitator — accepts all payment verifications and settlements.
 *
 * Used for local development and testing. Returns deterministic mock hashes.
 */
import type { FacilitatorAdapter, VerifyRequest, VerifyResult, SettleRequest, SettleResult, Logger } from '@web4-agent/core';

const MOCK_TX_PREFIX = '0x' + '0'.repeat(56);

export class MockFacilitator implements FacilitatorAdapter {
    private settleCount = 0;

    constructor(private readonly logger: Logger) { }

    async verify(_request: VerifyRequest): Promise<VerifyResult> {
        this.logger.debug('MockFacilitator.verify: accepting');
        return { valid: true };
    }

    async settle(_request: SettleRequest): Promise<SettleResult> {
        this.settleCount++;
        const txHash = MOCK_TX_PREFIX + this.settleCount.toString(16).padStart(8, '0');
        this.logger.debug('MockFacilitator.settle: accepting', { txHash });
        return { success: true, txHash };
    }
}
