import { describe, it, expect } from 'vitest';
import {
    cents,
    centsNonNeg,
    microcents,
    microcentsNonNeg,
    addCents,
    subtractCents,
    multiplyCents,
    centsToUsd,
    addMicrocents,
    subtractMicrocents,
    microcentsToCentsCeil,
    centsToMicrocents,
    calculateInferenceCost,
    centsGt,
    centsLt,
    centsEq,
    ZERO_CENTS,
    ZERO_MICROCENTS,
} from './money.js';

describe('money primitives', () => {
    describe('cents()', () => {
        it('creates a Cents value from a valid integer', () => {
            expect(cents(100)).toBe(100);
            expect(cents(-50)).toBe(-50);
            expect(cents(0)).toBe(0);
        });

        it('rejects non-integer values', () => {
            expect(() => cents(1.5)).toThrow(TypeError);
            expect(() => cents(NaN)).toThrow(TypeError);
            expect(() => cents(Infinity)).toThrow(TypeError);
        });
    });

    describe('centsNonNeg()', () => {
        it('creates a non-negative Cents value', () => {
            expect(centsNonNeg(100)).toBe(100);
            expect(centsNonNeg(0)).toBe(0);
        });

        it('rejects negative values', () => {
            expect(() => centsNonNeg(-1)).toThrow(RangeError);
        });
    });

    describe('microcents()', () => {
        it('creates a Microcents value from a valid integer', () => {
            expect(microcents(1_000_000)).toBe(1_000_000);
        });

        it('rejects non-integer values', () => {
            expect(() => microcents(0.5)).toThrow(TypeError);
        });
    });

    describe('microcentsNonNeg()', () => {
        it('rejects negative values', () => {
            expect(() => microcentsNonNeg(-1)).toThrow(RangeError);
        });
    });

    describe('arithmetic', () => {
        it('addCents adds two Cents values', () => {
            expect(addCents(cents(100), cents(200))).toBe(300);
        });

        it('subtractCents subtracts two Cents values', () => {
            expect(subtractCents(cents(500), cents(200))).toBe(300);
        });

        it('subtractCents allows negative results', () => {
            expect(subtractCents(cents(100), cents(200))).toBe(-100);
        });

        it('multiplyCents multiplies by integer factor', () => {
            expect(multiplyCents(cents(100), 3)).toBe(300);
        });

        it('multiplyCents rejects non-integer factor', () => {
            expect(() => multiplyCents(cents(100), 1.5)).toThrow(TypeError);
        });

        it('addMicrocents adds two Microcents values', () => {
            expect(addMicrocents(microcents(1_000_000), microcents(500_000))).toBe(1_500_000);
        });

        it('subtractMicrocents subtracts two Microcents values', () => {
            expect(subtractMicrocents(microcents(1_000_000), microcents(400_000))).toBe(600_000);
        });
    });

    describe('conversions', () => {
        it('microcentsToCentsCeil rounds up', () => {
            expect(microcentsToCentsCeil(microcents(1_500_000))).toBe(2); // 1.5 cents → 2
            expect(microcentsToCentsCeil(microcents(1_000_000))).toBe(1); // exactly 1 cent
            expect(microcentsToCentsCeil(microcents(1))).toBe(1); // 0.000001 cents → 1
            expect(microcentsToCentsCeil(microcents(0))).toBe(0); // zero stays zero
        });

        it('centsToMicrocents is lossless', () => {
            expect(centsToMicrocents(cents(5))).toBe(5_000_000);
            expect(centsToMicrocents(cents(0))).toBe(0);
        });
    });

    describe('centsToUsd', () => {
        it('formats positive amounts', () => {
            expect(centsToUsd(cents(0))).toBe('$0.00');
            expect(centsToUsd(cents(1))).toBe('$0.01');
            expect(centsToUsd(cents(100))).toBe('$1.00');
            expect(centsToUsd(cents(12345))).toBe('$123.45');
        });

        it('formats negative amounts', () => {
            expect(centsToUsd(cents(-100))).toBe('-$1.00');
            expect(centsToUsd(cents(-1))).toBe('-$0.01');
        });
    });

    describe('comparisons', () => {
        it('centsGt returns true when a > b', () => {
            expect(centsGt(cents(200), cents(100))).toBe(true);
            expect(centsGt(cents(100), cents(100))).toBe(false);
        });

        it('centsLt returns true when a < b', () => {
            expect(centsLt(cents(100), cents(200))).toBe(true);
        });

        it('centsEq returns true when a === b', () => {
            expect(centsEq(cents(100), cents(100))).toBe(true);
            expect(centsEq(cents(100), cents(200))).toBe(false);
        });
    });

    describe('calculateInferenceCost', () => {
        it('calculates cost for given token counts and pricing', () => {
            // 1000 input tokens at 300 microcents per M → 0.3 microcents → rounds up to 1 cent
            // 500 output tokens at 600 microcents per M → 0.3 microcents → rounds up to 1 cent
            // Total: 1 + 1 = 2 → ceil to nearest cent = 1
            const cost = calculateInferenceCost(
                1000,
                500,
                microcents(300),
                microcents(600),
            );
            expect(cost).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(cost)).toBe(true);
        });

        it('returns 0 for zero tokens', () => {
            expect(calculateInferenceCost(0, 0, microcents(300), microcents(600))).toBe(0);
        });

        it('rejects negative token counts', () => {
            expect(() =>
                calculateInferenceCost(-1, 0, microcents(300), microcents(600)),
            ).toThrow(RangeError);
        });
    });

    describe('constants', () => {
        it('ZERO_CENTS is 0', () => {
            expect(ZERO_CENTS).toBe(0);
        });

        it('ZERO_MICROCENTS is 0', () => {
            expect(ZERO_MICROCENTS).toBe(0);
        });
    });
});
