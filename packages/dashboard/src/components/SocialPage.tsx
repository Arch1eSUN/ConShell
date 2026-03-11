import { useState } from 'react';

interface SocialMessage {
    id: string;
    from: string;
    content: string;
    timestamp: number;
}

interface ReputationEntry {
    address: string;
    score: number;
    interactions: number;
}

export function SocialPage() {
    const [messages] = useState<SocialMessage[]>([]);
    const [reputation] = useState<ReputationEntry[]>([]);
    const [compose, setCompose] = useState({ to: '', content: '' });

    return (
        <div className="page-social">
            <header className="page-header">
                <h2 className="page-title">💬 Social</h2>
                <p className="page-subtitle">Agent-to-agent communication and reputation</p>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="settings-card">
                    <div className="settings-card-header">
                        <div>
                            <div className="settings-card-title">Inbox</div>
                            <div className="settings-card-subtitle">{messages.length} messages</div>
                        </div>
                    </div>

                    {messages.length === 0 ? (
                        <div className="settings-empty">No messages yet. Other agents can reach you via your address.</div>
                    ) : (
                        <div className="provider-list">
                            {messages.map(msg => (
                                <div key={msg.id} className="provider-item">
                                    <div className="provider-item-info">
                                        <div>
                                            <div className="provider-item-name mono">{msg.from.slice(0, 10)}…</div>
                                            <div className="provider-item-type">{msg.content}</div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div>
                    <div className="settings-card">
                        <div className="settings-card-title">Compose</div>
                        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                            <div className="settings-form-group">
                                <label className="settings-label">To (Agent Address)</label>
                                <input
                                    className="settings-input mono"
                                    placeholder="0x..."
                                    value={compose.to}
                                    onChange={e => setCompose({ ...compose, to: e.target.value })}
                                />
                            </div>
                            <div className="settings-form-group">
                                <label className="settings-label">Message</label>
                                <textarea
                                    className="settings-input"
                                    rows={3}
                                    placeholder="Type your message..."
                                    value={compose.content}
                                    onChange={e => setCompose({ ...compose, content: e.target.value })}
                                    style={{ resize: 'vertical' }}
                                />
                            </div>
                            <button className="settings-btn settings-btn-primary" disabled={!compose.to || !compose.content}>
                                Send Message
                            </button>
                        </div>
                    </div>

                    <div className="settings-card" style={{ marginTop: '1rem' }}>
                        <div className="settings-card-title">Reputation</div>
                        <div className="settings-card-subtitle">Trust scores for known agents</div>

                        {reputation.length === 0 ? (
                            <div className="settings-empty" style={{ marginTop: '0.5rem' }}>
                                No reputation data yet. Interact with other agents to build trust scores.
                            </div>
                        ) : (
                            <div className="provider-list" style={{ marginTop: '0.5rem' }}>
                                {reputation.map(r => (
                                    <div key={r.address} className="provider-item">
                                        <div className="provider-item-info">
                                            <span className={`provider-dot ${r.score > 0 ? 'enabled' : 'disabled'}`} />
                                            <div>
                                                <div className="provider-item-name mono">{r.address.slice(0, 12)}…</div>
                                                <div className="provider-item-type">
                                                    Score: {r.score} · {r.interactions} interactions
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
