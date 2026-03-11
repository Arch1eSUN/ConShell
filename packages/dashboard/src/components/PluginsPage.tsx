import { useState } from 'react';

interface Plugin {
    id: string;
    name: string;
    version: string;
    description: string;
    state: 'installed' | 'enabled' | 'disabled';
    hooks: string[];
}

export function PluginsPage() {
    const [plugins] = useState<Plugin[]>([]);
    const [showInstall, setShowInstall] = useState(false);

    return (
        <div className="page-plugins">
            <header className="page-header">
                <h2 className="page-title">🧩 Plugins</h2>
                <p className="page-subtitle">Extend agent capabilities with lifecycle hooks</p>
            </header>

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Installed Plugins</div>
                        <div className="settings-card-subtitle">{plugins.length} plugins installed</div>
                    </div>
                    <button
                        className="settings-btn settings-btn-primary"
                        onClick={() => setShowInstall(!showInstall)}
                    >
                        {showInstall ? 'Cancel' : '+ Install Plugin'}
                    </button>
                </div>

                {showInstall && (
                    <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '0.5rem' }}>
                        <div className="settings-form-group">
                            <label className="settings-label">Plugin Manifest URL</label>
                            <input className="settings-input" placeholder="https://example.com/plugin.json" />
                        </div>
                        <div style={{ marginTop: '0.75rem' }}>
                            <button className="settings-btn settings-btn-primary">Install & Review Permissions</button>
                        </div>
                    </div>
                )}

                {plugins.length === 0 ? (
                    <div className="settings-empty">
                        No plugins installed. Plugins can hook into beforeToolCall, afterToolCall, onTurn, onWake, and onSleep events.
                    </div>
                ) : (
                    <div className="provider-list">
                        {plugins.map(p => (
                            <div key={p.id} className="provider-item">
                                <div className="provider-item-info">
                                    <span className={`provider-dot ${p.state === 'enabled' ? 'enabled' : 'disabled'}`} />
                                    <div>
                                        <div className="provider-item-name">{p.name} <span className="provider-item-type">v{p.version}</span></div>
                                        <div className="provider-item-type">{p.description}</div>
                                        <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.25rem' }}>
                                            {p.hooks.map(h => (
                                                <span key={h} className="routing-model-chip">{h}</span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="provider-item-actions">
                                    <button className="provider-action-btn" title={p.state === 'enabled' ? 'Disable' : 'Enable'}>
                                        {p.state === 'enabled' ? '✅' : '⏸'}
                                    </button>
                                    <button className="provider-action-btn" title="Uninstall">🗑</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
