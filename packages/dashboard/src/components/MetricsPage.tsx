import { useState, useEffect, useCallback } from 'react';

interface MetricEntry {
    label: string;
    value: string;
    change?: string;
    trend?: 'up' | 'down' | 'flat';
}

const TREND_ICON: Record<string, string> = { up: '↑', down: '↓', flat: '→' };

export function MetricsPage() {
    const [metrics, setMetrics] = useState<MetricEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchMetrics = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/status');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const built: MetricEntry[] = [
                { label: 'Total Turns', value: String(data.totalTurns ?? 0), trend: 'flat' },
                { label: 'Inference Cost', value: `$${((data.lifetimeSpendMicros ?? 0) / 1_000_000).toFixed(4)}`, trend: 'flat' },
                { label: 'Uptime', value: data.uptime ? formatUptime(data.uptime) : '—', trend: 'up' },
                { label: 'Memory Items', value: String(data.memoryCount ?? 0), trend: 'flat' },
                { label: 'Active Children', value: String(data.childCount ?? 0), trend: 'flat' },
                { label: 'State', value: data.state ?? 'unknown', trend: 'flat' },
                { label: 'Balance', value: data.balanceMicros != null ? `$${(data.balanceMicros / 1_000_000).toFixed(2)}` : '—', trend: 'flat' },
                { label: 'Survival Tier', value: data.currentTier ?? '—', trend: 'flat' },
            ];
            setMetrics(built);
        } catch {
            setMetrics([
                { label: 'Server', value: 'Offline', trend: 'down' },
            ]);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

    return (
        <div className="page-metrics">
            <header className="page-header">
                <h2 className="page-title">Metrics</h2>
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

            {loading && <div className="settings-empty" style={{ marginTop: '1rem' }}>Loading metrics...</div>}

            <div className="settings-card" style={{ marginTop: '1rem' }}>
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Cost Breakdown</div>
                        <div className="settings-card-subtitle">Inference spend by provider and model</div>
                    </div>
                    <button className="settings-btn settings-btn-secondary" onClick={fetchMetrics}>Refresh</button>
                </div>
                <div className="settings-empty" style={{ marginTop: '0.75rem' }}>
                    Detailed per-model cost tracking coming soon.
                </div>
            </div>
        </div>
    );
}

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}
