import { useState } from 'react';

interface Channel {
    id: string;
    platform: 'telegram' | 'discord' | 'slack' | 'webhook';
    name: string;
    status: 'connected' | 'disconnected' | 'error';
    messageCount: number;
}

const PLATFORM_ICONS: Record<string, string> = {
    telegram: '✈️',
    discord: '🎮',
    slack: '💼',
    webhook: '🔗',
};

export function ChannelsPage() {
    const [channels] = useState<Channel[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({ platform: 'telegram' as Channel['platform'], name: '', token: '' });

    return (
        <div className="page-channels">
            <header className="page-header">
                <h2 className="page-title">📡 Channels</h2>
                <p className="page-subtitle">Multi-platform messaging integration</p>
            </header>

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Connected Channels</div>
                        <div className="settings-card-subtitle">{channels.length} channels configured</div>
                    </div>
                    <button
                        className="settings-btn settings-btn-primary"
                        onClick={() => setShowAdd(!showAdd)}
                    >
                        {showAdd ? 'Cancel' : '+ Add Channel'}
                    </button>
                </div>

                {showAdd && (
                    <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '0.5rem' }}>
                        <div className="settings-input-row">
                            <div className="settings-form-group">
                                <label className="settings-label">Platform</label>
                                <select
                                    className="settings-select"
                                    value={form.platform}
                                    onChange={e => setForm({ ...form, platform: e.target.value as Channel['platform'] })}
                                >
                                    <option value="telegram">Telegram Bot</option>
                                    <option value="discord">Discord Bot</option>
                                    <option value="slack">Slack Webhook</option>
                                    <option value="webhook">Custom Webhook</option>
                                </select>
                            </div>
                            <div className="settings-form-group">
                                <label className="settings-label">Channel Name</label>
                                <input
                                    className="settings-input"
                                    placeholder="e.g., my-bot"
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="settings-form-group">
                            <label className="settings-label">Token / API Key</label>
                            <input
                                className="settings-input"
                                type="password"
                                placeholder="Encrypted after save (AES-256-GCM)"
                                value={form.token}
                                onChange={e => setForm({ ...form, token: e.target.value })}
                            />
                        </div>
                        <div style={{ marginTop: '0.75rem' }}>
                            <button className="settings-btn settings-btn-primary" disabled={!form.name || !form.token}>
                                Save & Connect
                            </button>
                        </div>
                    </div>
                )}

                {channels.length === 0 ? (
                    <div className="settings-empty">
                        No channels configured. Support: Telegram, Discord, Slack, and custom Webhooks.
                        Tokens are stored in Vault (AES-256-GCM).
                    </div>
                ) : (
                    <div className="provider-list">
                        {channels.map(ch => (
                            <div key={ch.id} className="provider-item">
                                <div className="provider-item-info">
                                    <span className={`provider-dot ${ch.status === 'connected' ? 'enabled' : 'disabled'}`} />
                                    <div>
                                        <div className="provider-item-name">
                                            {PLATFORM_ICONS[ch.platform]} {ch.name}
                                        </div>
                                        <div className="provider-item-type">
                                            {ch.platform} · {ch.status} · {ch.messageCount} msgs
                                        </div>
                                    </div>
                                </div>
                                <div className="provider-item-actions">
                                    <button className="provider-action-btn" title={ch.status === 'connected' ? 'Disconnect' : 'Connect'}>
                                        {ch.status === 'connected' ? '🔌' : '▶️'}
                                    </button>
                                    <button className="provider-action-btn" title="Remove">🗑</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
