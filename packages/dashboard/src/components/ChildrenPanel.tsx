import { usePolling } from '../lib/hooks';
import { api } from '../lib/api';
import './ChildrenPanel.css';

interface ChildAgent {
    id: string;
    state: 'spawning' | 'running' | 'dead';
    sandbox_id: string | null;
    funded_cents: number;
    spawned_at: string;
    died_at: string | null;
}

interface ChildrenResponse {
    children: ChildAgent[];
    aliveCount: number;
    totalCount: number;
}

function formatCents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

function formatTimeAgo(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function ChildrenPanel() {
    const { data, loading } = usePolling<ChildrenResponse>(
        () => api.children() as Promise<ChildrenResponse>,
        15000,
    );

    if (loading || !data) {
        return (
            <div className="children-panel">
                <h3>Child Agents</h3>
                <div className="children-empty">
                    <div className="children-empty-icon">🧬</div>
                    <p>Loading child agents…</p>
                </div>
            </div>
        );
    }

    const { children, aliveCount, totalCount } = data;

    return (
        <div className="children-panel">
            <h3>Child Agents</h3>
            <p className="children-subtitle">
                Autonomous replicas spawned by the primary agent
            </p>

            <div className="children-stats">
                <div className="children-stat">
                    Alive: <span className="children-stat-value">{aliveCount}</span>
                </div>
                <div className="children-stat">
                    Total: <span className="children-stat-value">{totalCount}</span>
                </div>
            </div>

            {children.length === 0 ? (
                <div className="children-empty">
                    <div className="children-empty-icon">🌱</div>
                    <p>No child agents spawned yet</p>
                </div>
            ) : (
                <div className="children-grid">
                    {children.map(child => (
                        <div className="child-card" key={child.id}>
                            <div className="child-card-header">
                                <span className="child-id">{child.id.slice(0, 8)}…</span>
                                <span className={`child-state ${child.state}`}>
                                    {child.state}
                                </span>
                            </div>
                            <div className="child-meta">
                                <div className="child-meta-row">
                                    <span>Funded</span>
                                    <span>{formatCents(child.funded_cents)}</span>
                                </div>
                                <div className="child-meta-row">
                                    <span>Spawned</span>
                                    <span>{formatTimeAgo(child.spawned_at)}</span>
                                </div>
                                {child.died_at && (
                                    <div className="child-meta-row">
                                        <span>Died</span>
                                        <span>{formatTimeAgo(child.died_at)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
