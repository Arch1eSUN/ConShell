/**
 * Tests for SpendTracker + TreasuryPolicy
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpendTracker, TreasuryPolicy } from './spend-tracker.js';

describe('SpendTracker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('records spending and retrieves totals', () => {
        const tracker = new SpendTracker();
        tracker.record(100, 'inference');
        tracker.record(200, 'inference');

        const hourly = tracker.getWindow('hour');
        expect(hourly.spent).toBe(300);
        expect(hourly.recordCount).toBe(2);
    });

    it('getWindow defaults match policy', () => {
        const tracker = new SpendTracker({ maxHourly: 5000, maxDaily: 20000 });
        const hourly = tracker.getWindow('hour');
        const daily = tracker.getWindow('day');

        expect(hourly.limit).toBe(5000);
        expect(hourly.remaining).toBe(5000);
        expect(daily.limit).toBe(20000);
        expect(daily.remaining).toBe(20000);
    });

    it('window excludes expired records', () => {
        const tracker = new SpendTracker();

        // Record at T=0
        tracker.record(100);

        // Advance 2 hours
        vi.advanceTimersByTime(2 * 60 * 60_000);
        tracker.record(50);

        const hourly = tracker.getWindow('hour');
        expect(hourly.spent).toBe(50); // only the recent record
        expect(hourly.recordCount).toBe(1);

        const daily = tracker.getWindow('day');
        expect(daily.spent).toBe(150); // both records still in daily window
        expect(daily.recordCount).toBe(2);
    });

    it('canSpend respects per-payment cap', () => {
        const tracker = new SpendTracker({ maxPerPayment: 100 });
        expect(tracker.canSpend(100)).toBe(true);
        expect(tracker.canSpend(101)).toBe(false);
    });

    it('canSpend respects hourly limit', () => {
        const tracker = new SpendTracker({ maxHourly: 300 });
        tracker.record(200);
        expect(tracker.canSpend(100)).toBe(true);
        expect(tracker.canSpend(101)).toBe(false);
    });

    it('canSpend respects daily limit', () => {
        const tracker = new SpendTracker({ maxDaily: 500 });
        tracker.record(400);
        expect(tracker.canSpend(100)).toBe(true);
        expect(tracker.canSpend(101)).toBe(false);
    });

    it('prune removes old records', () => {
        const tracker = new SpendTracker();
        tracker.record(100);

        vi.advanceTimersByTime(25 * 60 * 60_000); // 25 hours
        tracker.record(50);

        const pruned = tracker.prune('day');
        expect(pruned).toBe(1);
        expect(tracker.getRecords().length).toBe(1);
    });

    it('getRecords returns copy', () => {
        const tracker = new SpendTracker();
        tracker.record(100);
        const records = tracker.getRecords();
        expect(records.length).toBe(1);
        expect(records[0]!.amountCents).toBe(100);
        expect(records[0]!.category).toBe('general');
    });
});

describe('TreasuryPolicy', () => {
    it('allows payment within all limits', () => {
        const policy = new TreasuryPolicy();
        const result = policy.enforce(100, 5000);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it('rejects payment exceeding per-payment cap', () => {
        const policy = new TreasuryPolicy({ maxPerPayment: 200 });
        const result = policy.enforce(201, 5000);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('per-payment cap');
    });

    it('rejects payment that would drop below minimum reserve', () => {
        const policy = new TreasuryPolicy({ minimumReserve: 100 });
        const result = policy.enforce(250, 300);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('minimum reserve');
    });

    it('integrates with SpendTracker for window checks', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));

        const tracker = new SpendTracker({ maxHourly: 300 });
        tracker.record(250);

        const policy = new TreasuryPolicy({ maxPerPayment: 500 });
        const result = policy.enforce(100, 5000, tracker);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Hourly');

        vi.useRealTimers();
    });

    it('uses default config values', () => {
        const policy = new TreasuryPolicy();
        expect(policy.config.maxPerPayment).toBe(500);
        expect(policy.config.maxHourly).toBe(2000);
        expect(policy.config.maxDaily).toBe(10000);
        expect(policy.config.minimumReserve).toBe(100);
    });
});
