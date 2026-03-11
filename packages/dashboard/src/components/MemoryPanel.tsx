import { useState, useEffect } from 'react';
import './MemoryPanel.css';

interface TierStat {
    tier: string;
    count: number;
    totalTokens: number;
}

export function MemoryPanel() {
    const [stats, setStats] = useState<TierStat[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/memory/stats')
            .then(r => r.json())
            .then(data => {
                setStats(data.tiers ?? []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="memory-panel">
                <div className="panel-skeleton" />
            </div>
        );
    }

    const TIER_ICONS: Record<string, string> = {
        working: 'W',
        episodic: 'E',
        semantic: 'S',
        procedural: 'P',
        relationship: 'R',
    };

    return (
        <div className="memory-panel">
            <h3 className="panel-title">Memory Tiers</h3>
            <div className="memory-grid">
                {stats.length === 0 ? (
                    <div className="memory-empty">No memory data yet</div>
                ) : (
                    stats.map(s => (
                        <div key={s.tier} className="memory-tier-card">
                            <span className="tier-icon">{TIER_ICONS[s.tier] ?? '*'}</span>
                            <span className="tier-name">{s.tier}</span>
                            <span className="tier-count">{s.count} entries</span>
                            <span className="tier-tokens">{(s.totalTokens ?? 0).toLocaleString()} tokens</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
