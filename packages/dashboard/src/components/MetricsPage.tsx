import { useState } from 'react';

interface MetricEntry {
    label: string;
    value: string;
    change?: string;
    trend?: 'up' | 'down' | 'flat';
}

const METRICS: MetricEntry[] = [
    { label: 'Total Turns', value: '0', change: '+0 today', trend: 'flat' },
    { label: 'Inference Cost', value: '$0.00', change: '$0.00 today', trend: 'flat' },
    { label: 'Tool Calls', value: '0', change: '+0 today', trend: 'flat' },
    { label: 'Avg Latency', value: '0ms', trend: 'flat' },
    { label: 'Uptime', value: '0h 0m', trend: 'up' },
    { label: 'Memory Items', value: '0', change: '+0 today', trend: 'flat' },
    { label: 'Active Children', value: '0', trend: 'flat' },
    { label: 'Social Messages', value: '0', change: '+0 today', trend: 'flat' },
];

const TREND_ICON: Record<string, string> = { up: '↑', down: '↓', flat: '→' };

export function MetricsPage() {
    const [metrics] = useState<MetricEntry[]>(METRICS);

    return (
        <div className="page-metrics">
            <header className="page-header">
                <h2 className="page-title">📊 Metrics</h2>
                <p className="page-subtitle">Runtime performance and cost tracking</p>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                {metrics.map(m => (
                    <div key={m.label} className="settings-card" style={{ textAlign: 'center', padding: '1.25rem' }}>
                        <div className="settings-card-subtitle">{m.label}</div>
                        <div style={{ fontSize: '2rem', fontWeight: 700, margin: '0.5rem 0', fontVariantNumeric: 'tabular-nums' }}>
                            {m.value}
                        </div>
                        {m.change && (
                            <div className="provider-item-type">
                                {TREND_ICON[m.trend ?? 'flat']} {m.change}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="settings-card" style={{ marginTop: '1rem' }}>
                <div className="settings-card-title">Cost Breakdown</div>
                <div className="settings-card-subtitle">Inference spend by provider and model</div>
                <div className="settings-empty" style={{ marginTop: '0.75rem' }}>
                    No cost data yet. Start chatting to accumulate metrics.
                </div>
            </div>
        </div>
    );
}
