import { useState, useEffect, useCallback } from 'react';

interface AgentTask {
    id: string;
    goal: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    progress: string;
    result?: string;
    error?: string;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
}

const STATUS_BADGE: Record<string, { color: string; bg: string; icon: string }> = {
    pending: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: '⏳' },
    running: { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', icon: '⚡' },
    completed: { color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: '✓' },
    failed: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', icon: '✗' },
    cancelled: { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: '◌' },
};

export function TasksPage() {
    const [tasks, setTasks] = useState<AgentTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [newGoal, setNewGoal] = useState('');
    const [creating, setCreating] = useState(false);
    const [filter, setFilter] = useState<string>('all');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const fetchTasks = useCallback(async () => {
        setError('');
        try {
            const url = filter === 'all' ? '/api/tasks' : `/api/tasks?status=${filter}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setTasks(data.tasks ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load tasks');
        }
        setLoading(false);
    }, [filter]);

    useEffect(() => { fetchTasks(); }, [fetchTasks]);

    // Auto-refresh running tasks
    useEffect(() => {
        const hasActive = tasks.some(t => t.status === 'pending' || t.status === 'running');
        if (!hasActive) return;
        const timer = setInterval(fetchTasks, 5000);
        return () => clearInterval(timer);
    }, [tasks, fetchTasks]);

    const createTask = async () => {
        const goal = newGoal.trim();
        if (!goal) return;
        setCreating(true);
        try {
            const res = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ goal }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setNewGoal('');
            fetchTasks();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create task');
        }
        setCreating(false);
    };

    const cancelTask = async (id: string) => {
        try {
            await fetch(`/api/tasks/${id}/cancel`, { method: 'POST' });
            fetchTasks();
        } catch { /* silent */ }
    };

    const toggle = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const elapsed = (t: AgentTask) => {
        const end = t.completedAt ?? Date.now();
        const start = t.startedAt ?? t.createdAt;
        const secs = Math.round((end - start) / 1000);
        return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
    };

    const filtered = tasks;

    return (
        <div className="page-tasks">
            <header className="page-header">
                <h2 className="page-title">Tasks</h2>
                <p className="page-subtitle">Delegated goals — the agent works autonomously and reports back</p>
            </header>

            {/* Create task */}
            <div className="settings-card" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <input
                        type="text"
                        value={newGoal}
                        onChange={e => setNewGoal(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && createTask()}
                        placeholder="Describe a goal for the agent (e.g. 'Register on evomap and notify me')…"
                        style={{
                            flex: 1, padding: '0.75rem 1rem', borderRadius: 8,
                            border: '1px solid var(--border-subtle, #333)', background: 'transparent',
                            color: 'inherit', fontSize: '0.95rem',
                        }}
                        disabled={creating}
                    />
                    <button
                        className="settings-btn settings-btn-secondary"
                        onClick={createTask}
                        disabled={creating || !newGoal.trim()}
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        {creating ? '⏳ Creating…' : '🚀 Delegate'}
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {['all', 'pending', 'running', 'completed', 'failed'].map(f => (
                    <button
                        key={f}
                        onClick={() => { setFilter(f); setLoading(true); }}
                        style={{
                            padding: '0.35rem 0.75rem', borderRadius: 20,
                            border: filter === f ? '1px solid var(--accent, #6366f1)' : '1px solid var(--border-subtle, #333)',
                            background: filter === f ? 'rgba(99,102,241,0.15)' : 'transparent',
                            color: 'inherit', cursor: 'pointer', fontSize: '0.85rem', textTransform: 'capitalize',
                        }}
                    >
                        {f === 'all' ? 'All' : `${STATUS_BADGE[f]?.icon ?? ''} ${f}`}
                    </button>
                ))}
            </div>

            {/* Error */}
            {error && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>⚠ {error}</span>
                    <button className="settings-btn settings-btn-secondary" onClick={fetchTasks} style={{ fontSize: '0.8rem' }}>⟳ Retry</button>
                </div>
            )}

            {/* Loading */}
            {loading && <div className="settings-empty">Loading tasks…</div>}

            {/* Empty */}
            {!loading && filtered.length === 0 && !error && (
                <div className="settings-card" style={{ textAlign: 'center', padding: '2rem' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
                    <div style={{ color: 'var(--ink-muted)' }}>No tasks yet. Delegate a goal above to get started.</div>
                </div>
            )}

            {/* Task list */}
            {filtered.map(task => {
                const badge = STATUS_BADGE[task.status] ?? STATUS_BADGE.pending;
                const isOpen = expanded.has(task.id);
                return (
                    <div key={task.id} className="settings-card" style={{ marginBottom: '0.75rem', borderLeft: `3px solid ${badge.color}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => toggle(task.id)}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                    <span style={{ padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.75rem', background: badge.bg, color: badge.color, fontWeight: 600 }}>
                                        {badge.icon} {task.status}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>{elapsed(task)}</span>
                                </div>
                                <div style={{ fontSize: '0.95rem', fontWeight: 500 }}>{task.goal}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: '0.15rem' }}>{task.progress}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                {(task.status === 'pending' || task.status === 'running') && (
                                    <button className="settings-btn settings-btn-secondary" onClick={e => { e.stopPropagation(); cancelTask(task.id); }} style={{ fontSize: '0.8rem' }}>Cancel</button>
                                )}
                                <span style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>{isOpen ? '▲' : '▼'}</span>
                            </div>
                        </div>

                        {isOpen && (
                            <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: 6, background: 'rgba(0,0,0,0.2)', fontSize: '0.85rem' }}>
                                <div style={{ marginBottom: '0.25rem' }}><strong>ID:</strong> <code style={{ fontSize: '0.8rem' }}>{task.id}</code></div>
                                <div style={{ marginBottom: '0.25rem' }}><strong>Created:</strong> {new Date(task.createdAt).toLocaleString()}</div>
                                {task.startedAt && <div style={{ marginBottom: '0.25rem' }}><strong>Started:</strong> {new Date(task.startedAt).toLocaleString()}</div>}
                                {task.completedAt && <div style={{ marginBottom: '0.25rem' }}><strong>Completed:</strong> {new Date(task.completedAt).toLocaleString()}</div>}
                                {task.result && (
                                    <div style={{ marginTop: '0.5rem' }}>
                                        <strong>Result:</strong>
                                        <div style={{ marginTop: '0.25rem', padding: '0.5rem', borderRadius: 4, background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                            {task.result}
                                        </div>
                                    </div>
                                )}
                                {task.error && (
                                    <div style={{ marginTop: '0.5rem' }}>
                                        <strong>Error:</strong>
                                        <div style={{ marginTop: '0.25rem', padding: '0.5rem', borderRadius: 4, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', whiteSpace: 'pre-wrap', color: '#ef4444' }}>
                                            {task.error}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
