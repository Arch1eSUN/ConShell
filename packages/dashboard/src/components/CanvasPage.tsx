import { useState, useEffect } from 'react';

interface Workspace {
    id: string;
    name: string;
    state: string;
    artifactCount: number;
    createdAt: string;
}

interface Artifact {
    id: string;
    workspaceId: string;
    type: string;
    title: string;
    content: string;
    language?: string;
    createdAt: string;
    updatedAt: string;
}

export function CanvasPage() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [artifacts, setArtifacts] = useState<Artifact[]>([]);
    const [stats, setStats] = useState<{ totalWorkspaces: number; totalArtifacts: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [newName, setNewName] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    const fetchData = async () => {
        setLoading(true);
        try {
            const [statsRes, wsRes] = await Promise.all([
                fetch('/api/canvas/stats'),
                fetch('/api/canvas/workspaces'),
            ]);
            if (statsRes.ok) setStats(await statsRes.json());
            if (wsRes.ok) {
                const data = await wsRes.json();
                setWorkspaces(data.workspaces ?? data);
            }
        } catch { /* silent */ }
        setLoading(false);
    };

    useEffect(() => { fetchData(); }, []);

    const createWorkspace = async () => {
        if (!newName.trim()) return;
        try {
            const res = await fetch('/api/canvas/workspaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName.trim() }),
            });
            if (res.ok) { setNewName(''); fetchData(); }
        } catch { /* silent */ }
    };

    const deleteWorkspace = async (id: string) => {
        try {
            await fetch(`/api/canvas/workspaces/${id}`, { method: 'DELETE' });
            fetchData();
        } catch { /* silent */ }
    };

    const searchArtifacts = async () => {
        if (!searchQuery.trim()) return;
        try {
            const res = await fetch(`/api/canvas/search?q=${encodeURIComponent(searchQuery)}`);
            if (res.ok) {
                const data = await res.json();
                setArtifacts(data.results ?? data);
            }
        } catch { /* silent */ }
    };

    return (
        <div className="page-canvas">
            <header className="page-header">
                <h2 className="page-title">Canvas</h2>
                <p className="page-subtitle">Collaborative workspace for artifacts and documents</p>
            </header>

            {/* Stats */}
            {stats && (
                <section className="glass-panel" style={{ marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '2rem' }}>
                        <div>
                            <span className="label">Workspaces</span>
                            <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{stats.totalWorkspaces}</div>
                        </div>
                        <div>
                            <span className="label">Artifacts</span>
                            <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{stats.totalArtifacts}</div>
                        </div>
                    </div>
                </section>
            )}

            {/* Create workspace */}
            <section className="glass-panel" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>New Workspace</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                        type="text"
                        placeholder="Workspace name..."
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && createWorkspace()}
                        style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.2)', color: 'inherit', fontSize: '0.9rem' }}
                    />
                    <button onClick={createWorkspace} className="btn-primary" style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', background: 'var(--accent, #6366f1)', color: '#fff', border: 'none', cursor: 'pointer' }}>Create</button>
                </div>
            </section>

            {/* Search */}
            <section className="glass-panel" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Search Artifacts</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                        type="text"
                        placeholder="Search by keyword..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && searchArtifacts()}
                        style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.2)', color: 'inherit', fontSize: '0.9rem' }}
                    />
                    <button onClick={searchArtifacts} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', background: 'rgba(255,255,255,0.1)', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}>Search</button>
                </div>
                {artifacts.length > 0 && (
                    <div style={{ marginTop: '0.75rem' }}>
                        {artifacts.map(a => (
                            <div key={a.id} style={{ padding: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: '0.85rem' }}>
                                <strong>{a.title}</strong> <span style={{ opacity: 0.5 }}>({a.type})</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Workspaces list */}
            <section className="glass-panel">
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Workspaces</h3>
                {loading ? (
                    <p style={{ opacity: 0.5 }}>Loading...</p>
                ) : workspaces.length === 0 ? (
                    <p style={{ opacity: 0.5 }}>No workspaces yet</p>
                ) : (
                    workspaces.map(ws => (
                        <div key={ws.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <div>
                                <div style={{ fontWeight: 500 }}>{ws.name}</div>
                                <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>{ws.artifactCount} artifacts · {ws.state}</div>
                            </div>
                            <button onClick={() => deleteWorkspace(ws.id)} style={{ padding: '0.3rem 0.6rem', borderRadius: '0.3rem', background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontSize: '0.8rem' }}>Delete</button>
                        </div>
                    ))
                )}
            </section>
        </div>
    );
}
