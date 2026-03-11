import { useState, useEffect, useCallback } from 'react';

interface Webhook {
    id: string;
    name: string;
    action: 'chat' | 'event';
    eventName?: string;
    enabled: boolean;
    description?: string;
}

export function ChannelsPage() {
    const [webhooks, setWebhooks] = useState<Webhook[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({ name: '', action: 'chat' as 'chat' | 'event', secret: '' });

    const fetchWebhooks = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/webhooks');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setWebhooks(data.webhooks ?? []);
        } catch {
            setWebhooks([]);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

    const addWebhook = async () => {
        if (!form.name) return;
        try {
            const res = await fetch('/api/webhooks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name,
                    action: form.action,
                    secret: form.secret || undefined,
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setForm({ name: '', action: 'chat', secret: '' });
            setShowAdd(false);
            fetchWebhooks();
        } catch (err) {
            console.error('Failed to create webhook:', err);
        }
    };

    const deleteWebhook = async (id: string) => {
        try {
            await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
            fetchWebhooks();
        } catch (err) {
            console.error('Failed to delete webhook:', err);
        }
    };

    return (
        <div className="page-channels">
            <header className="page-header">
                <h2 className="page-title">Channels</h2>
                <p className="page-subtitle">Webhook endpoints for external integrations</p>
            </header>

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Webhooks</div>
                        <div className="settings-card-subtitle">{webhooks.length} webhooks configured</div>
                    </div>
                    <button
                        className="settings-btn settings-btn-primary"
                        onClick={() => setShowAdd(!showAdd)}
                    >
                        {showAdd ? 'Cancel' : '+ Add Webhook'}
                    </button>
                </div>

                {showAdd && (
                    <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--surface, rgba(255,255,255,0.5))', borderRadius: '0.375rem' }}>
                        <div className="settings-input-row">
                            <div className="settings-form-group">
                                <label className="settings-label">Webhook Name</label>
                                <input
                                    className="settings-input"
                                    placeholder="e.g., github-deploy"
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                />
                            </div>
                            <div className="settings-form-group">
                                <label className="settings-label">Action</label>
                                <select
                                    className="settings-select"
                                    value={form.action}
                                    onChange={e => setForm({ ...form, action: e.target.value as 'chat' | 'event' })}
                                >
                                    <option value="chat">Chat (send to agent)</option>
                                    <option value="event">Event (broadcast)</option>
                                </select>
                            </div>
                        </div>
                        <div className="settings-form-group">
                            <label className="settings-label">Secret (optional, for signature verification)</label>
                            <input
                                className="settings-input"
                                type="password"
                                placeholder="HMAC-SHA256 secret"
                                value={form.secret}
                                onChange={e => setForm({ ...form, secret: e.target.value })}
                            />
                        </div>
                        <div style={{ marginTop: '0.75rem' }}>
                            <button
                                className="settings-btn settings-btn-primary"
                                disabled={!form.name}
                                onClick={addWebhook}
                            >
                                Create Webhook
                            </button>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="settings-empty">Loading webhooks...</div>
                ) : webhooks.length === 0 ? (
                    <div className="settings-empty">
                        No webhooks configured. Create one to receive external triggers via HTTP POST.
                    </div>
                ) : (
                    <div className="provider-list">
                        {webhooks.map(wh => (
                            <div key={wh.id} className="provider-item">
                                <div className="provider-item-info">
                                    <span className={`provider-dot ${wh.enabled ? 'enabled' : 'disabled'}`} />
                                    <div>
                                        <div className="provider-item-name">{wh.name}</div>
                                        <div className="provider-item-type">
                                            {wh.action} · ID: {wh.id}
                                            {wh.eventName ? ` · Event: ${wh.eventName}` : ''}
                                        </div>
                                    </div>
                                </div>
                                <div className="provider-item-actions">
                                    <button
                                        className="provider-action-btn"
                                        title="Delete"
                                        onClick={() => deleteWebhook(wh.id)}
                                    >
                                        ×
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
