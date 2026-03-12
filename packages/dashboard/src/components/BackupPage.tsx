import { useState, useEffect, useCallback } from 'react';

interface BackupEntry {
    id: string;
    filename: string;
    sizeBytes: number;
    createdAt: string;
    type: 'full' | 'memory' | 'config' | 'wallet';
    verified: boolean;
}

export function BackupPage() {
    const [backups, setBackups] = useState<BackupEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionStatus, setActionStatus] = useState('');
    const [creating, setCreating] = useState(false);
    const [selectedType, setSelectedType] = useState<BackupEntry['type']>('full');

    const [error, setError] = useState('');

    const fetchBackups = useCallback(async () => {
        setError('');
        try {
            const res = await fetch('/api/backups');
            if (res.ok) {
                const data = await res.json();
                setBackups(Array.isArray(data) ? data : (data.backups ?? []));
            } else {
                setError(`Server returned ${res.status}`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to connect to server');
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchBackups(); }, [fetchBackups]);

    const createBackup = async () => {
        setCreating(true);
        setActionStatus(`Creating ${selectedType} backup...`);
        try {
            const res = await fetch('/api/backups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: selectedType }),
            });
            if (res.ok) {
                setActionStatus('✓ Backup created successfully');
                fetchBackups();
            } else {
                setActionStatus('✗ Backup failed');
            }
        } catch {
            setActionStatus('✗ Error creating backup');
        }
        setCreating(false);
        setTimeout(() => setActionStatus(''), 4000);
    };

    const restoreBackup = async (id: string) => {
        if (!confirm('Restore from this backup? This will overwrite current state.')) return;
        setActionStatus('Restoring...');
        try {
            const res = await fetch(`/api/backups/${id}/restore`, { method: 'POST' });
            if (res.ok) {
                setActionStatus('✓ Restored successfully. Restart recommended.');
            } else {
                setActionStatus('✗ Restore failed');
            }
        } catch {
            setActionStatus('✗ Error');
        }
        setTimeout(() => setActionStatus(''), 5000);
    };

    const verifyBackup = async (id: string) => {
        setActionStatus('Verifying...');
        try {
            const res = await fetch(`/api/backups/${id}/verify`, { method: 'POST' });
            if (res.ok) {
                setActionStatus('✓ Backup integrity verified');
                fetchBackups();
            } else {
                setActionStatus('✗ Verification failed');
            }
        } catch {
            setActionStatus('✗ Error');
        }
        setTimeout(() => setActionStatus(''), 4000);
    };

    const deleteBackup = async (id: string) => {
        if (!confirm('Delete this backup permanently?')) return;
        try {
            const res = await fetch(`/api/backups/${id}`, { method: 'DELETE' });
            if (res.ok) fetchBackups();
        } catch { /* silent */ }
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
    };

    const typeIcon: Record<string, string> = { full: '📦', memory: '🧠', config: '⚙️', wallet: '💰' };
    const typeColor: Record<string, string> = { full: '#6366f1', memory: '#8b5cf6', config: '#f59e0b', wallet: '#10b981' };

    return (
        <div className="page-backup">
            <header className="page-header">
                <h2 className="page-title">Backup</h2>
                <p className="page-subtitle">State backup, verification, and restore</p>
            </header>

            {/* Create Backup */}
            <div className="settings-card" style={{ marginBottom: '1.5rem' }}>
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Create Backup</div>
                        <div className="settings-card-subtitle">Save a snapshot of your agent's state</div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {(['full', 'memory', 'config', 'wallet'] as const).map(type => (
                        <button key={type} onClick={() => setSelectedType(type)}
                            className="settings-btn settings-btn-secondary"
                            style={{
                                opacity: selectedType === type ? 1 : 0.4,
                                borderColor: selectedType === type ? typeColor[type] : 'transparent',
                                textTransform: 'capitalize',
                            }}>
                            {typeIcon[type]} {type}
                        </button>
                    ))}

                    <button className="settings-btn settings-btn-secondary" onClick={createBackup} disabled={creating}
                        style={{ marginLeft: 'auto', fontWeight: 700 }}>
                        {creating ? '⏳ Creating...' : '💾 Create Backup'}
                    </button>
                </div>
                {actionStatus && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: actionStatus.startsWith('✓') ? '#34d399' : actionStatus.startsWith('✗') ? '#ef4444' : 'var(--ink-muted)' }}>
                        {actionStatus}
                    </div>
                )}
            </div>

            {error && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>⚠ {error}</span>
                    <button className="settings-btn settings-btn-secondary" onClick={fetchBackups} style={{ fontSize: '0.8rem' }}>⟳ Retry</button>
                </div>
            )}

            {/* Backup List */}
            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Backup History</div>
                        <div className="settings-card-subtitle">{backups.length} backups stored</div>
                    </div>
                    <button className="settings-btn settings-btn-secondary" onClick={fetchBackups}>⟳ Refresh</button>
                </div>

                {loading ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading...</div>
                ) : backups.length === 0 ? (
                    <div className="settings-empty" style={{ marginTop: '0.75rem', padding: '2rem 1rem', textAlign: 'center' }}>
                        <p style={{ color: 'var(--ink-muted)' }}>No backups yet. Create your first backup to protect your agent's state.</p>
                    </div>
                ) : (
                    <div style={{ marginTop: '0.5rem' }}>
                        {backups.map(b => (
                            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', borderBottom: '1px solid var(--border-subtle, #333)' }}>
                                <div>
                                    <div style={{ fontWeight: 600 }}>
                                        <span style={{ color: typeColor[b.type] }}>{typeIcon[b.type]}</span> {b.filename}
                                        {b.verified && <span style={{ fontSize: '0.75rem', marginLeft: '0.5rem', color: '#34d399' }}>✓ verified</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: '0.2rem' }}>
                                        <span>{formatSize(b.sizeBytes)}</span>
                                        <span>{new Date(b.createdAt).toLocaleString()}</span>
                                        <span style={{ textTransform: 'capitalize', color: typeColor[b.type] }}>{b.type}</span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    <button className="settings-btn settings-btn-secondary" onClick={() => verifyBackup(b.id)} style={{ fontSize: '0.8rem' }}>🔍</button>
                                    <button className="settings-btn settings-btn-secondary" onClick={() => restoreBackup(b.id)} style={{ fontSize: '0.8rem' }}>♻️</button>
                                    <button className="settings-btn settings-btn-secondary" onClick={() => deleteBackup(b.id)} style={{ fontSize: '0.8rem', color: '#ef4444' }}>🗑</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
