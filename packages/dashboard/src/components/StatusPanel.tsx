import type { AgentStatus } from '../lib/api';
import './StatusPanel.css';

interface Props {
    status: AgentStatus | null;
    connected: boolean;
    loading: boolean;
}

const TIER_COLORS: Record<string, string> = {
    normal: 'var(--green)',
    conserve: 'var(--amber)',
    critical: 'var(--rose)',
    emergency: 'var(--rose)',
};

export function StatusPanel({ status, connected, loading }: Props) {
    if (loading) {
        return (
            <div className="status-panel">
                <div className="status-skeleton" />
            </div>
        );
    }

    const state = status?.agentState ?? 'unknown';
    const tier = status?.survivalTier ?? 'unknown';
    const isAlive = state === 'running';

    return (
        <div className="status-panel">
            <h3 className="status-title">Agent Status</h3>

            <div className="status-grid">
                {/* State */}
                <div className="status-item">
                    <span className="status-label">State</span>
                    <span className="status-value">
                        <span
                            className={`status-dot ${isAlive ? 'alive' : 'dead'}`}
                            aria-label={isAlive ? 'alive' : 'offline'}
                        />
                        {state}
                    </span>
                </div>

                {/* Tier */}
                <div className="status-item">
                    <span className="status-label">Survival Tier</span>
                    <span
                        className="status-value tier-badge"
                        style={{ '--tier-color': TIER_COLORS[tier] || 'var(--muted)' } as React.CSSProperties}
                    >
                        {tier}
                    </span>
                </div>

                {/* Connection */}
                <div className="status-item">
                    <span className="status-label">WebSocket</span>
                    <span className="status-value">
                        <span className={`status-dot ${connected ? 'alive' : 'dead'}`} />
                        {connected ? 'connected' : 'disconnected'}
                    </span>
                </div>

                {/* Children */}
                <div className="status-item">
                    <span className="status-label">Children</span>
                    <span className="status-value mono">
                        {status?.aliveChildren ?? 0} alive
                    </span>
                </div>
            </div>

            {status?.walletAddress && (
                <div className="status-wallet">
                    <span className="status-label">Wallet</span>
                    <code
                        className="wallet-address"
                        title={status.walletAddress}
                        onClick={() => navigator.clipboard.writeText(status.walletAddress!)}
                    >
                        {status.walletAddress.slice(0, 6)}…{status.walletAddress.slice(-4)}
                    </code>
                </div>
            )}
        </div>
    );
}
