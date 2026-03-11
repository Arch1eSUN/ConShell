/**
 * SpendTracker + TreasuryPolicy — x402 spend guardrails.
 *
 * SpendTracker tracks spending by time windows (hourly/daily).
 * TreasuryPolicy enforces configurable payment limits.
 */

// ── Types ──────────────────────────────────────────────────────────────

export type SpendPeriod = 'hour' | 'day';

export interface SpendRecord {
    readonly amountCents: number;
    readonly category: string;
    readonly timestamp: number; // epoch ms
}

export interface SpendWindow {
    readonly period: SpendPeriod;
    readonly spent: number;
    readonly limit: number;
    readonly remaining: number;
    readonly recordCount: number;
}

export interface TreasuryPolicyConfig {
    /** Max cents per single payment (default 500 = $5) */
    readonly maxPerPayment: number;
    /** Max cents per hour (default 2000 = $20) */
    readonly maxHourly: number;
    /** Max cents per day (default 10000 = $100) */
    readonly maxDaily: number;
    /** Minimum reserve in cents — refuse if balance would drop below this (default 100 = $1) */
    readonly minimumReserve: number;
}

export interface PolicyEnforcement {
    readonly allowed: boolean;
    readonly reason?: string;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_POLICY: TreasuryPolicyConfig = {
    maxPerPayment: 500,
    maxHourly: 2000,
    maxDaily: 10000,
    minimumReserve: 100,
};

const PERIOD_MS: Record<SpendPeriod, number> = {
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
};

// ── SpendTracker ───────────────────────────────────────────────────────

export class SpendTracker {
    private readonly records: SpendRecord[] = [];
    private readonly policy: TreasuryPolicyConfig;

    constructor(policy?: Partial<TreasuryPolicyConfig>) {
        this.policy = { ...DEFAULT_POLICY, ...policy };
    }

    /** Record a spend event */
    record(amountCents: number, category: string = 'general'): void {
        this.records.push({
            amountCents,
            category,
            timestamp: Date.now(),
        });
    }

    /** Get spend totals for a time window */
    getWindow(period: SpendPeriod): SpendWindow {
        const cutoff = Date.now() - PERIOD_MS[period];
        const inWindow = this.records.filter(r => r.timestamp > cutoff);
        const spent = inWindow.reduce((sum, r) => sum + r.amountCents, 0);
        const limit = period === 'hour' ? this.policy.maxHourly : this.policy.maxDaily;

        return {
            period,
            spent,
            limit,
            remaining: Math.max(0, limit - spent),
            recordCount: inWindow.length,
        };
    }

    /** Check if spending the given amount would exceed any window limit */
    canSpend(amountCents: number): boolean {
        // Per-payment check
        if (amountCents > this.policy.maxPerPayment) return false;

        // Hourly window
        const hourly = this.getWindow('hour');
        if (hourly.spent + amountCents > hourly.limit) return false;

        // Daily window
        const daily = this.getWindow('day');
        if (daily.spent + amountCents > daily.limit) return false;

        return true;
    }

    /** Get all records (for auditing) */
    getRecords(): readonly SpendRecord[] {
        return [...this.records];
    }

    /** Prune records older than the given period */
    prune(maxAge: SpendPeriod = 'day'): number {
        const cutoff = Date.now() - PERIOD_MS[maxAge];
        const before = this.records.length;
        const keep = this.records.filter(r => r.timestamp > cutoff);
        this.records.length = 0;
        this.records.push(...keep);
        return before - keep.length;
    }
}

// ── TreasuryPolicy ─────────────────────────────────────────────────────

export class TreasuryPolicy {
    readonly config: TreasuryPolicyConfig;

    constructor(config?: Partial<TreasuryPolicyConfig>) {
        this.config = { ...DEFAULT_POLICY, ...config };
    }

    /**
     * Enforce all treasury rules for a proposed payment.
     * @param amountCents — proposed spend amount
     * @param currentBalanceCents — current balance (credits/wallet)
     * @param tracker — optional SpendTracker for window checks
     */
    enforce(
        amountCents: number,
        currentBalanceCents: number,
        tracker?: SpendTracker,
    ): PolicyEnforcement {
        // 1. Per-payment cap
        if (amountCents > this.config.maxPerPayment) {
            return {
                allowed: false,
                reason: `Payment of ${amountCents}¢ exceeds per-payment cap of ${this.config.maxPerPayment}¢`,
            };
        }

        // 2. Minimum reserve
        if (currentBalanceCents - amountCents < this.config.minimumReserve) {
            return {
                allowed: false,
                reason: `Balance would drop to ${currentBalanceCents - amountCents}¢, below minimum reserve of ${this.config.minimumReserve}¢`,
            };
        }

        // 3. Window checks (if tracker provided)
        if (tracker && !tracker.canSpend(amountCents)) {
            const hourly = tracker.getWindow('hour');
            const daily = tracker.getWindow('day');

            if (hourly.spent + amountCents > hourly.limit) {
                return {
                    allowed: false,
                    reason: `Hourly spend would be ${hourly.spent + amountCents}¢, exceeds limit of ${hourly.limit}¢`,
                };
            }
            if (daily.spent + amountCents > daily.limit) {
                return {
                    allowed: false,
                    reason: `Daily spend would be ${daily.spent + amountCents}¢, exceeds limit of ${daily.limit}¢`,
                };
            }
        }

        return { allowed: true };
    }
}
