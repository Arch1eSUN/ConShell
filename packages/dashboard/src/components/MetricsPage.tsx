import { useState, useEffect, useCallback } from 'react';

interface MetricEntry {
    label: string;
    value: string;
    change?: string;
    trend?: 'up' | 'down' | 'flat';
}

interface ModelCost {
    model: string;
    turns: number;
    tokens: number;
    costMicros: number;
}

const TREND_ICON: Record<string, string> = { up: '↑', down: '↓', flat: '→' };

export function MetricsPage() {
    const [metrics, setMetrics] = useState<MetricEntry[]>([]);
    const [modelCosts, setModelCosts] = useState<ModelCost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchMetrics = useCallback(async () => {
        setLoading(true);
        setError('');
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

            // Fetch cost breakdown from turns
            try {
                const turnsRes = await fetch('/api/turns?limit=200');
                if (turnsRes.ok) {
                    const turnsData = await turnsRes.json();
                    const turns = turnsData.turns ?? [];
                    const byModel = new Map<string, ModelCost>();
                    for (const turn of turns) {
                        const model = String(turn.model ?? 'unknown');
                        const entry = byModel.get(model) ?? { model, turns: 0, tokens: 0, costMicros: 0 };
                        entry.turns += 1;
                        entry.tokens += Number(turn.totalTokens ?? turn.tokens ?? 0);
                        entry.costMicros += Number(turn.costMicros ?? 0);
                        byModel.set(model, entry);
                    }
                    setModelCosts(Array.from(byModel.values()).sort((a, b) => b.costMicros - a.costMicros));
                }
            } catch { /* ignore cost breakdown error — metrics still show */ }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load metrics');
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

            {error && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>⚠ {error}</span>
                    <button className="settings-btn settings-btn-secondary" onClick={fetchMetrics} style={{ fontSize: '0.8rem' }}>⟳ Retry</button>
                </div>
            )}

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
                        <div className="settings-card-subtitle">Inference spend by model</div>
                    </div>
                    <button className="settings-btn settings-btn-secondary" onClick={fetchMetrics}>Refresh</button>
                </div>

                {modelCosts.length > 0 ? (
                    <table style={{ width: '100%', marginTop: '0.75rem', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-subtle, #333)', textAlign: 'left' }}>
                                <th style={{ padding: '0.5rem 0', color: 'var(--ink-muted)' }}>Model</th>
                                <th style={{ padding: '0.5rem 0', color: 'var(--ink-muted)', textAlign: 'right' }}>Turns</th>
                                <th style={{ padding: '0.5rem 0', color: 'var(--ink-muted)', textAlign: 'right' }}>Tokens</th>
                                <th style={{ padding: '0.5rem 0', color: 'var(--ink-muted)', textAlign: 'right' }}>Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            {modelCosts.map(mc => (
                                <tr key={mc.model} style={{ borderBottom: '1px solid var(--border-subtle, #222)' }}>
                                    <td style={{ padding: '0.5rem 0', fontFamily: 'monospace', fontSize: '0.85rem' }}>{mc.model}</td>
                                    <td style={{ padding: '0.5rem 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{mc.turns}</td>
                                    <td style={{ padding: '0.5rem 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{mc.tokens.toLocaleString()}</td>
                                    <td style={{ padding: '0.5rem 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--accent, #6366f1)' }}>${(mc.costMicros / 1_000_000).toFixed(4)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="settings-empty" style={{ marginTop: '0.75rem' }}>
                        No cost data available yet. Start chatting to generate usage metrics.
                    </div>
                )}
            </div>
        </div>
    );
}

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}
