/**
 * Integer-only money arithmetic for conshell.
 *
 * All financial values are represented as branded integers:
 *  - Cents: integer US cents (1 dollar = 100 cents)
 *  - Microcents: integer microcents (1 cent = 1,000,000 microcents) for model pricing
 *
 * Branded types prevent accidentally mixing Cents and Microcents at the type level.
 * All operations validate integer inputs and throw on non-integer or NaN.
 */

// ── Branded Types ──────────────────────────────────────────────────────

declare const CentsBrand: unique symbol;
declare const MicrocentsBrand: unique symbol;

/**
 * Integer cents (1 dollar = 100 cents).
 * Used for: treasury, spend tracking, transaction amounts, payment caps.
 */
export type Cents = number & { readonly [CentsBrand]: true };

/**
 * Integer microcents (1 cent = 1,000,000 microcents).
 * Used for: model pricing per million tokens.
 */
export type Microcents = number & { readonly [MicrocentsBrand]: true };

// ── Validators ─────────────────────────────────────────────────────────

function assertInteger(value: number, label: string): void {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new TypeError(`${label} must be a finite integer, got: ${value}`);
    }
}

function assertNonNegative(value: number, label: string): void {
    assertInteger(value, label);
    if (value < 0) {
        throw new RangeError(`${label} must be non-negative, got: ${value}`);
    }
}

// ── Constructors ───────────────────────────────────────────────────────

/** Create a Cents value from a validated integer. */
export function cents(value: number): Cents {
    assertInteger(value, 'Cents');
    return value as Cents;
}

/** Create a non-negative Cents value. */
export function centsNonNeg(value: number): Cents {
    assertNonNegative(value, 'Cents');
    return value as Cents;
}

/** Create a Microcents value from a validated integer. */
export function microcents(value: number): Microcents {
    assertInteger(value, 'Microcents');
    return value as Microcents;
}

/** Create a non-negative Microcents value. */
export function microcentsNonNeg(value: number): Microcents {
    assertNonNegative(value, 'Microcents');
    return value as Microcents;
}

// ── Cents Arithmetic ───────────────────────────────────────────────────

export function addCents(a: Cents, b: Cents): Cents {
    const result = a + b;
    assertInteger(result, 'addCents result');
    return result as Cents;
}

export function subtractCents(a: Cents, b: Cents): Cents {
    const result = a - b;
    assertInteger(result, 'subtractCents result');
    return result as Cents;
}

export function multiplyCents(a: Cents, factor: number): Cents {
    assertInteger(factor, 'multiplyCents factor');
    const result = a * factor;
    assertInteger(result, 'multiplyCents result');
    return result as Cents;
}

export function centsToUsd(value: Cents): string {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    const dollars = Math.floor(abs / 100);
    const remainder = abs % 100;
    return `${sign}$${dollars}.${String(remainder).padStart(2, '0')}`;
}

// ── Microcents Arithmetic ──────────────────────────────────────────────

export function addMicrocents(a: Microcents, b: Microcents): Microcents {
    const result = a + b;
    assertInteger(result, 'addMicrocents result');
    return result as Microcents;
}

export function subtractMicrocents(a: Microcents, b: Microcents): Microcents {
    const result = a - b;
    assertInteger(result, 'subtractMicrocents result');
    return result as Microcents;
}

// ── Conversions ────────────────────────────────────────────────────────

const MICROCENTS_PER_CENT = 1_000_000;

/**
 * Convert microcents to cents, rounding up (ceiling).
 * Used when converting model pricing to spend tracking amounts.
 * Ceiling ensures we never under-report costs.
 */
export function microcentsToCentsCeil(value: Microcents): Cents {
    const result = Math.ceil(value / MICROCENTS_PER_CENT);
    return result as Cents;
}

/**
 * Convert cents to microcents (lossless).
 */
export function centsToMicrocents(value: Cents): Microcents {
    const result = value * MICROCENTS_PER_CENT;
    assertInteger(result, 'centsToMicrocents result');
    return result as Microcents;
}

/**
 * Calculate inference cost from token counts and per-million-token pricing.
 * Returns cost in Cents (rounded up to nearest cent).
 *
 * Formula: cost = ceil((inputTokens * inputPriceMicro + outputTokens * outputPriceMicro) / 1_000_000)
 *
 * The division by 1_000_000 converts from "per million tokens × microcents" to cents.
 */
export function calculateInferenceCost(
    inputTokens: number,
    outputTokens: number,
    inputPriceMicroPerMillion: Microcents,
    outputPriceMicroPerMillion: Microcents,
): Cents {
    assertNonNegative(inputTokens, 'inputTokens');
    assertNonNegative(outputTokens, 'outputTokens');

    // Cost in microcents: (tokens / 1_000_000) * pricePerMillion
    // Rewritten to avoid intermediate floating point:
    // costMicro = (tokens * pricePerMillion) / 1_000_000
    const inputCostMicro = Math.ceil(
        (inputTokens * inputPriceMicroPerMillion) / 1_000_000,
    );
    const outputCostMicro = Math.ceil(
        (outputTokens * outputPriceMicroPerMillion) / 1_000_000,
    );

    const totalMicro = microcents(inputCostMicro + outputCostMicro);
    return microcentsToCentsCeil(totalMicro);
}

// ── Comparisons ────────────────────────────────────────────────────────

export function centsGt(a: Cents, b: Cents): boolean {
    return a > b;
}

export function centsGte(a: Cents, b: Cents): boolean {
    return a >= b;
}

export function centsLt(a: Cents, b: Cents): boolean {
    return a < b;
}

export function centsLte(a: Cents, b: Cents): boolean {
    return a <= b;
}

export function centsEq(a: Cents, b: Cents): boolean {
    return a === b;
}

/** Zero cents constant. */
export const ZERO_CENTS = cents(0);

/** Zero microcents constant. */
export const ZERO_MICROCENTS = microcents(0);
