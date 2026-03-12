import { useState, useEffect, useCallback } from 'react';

interface DiscoveredAgent {
    address: string;
    name: string;
    capabilities: string[];
    trustScore: number;
    lastSeen: number;
    status: 'online' | 'offline' | 'degraded';
}

interface PeerMsg {
    id: string;
    from: string;
    content: string;
    timestamp: number;
    state: string;
}

interface SocialStats {
    discoveredAgents: number;
    reputationEntries: number;
    pendingMessages: number;
}

export function SocialPage() {
    const [agents, setAgents] = useState<DiscoveredAgent[]>([]);
    const [messages, setMessages] = useState<PeerMsg[]>([]);
    const [stats, setStats] = useState<SocialStats>({ discoveredAgents: 0, reputationEntries: 0, pendingMessages: 0 });
    const [loading, setLoading] = useState(true);
    const [msgTo, setMsgTo] = useState('');
    const [msgContent, setMsgContent] = useState('');
    const [sendStatus, setSendStatus] = useState('');

    const [error, setError] = useState('');

    const fetchAll = useCallback(async () => {
        setError('');
        try {
            const [agentsRes, msgsRes, statsRes] = await Promise.all([
                fetch('/api/social/agents'),
                fetch('/api/social/inbox'),
                fetch('/api/social/stats'),
            ]);
            if (agentsRes.ok) {
                const data = await agentsRes.json();
                setAgents(Array.isArray(data) ? data : (data.agents ?? []));
            }
            if (msgsRes.ok) {
                const data = await msgsRes.json();
                setMessages(Array.isArray(data) ? data : (data.messages ?? []));
            }
            if (statsRes.ok) setStats(await statsRes.json());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to connect to server');
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const sendMessage = async () => {
        if (!msgTo || !msgContent) return;
        setSendStatus('Sending...');
        try {
            const res = await fetch('/api/social/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: msgTo, content: msgContent }),
            });
            if (res.ok) {
                setSendStatus('✓ Sent');
                setMsgContent('');
                fetchAll();
            } else {
                setSendStatus('✗ Failed');
            }
        } catch {
            setSendStatus('✗ Error');
        }
        setTimeout(() => setSendStatus(''), 3000);
    };

    const timeSince = (ts: number) => {
        const s = Math.floor((Date.now() - ts) / 1000);
        if (s < 60) return `${s}s ago`;
        if (s < 3600) return `${Math.floor(s / 60)}m ago`;
        if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
        return `${Math.floor(s / 86400)}d ago`;
    };

    const statusDot = (status: string) => {
        const color = status === 'online' ? '#34d399' : status === 'degraded' ? '#fbbf24' : '#6b7280';
        return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 6 }} />;
    };

    return (
        <div className="page-social">
            <header className="page-header">
                <h2 className="page-title">Social</h2>
                <p className="page-subtitle">Agent-to-agent communication and reputation</p>
            </header>

            {error && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>⚠ {error}</span>
                    <button className="settings-btn settings-btn-secondary" onClick={fetchAll} style={{ fontSize: '0.8rem' }}>⟳ Retry</button>
                </div>
            )}

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                    { label: 'Discovered Agents', value: stats.discoveredAgents, icon: '🌐' },
                    { label: 'Trust Entries', value: stats.reputationEntries, icon: '🤝' },
                    { label: 'Pending Messages', value: stats.pendingMessages, icon: '📨' },
                ].map(s => (
                    <div key={s.label} className="settings-card" style={{ textAlign: 'center', padding: '1.25rem' }}>
                        <div style={{ fontSize: '1.5rem' }}>{s.icon}</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '0.25rem 0' }}>{s.value}</div>
                        <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>{s.label}</div>
                    </div>
                ))}
            </div>

            {/* Discovered Agents */}
            <div className="settings-card" style={{ marginBottom: '1.5rem' }}>
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Discovered Agents</div>
                        <div className="settings-card-subtitle">{agents.length} agents in federation</div>
                    </div>
                    <button className="settings-btn settings-btn-secondary" onClick={fetchAll}>⟳ Refresh</button>
                </div>

                {loading ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading...</div>
                ) : agents.length === 0 ? (
                    <div className="settings-empty" style={{ marginTop: '0.75rem', padding: '2rem 1rem', textAlign: 'center' }}>
                        <p style={{ color: 'var(--ink-muted)' }}>No agents discovered yet. Enable relay polling in config to discover peers.</p>
                    </div>
                ) : (
                    <div style={{ marginTop: '0.5rem' }}>
                        {agents.map(a => (
                            <div key={a.address} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', borderBottom: '1px solid var(--border-subtle, #333)' }}>
                                <div>
                                    <div style={{ fontWeight: 600 }}>{statusDot(a.status)}{a.name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', fontFamily: 'monospace' }}>{a.address}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: '0.85rem' }}>Trust: <strong>{a.trustScore}</strong></div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>{timeSince(a.lastSeen)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Messaging */}
            <div className="settings-card" style={{ marginBottom: '1.5rem' }}>
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Peer Messaging</div>
                        <div className="settings-card-subtitle">{messages.length} messages in inbox</div>
                    </div>
                </div>

                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                    <input placeholder="Recipient address..." value={msgTo} onChange={e => setMsgTo(e.target.value)}
                        style={{ flex: 1, padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border-subtle, #333)', background: 'var(--bg-surface, #1a1a1a)', color: 'inherit' }} />
                    <input placeholder="Message..." value={msgContent} onChange={e => setMsgContent(e.target.value)}
                        style={{ flex: 2, padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border-subtle, #333)', background: 'var(--bg-surface, #1a1a1a)', color: 'inherit' }} />
                    <button className="settings-btn settings-btn-secondary" onClick={sendMessage}>Send</button>
                </div>
                {sendStatus && <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: sendStatus.startsWith('✓') ? '#34d399' : sendStatus.startsWith('✗') ? '#ef4444' : 'var(--ink-muted)' }}>{sendStatus}</div>}

                {messages.length > 0 && (
                    <div style={{ marginTop: '1rem', maxHeight: 250, overflowY: 'auto' }}>
                        {messages.map(m => (
                            <div key={m.id} style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-subtle, #222)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.85rem', fontFamily: 'monospace' }}>{m.from}</span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>{timeSince(m.timestamp)}</span>
                                </div>
                                <div style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>{m.content}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
