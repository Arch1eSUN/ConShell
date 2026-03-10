import { describe, it, expect } from 'vitest';
import { Web4Error, ConfigNotFoundError, ToolDeniedError, PaymentAmountExceededError } from './base.js';

describe('error hierarchy', () => {
    it('all errors extend Web4Error', () => {
        const err = new ConfigNotFoundError('/path/to/config');
        expect(err).toBeInstanceOf(Web4Error);
        expect(err).toBeInstanceOf(Error);
    });

    it('carries machine-readable code', () => {
        const err = new ConfigNotFoundError('/some/path');
        expect(err.code).toBe('CONFIG_NOT_FOUND');
        expect(err.message).toContain('/some/path');
    });

    it('carries cause chain', () => {
        const inner = new Error('disk full');
        const outer = new Web4Error('SOME_CODE', 'operation failed', inner);
        expect(outer.cause).toBe(inner);
    });

    it('preserves prototype chain for instanceof', () => {
        const err = new ToolDeniedError('exec', 'deny_forbidden', 'authority', 'tool is forbidden');
        expect(err).toBeInstanceOf(ToolDeniedError);
        expect(err).toBeInstanceOf(Web4Error);
        expect(err.ruleName).toBe('deny_forbidden');
        expect(err.ruleCategory).toBe('authority');
    });

    it('PaymentAmountExceededError includes amounts', () => {
        const err = new PaymentAmountExceededError(200_000, 100_000);
        expect(err.code).toBe('PAYMENT_AMOUNT_EXCEEDED');
        expect(err.message).toContain('200000');
        expect(err.message).toContain('100000');
    });
});
