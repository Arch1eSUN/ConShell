/**
 * Tests for MetricsCollector and AlertEngine.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector, AlertEngine, DEFAULT_ALERT_RULES } from './observability.js';

describe('MetricsCollector', () => {
    let metrics: MetricsCollector;

    beforeEach(() => {
        metrics = new MetricsCollector();
    });

    // ── Counters ────────────────────────────────────────────────────────

    it('increments counter', () => {
        metrics.incCounter('requests');
        metrics.incCounter('requests');
        metrics.incCounter('requests', 3);
        expect(metrics.counter('requests').value).toBe(5);
    });

    it('counter ignores negative increments', () => {
        metrics.incCounter('x', -5);
        expect(metrics.counter('x').value).toBe(0);
    });

    it('counter reset works', () => {
        metrics.incCounter('y', 10);
        metrics.counter('y').reset();
        expect(metrics.counter('y').value).toBe(0);
    });

    // ── Gauges ──────────────────────────────────────────────────────────

    it('sets gauge value', () => {
        metrics.setGauge('cpu', 42);
        expect(metrics.gauge('cpu').value).toBe(42);

        metrics.setGauge('cpu', 88);
        expect(metrics.gauge('cpu').value).toBe(88);
    });

    it('gauge inc/dec', () => {
        metrics.gauge('active').inc(5);
        metrics.gauge('active').dec(2);
        expect(metrics.gauge('active').value).toBe(3);
    });

    // ── Histograms ──────────────────────────────────────────────────────

    it('observes histogram values', () => {
        metrics.observe('latency', 100);
        metrics.observe('latency', 200);
        metrics.observe('latency', 300);

        const h = metrics.histogram('latency');
        expect(h.count).toBe(3);
        expect(h.sum).toBe(600);
        expect(h.avg).toBe(200);
    });

    it('computes histogram percentiles', () => {
        for (let i = 1; i <= 100; i++) {
            metrics.observe('response_time', i);
        }
        const h = metrics.histogram('response_time');
        expect(h.percentile(50)).toBe(50);
        expect(h.percentile(90)).toBe(90);
        expect(h.percentile(99)).toBe(99);
    });

    it('empty histogram returns 0', () => {
        const h = metrics.histogram('empty');
        expect(h.avg).toBe(0);
        expect(h.percentile(50)).toBe(0);
    });

    it('histogram respects max size', () => {
        const h = metrics.histogram('bounded', 5);
        for (let i = 0; i < 10; i++) h.observe(i);
        expect(h.count).toBe(5);
    });

    // ── Snapshot ─────────────────────────────────────────────────────────

    it('snapshot captures all metrics', () => {
        metrics.incCounter('a');
        metrics.setGauge('b', 42);
        metrics.observe('c', 100);

        const snap = metrics.snapshot();
        expect(snap).toHaveLength(3);

        const names = snap.map(s => s.name);
        expect(names).toContain('a');
        expect(names).toContain('b');
        expect(names).toContain('c');
    });

    it('summary returns flat key-value pairs', () => {
        metrics.incCounter('req', 10);
        metrics.setGauge('active', 5);
        metrics.observe('latency', 100);

        const s = metrics.summary();
        expect(s['req']).toBe(10);
        expect(s['active']).toBe(5);
        expect(s['latency_avg']).toBe(100);
    });
});

describe('AlertEngine', () => {
    let metrics: MetricsCollector;
    let engine: AlertEngine;

    beforeEach(() => {
        metrics = new MetricsCollector();
        engine = new AlertEngine();
    });

    it('fires alert when threshold exceeded', () => {
        engine.addRule({
            name: 'test_alert',
            metric: 'errors_total',
            condition: 'gt',
            threshold: 10,
            severity: 'warning',
            message: 'Too many errors',
            cooldownMs: 0,
        });

        metrics.incCounter('errors_total', 15);
        const alerts = engine.evaluate(metrics);
        expect(alerts).toHaveLength(1);
        expect(alerts[0]!.rule).toBe('test_alert');
        expect(alerts[0]!.currentValue).toBe(15);
    });

    it('does not fire when below threshold', () => {
        engine.addRule({
            name: 'quiet',
            metric: 'errors_total',
            condition: 'gt',
            threshold: 100,
            severity: 'warning',
            message: 'Too many errors',
            cooldownMs: 0,
        });

        metrics.incCounter('errors_total', 5);
        expect(engine.evaluate(metrics)).toHaveLength(0);
    });

    it('respects cooldown', () => {
        engine.addRule({
            name: 'cooldown_test',
            metric: 'x',
            condition: 'gt',
            threshold: 0,
            severity: 'critical',
            message: 'X too high',
            cooldownMs: 999_999_999,
        });

        metrics.incCounter('x', 1);
        expect(engine.evaluate(metrics)).toHaveLength(1);
        // Second evaluation should be cooldown-blocked
        expect(engine.evaluate(metrics)).toHaveLength(0);
    });

    it('supports lt condition', () => {
        engine.addRule({
            name: 'low',
            metric: 'balance',
            condition: 'lt',
            threshold: 50,
            severity: 'critical',
            message: 'Low balance',
            cooldownMs: 0,
        });

        metrics.setGauge('balance', 10);
        expect(engine.evaluate(metrics)).toHaveLength(1);
    });

    it('tracks alert history', () => {
        engine.addRule({
            name: 'hist',
            metric: 'z',
            condition: 'gte',
            threshold: 1,
            severity: 'warning',
            message: 'Z warning',
            cooldownMs: 0,
        });

        metrics.incCounter('z', 5);
        engine.evaluate(metrics);
        engine.evaluate(metrics);

        const history = engine.getAlerts();
        expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it('loads default rules', () => {
        engine.addRules(DEFAULT_ALERT_RULES);
        expect(engine.getRuleCount()).toBe(5);
    });

    it('ignores missing metrics', () => {
        engine.addRule({
            name: 'ghost',
            metric: 'nonexistent',
            condition: 'gt',
            threshold: 0,
            severity: 'warning',
            message: 'Ghost alert',
            cooldownMs: 0,
        });

        // Should not throw, just return empty
        expect(engine.evaluate(metrics)).toHaveLength(0);
    });
});
