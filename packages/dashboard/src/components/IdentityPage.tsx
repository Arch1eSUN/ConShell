import { useState, useEffect, useCallback } from 'react';

interface AgentIdentity {
    address: string;
    name: string;
    did?: string;
    agentCardMinted: boolean;
    publicKey: string;
    createdAt: string;
    reputation: number;
}

export function IdentityPage() {
    const [identity, setIdentity] = useState<AgentIdentity | null>(null);
    const [loading, setLoading] = useState(true);
    const [editingName, setEditingName] = useState(false);
    const [newName, setNewName] = useState('');
    const [saveStatus, setSaveStatus] = useState('');
    const [error, setError] = useState('');

    const fetchIdentity = useCallback(async () => {
        setError('');
        try {
            const res = await fetch('/api/identity');
            if (res.ok) {
                const data = await res.json();
                setIdentity(data);
                setNewName(data.name || '');
            } else {
                setError(`Failed to load identity (HTTP ${res.status})`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to connect to server');
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchIdentity(); }, [fetchIdentity]);

    const saveName = async () => {
        setSaveStatus('Saving...');
        try {
            const res = await fetch('/api/identity/name', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName }),
            });
            if (res.ok) {
                setSaveStatus('✓ Saved');
                setEditingName(false);
                fetchIdentity();
            } else {
                setSaveStatus('✗ Failed');
            }
        } catch {
            setSaveStatus('✗ Error');
        }
        setTimeout(() => setSaveStatus(''), 3000);
    };

    const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s;

    if (loading) {
        return (
            <div className="page-identity">
                <header className="page-header">
                    <h2 className="page-title">Identity</h2>
                    <p className="page-subtitle">On-chain agent identity (ERC-8004 AgentCard)</p>
                </header>
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading...</div>
            </div>
        );
    }

    return (
        <div className="page-identity">
            <header className="page-header">
                <h2 className="page-title">Identity</h2>
                <p className="page-subtitle">On-chain agent identity (ERC-8004 AgentCard)</p>
            </header>

            {error && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>⚠ {error}</span>
                    <button className="settings-btn settings-btn-secondary" onClick={fetchIdentity} style={{ fontSize: '0.8rem' }}>⟳ Retry</button>
                </div>
            )}

            {/* Agent Card */}
            <div className="settings-card" style={{ marginBottom: '1.5rem', background: 'linear-gradient(135deg, var(--bg-surface, #1a1a1a) 0%, var(--bg-elevated, #252525) 100%)', border: '1px solid var(--accent, #6366f1)' }}>
                <div style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-muted)', marginBottom: '0.25rem' }}>Agent Name</div>
                            {editingName ? (
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input value={newName} onChange={e => setNewName(e.target.value)}
                                        style={{ padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--accent, #6366f1)', background: 'transparent', color: 'inherit', fontSize: '1.2rem', fontWeight: 700 }} />
                                    <button className="settings-btn settings-btn-secondary" onClick={saveName}>Save</button>
                                    <button className="settings-btn settings-btn-secondary" onClick={() => setEditingName(false)}>Cancel</button>
                                </div>
                            ) : (
                                <div style={{ fontSize: '1.4rem', fontWeight: 700, cursor: 'pointer' }} onClick={() => setEditingName(true)}>
                                    {identity?.name || 'Unnamed Agent'} ✏️
                                </div>
                            )}
                            {saveStatus && <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', color: saveStatus.startsWith('✓') ? '#34d399' : '#ef4444' }}>{saveStatus}</div>}
                        </div>

                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>Reputation</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--accent, #6366f1)' }}>{identity?.reputation ?? 0}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Details */}
            <div className="settings-card" style={{ marginBottom: '1.5rem' }}>
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Identity Details</div>
                        <div className="settings-card-subtitle">DID, keys, and on-chain presence</div>
                    </div>
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                    {[
                        { label: 'Address', value: identity?.address ?? '—', mono: true },
                        { label: 'DID', value: identity?.did ?? 'Not registered', mono: true },
                        { label: 'Public Key', value: identity?.publicKey ? truncate(identity.publicKey, 40) : '—', mono: true },
                        { label: 'AgentCard', value: identity?.agentCardMinted ? '✓ Minted' : '✗ Not minted', mono: false },
                        { label: 'Created', value: identity?.createdAt ?? '—', mono: false },
                    ].map(row => (
                        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '1px solid var(--border-subtle, #333)' }}>
                            <span style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>{row.label}</span>
                            <span style={{ fontFamily: row.mono ? 'monospace' : 'inherit', fontSize: '0.9rem', maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all' }}>{row.value}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Actions */}
            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Actions</div>
                        <div className="settings-card-subtitle">Manage your agent's on-chain identity</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                    <button className="settings-btn settings-btn-secondary" disabled={identity?.agentCardMinted}>
                        🪪 Mint AgentCard
                    </button>
                    <button className="settings-btn settings-btn-secondary" disabled={!!identity?.did}>
                        🔗 Register DID
                    </button>
                    <button className="settings-btn settings-btn-secondary">
                        🔄 Rotate Keys
                    </button>
                    <button className="settings-btn settings-btn-secondary">
                        📤 Export Identity
                    </button>
                </div>
            </div>
        </div>
    );
}
