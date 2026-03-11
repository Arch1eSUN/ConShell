/**
 * MetricsCollector — Counters, Gauges, and Histograms for agent observability.
 *
 * Conway port: src/observability/metrics.ts
 * Pure in-memory with periodic snapshot to DB via heartbeat.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface MetricSnapshot {
    readonly name: string;
    readonly type: 'counter' | 'gauge' | 'histogram';
    readonly value: number;
    /** For histograms: percentile breakdown */
    readonly percentiles?: Record<string, number>;
    readonly labels?: Record<string, string>;
    readonly timestamp: string;
}

export interface AlertRule {
    readonly name: string;
    readonly metric: string;
    readonly condition: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
    readonly threshold: number;
    readonly severity: 'warning' | 'critical';
    readonly message: string;
    readonly cooldownMs: number;
}

export interface Alert {
    readonly rule: string;
    readonly severity: 'warning' | 'critical';
    readonly message: string;
    readonly currentValue: number;
    readonly threshold: number;
    readonly firedAt: string;
}

// ── Counter ─────────────────────────────────────────────────────────────

class Counter {
    private _value = 0;
    inc(amount = 1) { this._value += Math.max(0, amount); }
    get value() { return this._value; }
    reset() { this._value = 0; }
}

// ── Gauge ───────────────────────────────────────────────────────────────

class Gauge {
    private _value = 0;
    set(v: number) { this._value = v; }
    inc(amount = 1) { this._value += amount; }
    dec(amount = 1) { this._value -= amount; }
    get value() { return this._value; }
}

// ── Histogram ───────────────────────────────────────────────────────────

class Histogram {
    private values: number[] = [];
    private readonly maxSize: number;

    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
    }

    observe(value: number) {
        this.values.push(value);
        if (this.values.length > this.maxSize) {
            this.values = this.values.slice(-this.maxSize);
        }
    }

    get count() { return this.values.length; }

    get sum() {
        return this.values.reduce((s, v) => s + v, 0);
    }

    get avg() {
        return this.values.length > 0 ? this.sum / this.values.length : 0;
    }

    percentile(p: number): number {
        if (this.values.length === 0) return 0;
        const sorted = [...this.values].sort((a, b) => a - b);
        const idx = Math.min(
            Math.ceil((p / 100) * sorted.length) - 1,
            sorted.length - 1,
        );
        return sorted[Math.max(0, idx)]!;
    }

    get percentiles(): Record<string, number> {
        return {
            p50: this.percentile(50),
            p90: this.percentile(90),
            p95: this.percentile(95),
            p99: this.percentile(99),
        };
    }

    reset() { this.values = []; }
}

// ── MetricsCollector ────────────────────────────────────────────────────

export class MetricsCollector {
    private readonly counters = new Map<string, Counter>();
    private readonly gauges = new Map<string, Gauge>();
    private readonly histograms = new Map<string, Histogram>();

    // ── Counter ops ─────────────────────────────────────────────────────

    counter(name: string): Counter {
        let c = this.counters.get(name);
        if (!c) { c = new Counter(); this.counters.set(name, c); }
        return c;
    }

    incCounter(name: string, amount = 1) {
        this.counter(name).inc(amount);
    }

    // ── Gauge ops ───────────────────────────────────────────────────────

    gauge(name: string): Gauge {
        let g = this.gauges.get(name);
        if (!g) { g = new Gauge(); this.gauges.set(name, g); }
        return g;
    }

    setGauge(name: string, value: number) {
        this.gauge(name).set(value);
    }

    // ── Histogram ops ───────────────────────────────────────────────────

    histogram(name: string, maxSize?: number): Histogram {
        let h = this.histograms.get(name);
        if (!h) { h = new Histogram(maxSize); this.histograms.set(name, h); }
        return h;
    }

    observe(name: string, value: number) {
        this.histogram(name).observe(value);
    }

    // ── Snapshot ─────────────────────────────────────────────────────────

    /**
     * Export all metrics as snapshots (for DB persistence).
     */
    snapshot(): MetricSnapshot[] {
        const ts = new Date().toISOString();
        const result: MetricSnapshot[] = [];

        for (const [name, counter] of this.counters) {
            result.push({ name, type: 'counter', value: counter.value, timestamp: ts });
        }
        for (const [name, gauge] of this.gauges) {
            result.push({ name, type: 'gauge', value: gauge.value, timestamp: ts });
        }
        for (const [name, hist] of this.histograms) {
            result.push({
                name,
                type: 'histogram',
                value: hist.avg,
                percentiles: hist.percentiles,
                timestamp: ts,
            });
        }

        return result;
    }

    /**
     * Get a summary object keyed by metric name.
     */
    summary(): Record<string, number> {
        const result: Record<string, number> = {};
        for (const [name, c] of this.counters) result[name] = c.value;
        for (const [name, g] of this.gauges) result[name] = g.value;
        for (const [name, h] of this.histograms) result[`${name}_avg`] = h.avg;
        return result;
    }
}

// ── AlertEngine ─────────────────────────────────────────────────────────

export class AlertEngine {
    private readonly rules: AlertRule[] = [];
    private readonly lastFired = new Map<string, number>();
    private readonly firedAlerts: Alert[] = [];

    addRule(rule: AlertRule) {
        this.rules.push(rule);
    }

    addRules(rules: AlertRule[]) {
        for (const r of rules) this.addRule(r);
    }

    /**
     * Evaluate all rules against current metrics.
     * Returns newly fired alerts (respects cooldown).
     */
    evaluate(metrics: MetricsCollector): Alert[] {
        const now = Date.now();
        const summary = metrics.summary();
        const newAlerts: Alert[] = [];

        for (const rule of this.rules) {
            const currentValue = summary[rule.metric];
            if (currentValue === undefined) continue;

            const triggered = this.checkCondition(currentValue, rule.condition, rule.threshold);
            if (!triggered) continue;

            // Cooldown check
            const lastTime = this.lastFired.get(rule.name) ?? 0;
            if (now - lastTime < rule.cooldownMs) continue;

            const alert: Alert = {
                rule: rule.name,
                severity: rule.severity,
                message: rule.message,
                currentValue,
                threshold: rule.threshold,
                firedAt: new Date().toISOString(),
            };

            newAlerts.push(alert);
            this.firedAlerts.push(alert);
            this.lastFired.set(rule.name, now);
        }

        return newAlerts;
    }

    /**
     * Get all historically fired alerts.
     */
    getAlerts(limit = 50): readonly Alert[] {
        return this.firedAlerts.slice(-limit);
    }

    /**
     * Get count of active rules.
     */
    getRuleCount(): number {
        return this.rules.length;
    }

    private checkCondition(value: number, cond: AlertRule['condition'], threshold: number): boolean {
        switch (cond) {
            case 'gt': return value > threshold;
            case 'lt': return value < threshold;
            case 'gte': return value >= threshold;
            case 'lte': return value <= threshold;
            case 'eq': return value === threshold;
        }
    }
}

// ── Default Alert Rules (Conway-style) ──────────────────────────────────

export const DEFAULT_ALERT_RULES: AlertRule[] = [
    {
        name: 'low_balance',
        metric: 'balance_cents',
        condition: 'lt',
        threshold: 100,
        severity: 'critical',
        message: 'Agent balance critically low (< $1.00)',
        cooldownMs: 300_000,
    },
    {
        name: 'high_error_rate',
        metric: 'errors_total',
        condition: 'gt',
        threshold: 50,
        severity: 'warning',
        message: 'High error count detected (> 50)',
        cooldownMs: 600_000,
    },
    {
        name: 'high_rejection_rate',
        metric: 'policy_denials_total',
        condition: 'gt',
        threshold: 20,
        severity: 'warning',
        message: 'High policy denial rate (> 20)',
        cooldownMs: 600_000,
    },
    {
        name: 'budget_exhausted',
        metric: 'hourly_spend_cents',
        condition: 'gt',
        threshold: 500,
        severity: 'critical',
        message: 'Hourly spend exceeds $5.00 limit',
        cooldownMs: 3600_000,
    },
    {
        name: 'too_many_turns',
        metric: 'turns_this_hour',
        condition: 'gt',
        threshold: 200,
        severity: 'warning',
        message: 'Excessive turns this hour (> 200)',
        cooldownMs: 3600_000,
    },
];
