import { useState, useEffect } from 'react';
import './CapabilitySettings.css';

type SecurityTier = 'sandbox' | 'standard' | 'autonomous' | 'godmode' | 'custom';

interface CapabilityConfig {
    godMode: boolean;
    capabilities: Record<string, boolean>;
    currentTier?: SecurityTier;
}

const TIER_DEFS: { id: SecurityTier; icon: string; name: string; desc: string; color: string }[] = [
    { id: 'sandbox',    icon: '🔒', name: 'Sandbox',    desc: 'Chat only — internet access', color: 'var(--tier-sandbox, #6b7280)' },
    { id: 'standard',   icon: '🛡️', name: 'Standard',   desc: 'Shell, files, browser',        color: 'var(--tier-standard, #3b82f6)' },
    { id: 'autonomous', icon: '⚡', name: 'Autonomous', desc: 'Financial ops, accounts',       color: 'var(--tier-autonomous, #f59e0b)' },
    { id: 'godmode',    icon: '★',  name: 'God Mode',   desc: 'All caps, no restrictions',     color: 'var(--tier-godmode, #eab308)' },
];

const CAPABILITY_LABELS: Record<string, { label: string; desc: string }> = {
    internet_access:  { label: 'Internet Access',      desc: 'Search, browse, RSS feeds' },
    browser_control:  { label: 'Browser Control',      desc: 'Playwright automation — fill forms, click, screenshot' },
    shell_exec:       { label: 'Shell Execution',      desc: 'Run commands on host machine' },
    file_system:      { label: 'File System',          desc: 'Read/write files on host' },
    financial_ops:    { label: 'Financial Operations', desc: 'Trading, payments, transfers' },
    account_creation: { label: 'Account Creation',     desc: 'Register accounts on platforms' },
    self_deploy:      { label: 'Self Deployment',      desc: 'Rent servers, deploy self' },
    self_modify:      { label: 'Self Modification',    desc: 'Update own code/config' },
};

export function CapabilitySettings() {
    const [config, setConfig] = useState<CapabilityConfig | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [showGodConfirm, setShowGodConfirm] = useState(false);
    const [showAutoConfirm, setShowAutoConfirm] = useState(false);

    useEffect(() => {
        fetch('/api/settings/capabilities')
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then(setConfig)
            .catch(err => {
                console.error('Failed to load capabilities:', err);
                setError('Unable to load capability settings. The agent may not have initialized yet.');
            });
    }, []);

    const updateCapabilities = async (updates: Record<string, unknown>) => {
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

    const selectTier = (tier: SecurityTier) => {
        if (tier === 'custom') return;
        if (tier === 'godmode') {
            setShowGodConfirm(true);
            return;
        }
        if (tier === 'autonomous' && config?.currentTier !== 'autonomous' && config?.currentTier !== 'godmode') {
            setShowAutoConfirm(true);
            return;
        }
        updateCapabilities({ tier });
    };

    const toggleCapability = (id: string) => {
        if (!config) return;
        updateCapabilities({
            capabilities: { [id]: !config.capabilities[id] },
        });
    };

    const confirmGodMode = () => {
        setShowGodConfirm(false);
        updateCapabilities({ tier: 'godmode' });
    };

    const confirmAutonomous = () => {
        setShowAutoConfirm(false);
        updateCapabilities({ tier: 'autonomous' });
    };

    if (error) return (
        <div className="cap-settings">
            <div className="cap-header">
                <h2>Capability Permissions</h2>
            </div>
            <div className="settings-card" style={{ padding: '2rem', textAlign: 'center' }}>
                <p style={{ color: 'var(--ink-muted)', marginBottom: '1rem' }}>{error}</p>
                <button className="settings-btn settings-btn-primary" onClick={() => {
                    setError(null);
                    fetch('/api/settings/capabilities')
                        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
                        .then(setConfig)
                        .catch(() => setError('Still unable to load. Check server logs.'));
                }}>Retry</button>
            </div>
        </div>
    );

    if (!config) return <div className="cap-loading">Loading permissions...</div>;

    const currentTier = config.currentTier ?? 'custom';

    return (
        <div className="cap-settings">
            <div className="cap-header">
                <h2>Capability Permissions</h2>
                <p className="cap-subtitle">Choose a security tier or fine-tune individual capabilities.</p>
            </div>

            {/* Tier Selector */}
            <div className="tier-selector">
                {TIER_DEFS.map(t => (
                    <button
                        key={t.id}
                        className={`tier-card ${currentTier === t.id ? 'tier-active' : ''}`}
                        style={{ '--tier-accent': t.color } as React.CSSProperties}
                        onClick={() => selectTier(t.id)}
                        disabled={saving}
                    >
                        <span className="tier-icon">{t.icon}</span>
                        <span className="tier-name">{t.name}</span>
                        <span className="tier-desc">{t.desc}</span>
                    </button>
                ))}
            </div>

            {currentTier === 'custom' && (
                <div className="tier-custom-badge">Custom configuration</div>
            )}

            {/* God Mode Confirmation */}
            {showGodConfirm && (
                <div className="god-confirm-overlay" onClick={() => setShowGodConfirm(false)}>
                    <div className="god-confirm-modal" onClick={e => e.stopPropagation()}>
                        <h3>Enable God Mode?</h3>
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

            {/* Autonomous Confirmation */}
            {showAutoConfirm && (
                <div className="god-confirm-overlay" onClick={() => setShowAutoConfirm(false)}>
                    <div className="god-confirm-modal auto-confirm" onClick={e => e.stopPropagation()}>
                        <h3>Enable Autonomous Mode?</h3>
                        <p>This will enable financial capabilities — the agent will be able to:</p>
                        <ul>
                            <li>Execute financial transactions & payments</li>
                            <li>Create accounts on external platforms</li>
                        </ul>
                        <div className="god-confirm-actions">
                            <button className="god-confirm-cancel" onClick={() => setShowAutoConfirm(false)}>Cancel</button>
                            <button className="auto-confirm-yes" onClick={confirmAutonomous}>Enable Autonomous</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Individual capabilities */}
            <div className="cap-grid">
                {Object.entries(CAPABILITY_LABELS).map(([id, { label, desc }]) => {
                    const enabled = config.godMode || config.capabilities[id];
                    return (
                        <div key={id} className={`cap-card ${enabled ? 'enabled' : 'disabled'}`}>
                            <div className="cap-card-header">
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
