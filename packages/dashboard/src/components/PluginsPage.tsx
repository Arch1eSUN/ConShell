import { useState } from 'react';

interface Plugin {
    name: string;
    version: string;
    description: string;
    state: 'enabled' | 'disabled';
    hooks: string[];
    author?: string;
}

export function PluginsPage() {
    const [plugins] = useState<Plugin[]>([]);

    return (
        <div className="page-plugins">
            <header className="page-header">
                <h2 className="page-title">Plugins</h2>
                <p className="page-subtitle">Extend agent capabilities with lifecycle hooks</p>
            </header>

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Installed Plugins</div>
                        <div className="settings-card-subtitle">{plugins.length} plugins registered</div>
                    </div>
                    <button className="settings-btn settings-btn-secondary" disabled>
                        + Install Plugin
                    </button>
                </div>

                <div className="settings-empty" style={{ marginTop: '0.75rem', padding: '2rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        Coming Soon
                    </div>
                    <p style={{ color: 'var(--ink-muted)', maxWidth: '400px', margin: '0 auto' }}>
                        Plugin management API is under development. Plugins can currently be configured via the ConShell config file.
                    </p>
                </div>
            </div>
        </div>
    );
}
