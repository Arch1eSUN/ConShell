import { useState } from 'react';

export function BackupPage() {
    const [_] = useState([]);

    return (
        <div className="page-backup">
            <header className="page-header">
                <h2 className="page-title">Backup</h2>
                <p className="page-subtitle">State backup, verification, and restore</p>
            </header>

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Backup Management</div>
                        <div className="settings-card-subtitle">Snapshot and restore agent state</div>
                    </div>
                </div>

                <div className="settings-empty" style={{ marginTop: '0.75rem', padding: '2rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        Coming Soon
                    </div>
                    <p style={{ color: 'var(--ink-muted)', maxWidth: '400px', margin: '0 auto' }}>
                        Backup and restore API is under development. Memory and configuration can be exported via the CLI.
                    </p>
                </div>
            </div>
        </div>
    );
}
