import { useState, useEffect, useCallback } from 'react';

interface Plugin {
    name: string;
    version: string;
    description: string;
    state: 'enabled' | 'disabled';
    hooks: string[];
    author?: string;
    category?: string;
}

interface Skill {
    name: string;
    version: string;
    description: string;
    category: string;
    author: string;
    rating: number;
    ratingCount: number;
    downloads: number;
    installedAt?: string;
}

export function PluginsPage() {
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [searchKeyword, setSearchKeyword] = useState('');
    const [activeTab, setActiveTab] = useState<'plugins' | 'skills'>('plugins');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [installStatus, setInstallStatus] = useState('');

    const fetchAll = useCallback(async () => {
        setError('');
        try {
            const [pluginsRes, skillsRes] = await Promise.all([
                fetch('/api/plugins'),
                fetch('/api/skills/installed'),
            ]);
            if (pluginsRes.ok) {
                const data = await pluginsRes.json();
                setPlugins(Array.isArray(data) ? data : (data.plugins ?? []));
            }
            if (skillsRes.ok) {
                const data = await skillsRes.json();
                setSkills(Array.isArray(data) ? data : (data.skills ?? []));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to connect to server');
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const togglePlugin = async (name: string, currentState: string) => {
        const action = currentState === 'enabled' ? 'disable' : 'enable';
        try {
            const res = await fetch(`/api/plugins/${name}/${action}`, { method: 'POST' });
            if (res.ok) fetchAll();
        } catch { /* silent */ }
    };

    const searchSkills = async () => {
        if (!searchKeyword) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/skills/search?keyword=${encodeURIComponent(searchKeyword)}`);
            if (res.ok) setSkills(await res.json());
        } catch { /* silent */ }
        setLoading(false);
    };

    const installSkill = async (name: string) => {
        setInstallStatus(`Installing ${name}...`);
        try {
            const res = await fetch(`/api/skills/install`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (res.ok) {
                setInstallStatus(`✓ ${name} installed`);
                fetchAll();
            } else {
                setInstallStatus(`✗ Failed`);
            }
        } catch {
            setInstallStatus('✗ Error');
        }
        setTimeout(() => setInstallStatus(''), 3000);
    };

    const stars = (rating: number) => '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));

    return (
        <div className="page-plugins">
            <header className="page-header">
                <h2 className="page-title">Plugins & Skills</h2>
                <p className="page-subtitle">Extend agent capabilities</p>
            </header>

            {error && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>⚠ {error}</span>
                    <button className="settings-btn settings-btn-secondary" onClick={fetchAll} style={{ fontSize: '0.8rem' }}>⟳ Retry</button>
                </div>
            )}

            {/* Tab selector */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {(['plugins', 'skills'] as const).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                        className="settings-btn settings-btn-secondary"
                        style={{ opacity: activeTab === tab ? 1 : 0.5, fontWeight: activeTab === tab ? 700 : 400, textTransform: 'capitalize' }}>
                        {tab === 'plugins' ? `🔌 Plugins (${plugins.length})` : `🧠 Skills (${skills.length})`}
                    </button>
                ))}
            </div>

            {/* Plugins Tab */}
            {activeTab === 'plugins' && (
                <div className="settings-card" style={{ marginBottom: '1.5rem' }}>
                    <div className="settings-card-header">
                        <div>
                            <div className="settings-card-title">Installed Plugins</div>
                            <div className="settings-card-subtitle">{plugins.length} plugins registered</div>
                        </div>
                    </div>

                    {loading ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading...</div>
                    ) : plugins.length === 0 ? (
                        <div className="settings-empty" style={{ marginTop: '0.75rem', padding: '2rem 1rem', textAlign: 'center' }}>
                            <p style={{ color: 'var(--ink-muted)' }}>No plugins installed. Plugins extend your agent's lifecycle hooks.</p>
                        </div>
                    ) : (
                        <div style={{ marginTop: '0.5rem' }}>
                            {plugins.map(p => (
                                <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', borderBottom: '1px solid var(--border-subtle, #333)' }}>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{p.name} <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>v{p.version}</span></div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>{p.description}</div>
                                        <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                                            {p.hooks.map(h => (
                                                <span key={h} style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-elevated, #252525)', color: 'var(--accent, #6366f1)' }}>{h}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <button className="settings-btn settings-btn-secondary" onClick={() => togglePlugin(p.name, p.state)}
                                        style={{ color: p.state === 'enabled' ? '#34d399' : '#ef4444' }}>
                                        {p.state === 'enabled' ? '● Enabled' : '○ Disabled'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Skills Tab */}
            {activeTab === 'skills' && (
                <div className="settings-card" style={{ marginBottom: '1.5rem' }}>
                    <div className="settings-card-header">
                        <div>
                            <div className="settings-card-title">Skill Marketplace</div>
                            <div className="settings-card-subtitle">Search and install agent skills</div>
                        </div>
                    </div>

                    {/* Search */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                        <input placeholder="Search skills..." value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && searchSkills()}
                            style={{ flex: 1, padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border-subtle, #333)', background: 'var(--bg-surface, #1a1a1a)', color: 'inherit' }} />
                        <button className="settings-btn settings-btn-secondary" onClick={searchSkills}>🔍 Search</button>
                    </div>
                    {installStatus && <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: installStatus.startsWith('✓') ? '#34d399' : installStatus.startsWith('✗') ? '#ef4444' : 'var(--ink-muted)' }}>{installStatus}</div>}

                    {skills.length === 0 ? (
                        <div className="settings-empty" style={{ marginTop: '0.75rem', padding: '2rem 1rem', textAlign: 'center' }}>
                            <p style={{ color: 'var(--ink-muted)' }}>No skills installed. Use search to discover and install skills.</p>
                        </div>
                    ) : (
                        <div style={{ marginTop: '0.75rem' }}>
                            {skills.map(s => (
                                <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', borderBottom: '1px solid var(--border-subtle, #333)' }}>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{s.name} <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>v{s.version}</span></div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>{s.description}</div>
                                        <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                            <span style={{ color: '#fbbf24' }}>{stars(s.rating)}</span>
                                            <span style={{ color: 'var(--ink-muted)', marginLeft: '0.5rem' }}>({s.ratingCount}) • {s.downloads} downloads • by {s.author}</span>
                                        </div>
                                    </div>
                                    <button className="settings-btn settings-btn-secondary" onClick={() => installSkill(s.name)}>
                                        {s.installedAt ? '✓ Installed' : '↓ Install'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
