import { useState, useEffect } from 'react';
import './CapabilitySettings.css';

interface CapabilityConfig {
    godMode: boolean;
    capabilities: Record<string, boolean>;
}

const CAPABILITY_LABELS: Record<string, { label: string; desc: string; icon: string }> = {
    internet_access: { label: 'Internet Access', desc: 'Search, browse, RSS feeds', icon: '🌐' },
    browser_control: { label: 'Browser Control', desc: 'Playwright automation — fill forms, click, screenshot', icon: '🖥️' },
    shell_exec: { label: 'Shell Execution', desc: 'Run commands on host machine', icon: '⚡' },
    file_system: { label: 'File System', desc: 'Read/write files on host', icon: '📁' },
    financial_ops: { label: 'Financial Operations', desc: 'Trading, payments, transfers', icon: '💰' },
    account_creation: { label: 'Account Creation', desc: 'Register accounts on platforms', icon: '🔑' },
    self_deploy: { label: 'Self Deployment', desc: 'Rent servers, deploy self', icon: '🚀' },
    self_modify: { label: 'Self Modification', desc: 'Update own code/config', icon: '🧬' },
};

export function CapabilitySettings() {
    const [config, setConfig] = useState<CapabilityConfig | null>(null);
    const [saving, setSaving] = useState(false);
    const [showGodConfirm, setShowGodConfirm] = useState(false);

    useEffect(() => {
        fetch('/api/settings/capabilities')
            .then(r => r.json())
            .then(setConfig)
            .catch(console.error);
    }, []);

    const updateCapabilities = async (updates: Partial<CapabilityConfig>) => {
        setSaving(true);
        try {
            const res = await fetch('/api/settings/capabilities', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            const data = await res.json();
            setConfig(data);
        } catch (err) {
            console.error('Failed to update capabilities:', err);
        }
        setSaving(false);
    };

    const toggleCapability = (id: string) => {
        if (!config) return;
        updateCapabilities({
            capabilities: { [id]: !config.capabilities[id] },
        });
    };

    const toggleGodMode = () => {
        if (!config?.godMode) {
            setShowGodConfirm(true);
        } else {
            updateCapabilities({ godMode: false });
        }
    };

    const confirmGodMode = () => {
        setShowGodConfirm(false);
        updateCapabilities({ godMode: true });
    };

    if (!config) return <div className="cap-loading">Loading permissions...</div>;

    return (
        <div className="cap-settings">
            <div className="cap-header">
                <h2>⚙️ Capability Permissions</h2>
                <p className="cap-subtitle">Control what your agent can do. Enable or disable individual capabilities.</p>
            </div>

            {/* God Mode */}
            <div className={`god-mode-card ${config.godMode ? 'god-active' : ''}`}>
                <div className="god-mode-info">
                    <span className="god-icon">👑</span>
                    <div>
                        <h3>God Mode</h3>
                        <p>All permissions unlocked. No restrictions. Full autonomous power.</p>
                    </div>
                </div>
                <button
                    className={`god-toggle ${config.godMode ? 'active' : ''}`}
                    onClick={toggleGodMode}
                    disabled={saving}
                >
                    {config.godMode ? 'ENABLED' : 'DISABLED'}
                </button>
            </div>

            {/* Confirmation modal */}
            {showGodConfirm && (
                <div className="god-confirm-overlay" onClick={() => setShowGodConfirm(false)}>
                    <div className="god-confirm-modal" onClick={e => e.stopPropagation()}>
                        <h3>⚠️ Enable God Mode?</h3>
                        <p>This will grant the agent unrestricted access to all capabilities including:</p>
                        <ul>
                            <li>Shell command execution</li>
                            <li>Financial operations & trading</li>
                            <li>Self-deployment to remote servers</li>
                            <li>Self-modification of its own code</li>
                        </ul>
                        <div className="god-confirm-actions">
                            <button className="god-confirm-cancel" onClick={() => setShowGodConfirm(false)}>Cancel</button>
                            <button className="god-confirm-yes" onClick={confirmGodMode}>Enable God Mode</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Individual capabilities */}
            <div className="cap-grid">
                {Object.entries(CAPABILITY_LABELS).map(([id, { label, desc, icon }]) => {
                    const enabled = config.godMode || config.capabilities[id];
                    return (
                        <div key={id} className={`cap-card ${enabled ? 'enabled' : 'disabled'}`}>
                            <div className="cap-card-header">
                                <span className="cap-icon">{icon}</span>
                                <span className="cap-label">{label}</span>
                            </div>
                            <p className="cap-desc">{desc}</p>
                            <label className="cap-switch">
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={() => toggleCapability(id)}
                                    disabled={config.godMode || saving}
                                />
                                <span className="cap-slider" />
                            </label>
                            {config.godMode && <span className="cap-god-badge">God Mode</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
