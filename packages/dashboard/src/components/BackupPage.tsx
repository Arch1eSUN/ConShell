import { useState } from 'react';

interface Backup {
    id: string;
    agentName: string;
    createdAt: string;
    status: 'complete' | 'verified' | 'failed';
    fileCount: number;
    totalSize: string;
}

export function BackupPage() {
    const [backups] = useState<Backup[]>([]);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [deleteInput, setDeleteInput] = useState('');

    return (
        <div className="page-backup">
            <header className="page-header">
                <h2 className="page-title">💾 Backup</h2>
                <p className="page-subtitle">State backup, verification, and restore</p>
            </header>

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Backups</div>
                        <div className="settings-card-subtitle">
                            {backups.length} backups · Includes state.db, SOUL.md, config, wallet (encrypted), skills
                        </div>
                    </div>
                    <button className="settings-btn settings-btn-primary">
                        📦 Create Backup
                    </button>
                </div>

                {backups.length === 0 ? (
                    <div className="settings-empty">
                        No backups yet. Backups include SHA-256 hash verification.
                        Wallet data is double-encrypted with your master password.
                    </div>
                ) : (
                    <div className="provider-list">
                        {backups.map(b => (
                            <div key={b.id} className="provider-item">
                                <div className="provider-item-info">
                                    <span className={`provider-dot ${b.status === 'verified' ? 'enabled' : b.status === 'failed' ? 'disabled' : ''}`} />
                                    <div>
                                        <div className="provider-item-name">{b.agentName} — {b.createdAt}</div>
                                        <div className="provider-item-type">
                                            {b.fileCount} files · {b.totalSize} · {b.status}
                                        </div>
                                    </div>
                                </div>
                                <div className="provider-item-actions">
                                    <button className="provider-action-btn" title="Verify">✅</button>
                                    <button className="provider-action-btn" title="Restore">♻️</button>
                                    <button
                                        className="provider-action-btn"
                                        title="Delete"
                                        onClick={() => setConfirmDelete(b.id)}
                                    >
                                        🗑
                                    </button>
                                </div>

                                {confirmDelete === b.id && (
                                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <input
                                            className="settings-input"
                                            placeholder='Type "DELETE" to confirm'
                                            value={deleteInput}
                                            onChange={e => setDeleteInput(e.target.value)}
                                            style={{ flex: 1 }}
                                        />
                                        <button
                                            className="settings-btn settings-btn-primary"
                                            disabled={deleteInput !== 'DELETE'}
                                            onClick={() => { setConfirmDelete(null); setDeleteInput(''); }}
                                        >
                                            Confirm Delete
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
