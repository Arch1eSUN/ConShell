/**
 * Metrics + Alert Engine — Rule-based metric evaluation with cooldowns and critical wake.
 *
 * Features:
 * - Collect metric snapshots from various subsystems
 * - Evaluate alert rules against snapshots
 * - Cooldown-based deduplication
 * - Critical alert → agent wake trigger
 * - Alert history and status tracking
 *
 * Conway equivalent: metric_engine + alert_system
 */
import type { Logger } from '@conshell/core';

// ── Types ──────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type MetricValue = number | string | boolean;

export interface Metric {
    readonly name: string;
    readonly value: MetricValue;
    readonly unit?: string;
    readonly tags?: Record<string, string>;
    readonly timestamp: number;
}

export interface MetricSnapshot {
    readonly metrics: readonly Metric[];
    readonly timestamp: number;
}

export interface AlertRule {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly severity: AlertSeverity;
    /** Metric name to evaluate. */
    readonly metricName: string;
    /** Evaluate function: returns true if alert should fire. */
    readonly evaluate: (value: MetricValue) => boolean;
    /** Cooldown in ms before the same alert can fire again. */
    readonly cooldownMs: number;
    /** If true, this alert triggers an agent wake event. */
    readonly triggerWake?: boolean;
}

export interface Alert {
    readonly ruleId: string;
    readonly ruleName: string;
    readonly severity: AlertSeverity;
    readonly metricName: string;
    readonly metricValue: MetricValue;
    readonly message: string;
    readonly timestamp: number;
    readonly triggerWake: boolean;
}

export interface AlertEngineConfig {
    /** Max alert history to retain. */
    maxHistory?: number;
    /** Default cooldown in ms if rule doesn't specify. */
    defaultCooldownMs?: number;
    /** Callback when wake should be triggered. */
    onWake?: (alert: Alert) => void;
}

// ── Alert Engine ───────────────────────────────────────────────────────

export class MetricsAlertEngine {
    private readonly rules: Map<string, AlertRule> = new Map();
    private readonly cooldowns: Map<string, number> = new Map(); // ruleId → lastFiredAt
    private readonly history: Alert[] = [];
    private readonly config: Required<AlertEngineConfig>;
    private readonly logger: Logger;

    constructor(logger: Logger, config?: AlertEngineConfig) {
        this.logger = logger;
        this.config = {
            maxHistory: config?.maxHistory ?? 200,
            defaultCooldownMs: config?.defaultCooldownMs ?? 300_000, // 5 min
            onWake: config?.onWake ?? (() => {}),
        };
    }

    // ── Rule management ─────────────────────────────────────────────────

    addRule(rule: AlertRule): void {
        this.rules.set(rule.id, rule);
        this.logger.debug('Alert rule added', { id: rule.id, name: rule.name });
    }

    removeRule(ruleId: string): boolean {
        return this.rules.delete(ruleId);
    }

    getRules(): readonly AlertRule[] {
        return [...this.rules.values()];
    }

    // ── Evaluation ──────────────────────────────────────────────────────

    /**
     * Evaluate all rules against a metric snapshot. Returns fired alerts.
     */
    evaluate(snapshot: MetricSnapshot): readonly Alert[] {
        const fired: Alert[] = [];
        const now = Date.now();

        for (const rule of this.rules.values()) {
            // Find the metric this rule watches
            const metric = snapshot.metrics.find(m => m.name === rule.metricName);
            if (!metric) continue;

            // Check cooldown
            const lastFired = this.cooldowns.get(rule.id) ?? 0;
            const cooldown = rule.cooldownMs || this.config.defaultCooldownMs;
            if (now - lastFired < cooldown) continue;

            // Evaluate
            if (rule.evaluate(metric.value)) {
                const alert: Alert = {
                    ruleId: rule.id,
                    ruleName: rule.name,
                    severity: rule.severity,
                    metricName: rule.metricName,
                    metricValue: metric.value,
                    message: `[${rule.severity.toUpperCase()}] ${rule.name}: ${rule.metricName} = ${metric.value}`,
                    timestamp: now,
                    triggerWake: rule.triggerWake ?? false,
                };

                fired.push(alert);
                this.history.push(alert);
                this.cooldowns.set(rule.id, now);

                this.logger.warn('Alert fired', {
                    rule: rule.name,
                    severity: rule.severity,
                    metric: rule.metricName,
                    value: metric.value,
                });

                // Trigger wake if needed
                if (alert.triggerWake) {
                    this.config.onWake(alert);
                }
            }
        }

        // Trim history
        while (this.history.length > this.config.maxHistory) {
            this.history.shift();
        }

        return fired;
    }

    // ── History & Status ────────────────────────────────────────────────

    getHistory(limit?: number): readonly Alert[] {
        const n = limit ?? this.history.length;
        return this.history.slice(-n);
    }

    getHistoryBySeverity(severity: AlertSeverity, limit = 50): readonly Alert[] {
        return this.history
            .filter(a => a.severity === severity)
            .slice(-limit);
    }

    clearHistory(): void {
        this.history.length = 0;
    }

    clearCooldowns(): void {
        this.cooldowns.clear();
    }

    get totalAlerts(): number {
        return this.history.length;
    }

    get activeRuleCount(): number {
        return this.rules.size;
    }
}

// ── Built-in Rule Presets ────────────────────────────────────────────────

export const BUILTIN_ALERT_RULES: readonly AlertRule[] = [
    {
        id: 'balance_critical',
        name: 'Balance Critical',
        description: 'Balance dropped below emergency threshold',
        severity: 'critical',
        metricName: 'balance_usdc',
        evaluate: (v) => typeof v === 'number' && v < 0.5,
        cooldownMs: 600_000, // 10 min
        triggerWake: true,
    },
    {
        id: 'balance_low',
        name: 'Balance Low',
        description: 'Balance is below comfortable threshold',
        severity: 'warning',
        metricName: 'balance_usdc',
        evaluate: (v) => typeof v === 'number' && v < 5.0,
        cooldownMs: 1_800_000, // 30 min
    },
    {
        id: 'memory_high',
        name: 'Memory Usage High',
        description: 'Process memory usage above 80%',
        severity: 'warning',
        metricName: 'memory_usage_pct',
        evaluate: (v) => typeof v === 'number' && v > 80,
        cooldownMs: 300_000,
    },
    {
        id: 'error_rate_spike',
        name: 'Error Rate Spike',
        description: 'Error rate exceeded 10% in the current window',
        severity: 'critical',
        metricName: 'error_rate_pct',
        evaluate: (v) => typeof v === 'number' && v > 10,
        cooldownMs: 600_000,
        triggerWake: true,
    },
    {
        id: 'child_unhealthy',
        name: 'Child Agent Unhealthy',
        description: 'One or more child agents in error state',
        severity: 'warning',
        metricName: 'unhealthy_children_count',
        evaluate: (v) => typeof v === 'number' && v > 0,
        cooldownMs: 300_000,
    },
    {
        id: 'disk_space_low',
        name: 'Disk Space Low',
        description: 'Available disk space below 1GB',
        severity: 'warning',
        metricName: 'disk_available_gb',
        evaluate: (v) => typeof v === 'number' && v < 1,
        cooldownMs: 3_600_000, // 1 hr
        triggerWake: true,
    },
];
