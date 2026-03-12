/**
 * ChannelsPage — Manage messaging channels and webhooks.
 *
 * Sections:
 * 1. Connected Messaging Platforms (Telegram, Discord, Slack, WhatsApp, iMessage, Matrix, Email)
 * 2. Webhook Endpoints (existing functionality)
 * 3. Add New Channel modal
 */
import React, { useState, useEffect } from 'react';

interface ChannelInfo {
  channelId: string;
  type: string;
  label: string;
  status: 'connected' | 'disconnected' | 'error';
  messageCount: number;
  connectedAt?: number;
  isolated: boolean;
}

const PLATFORM_META: Record<string, { icon: string; name: string; credLabel: string; credKey: string }> = {
  discord:   { icon: '💬', name: 'Discord',   credLabel: 'Bot Token',     credKey: 'token' },
  telegram:  { icon: '✈️', name: 'Telegram',  credLabel: 'Bot Token',     credKey: 'token' },
  slack:     { icon: '🔗', name: 'Slack',     credLabel: 'Bot Token',     credKey: 'token' },
  whatsapp:  { icon: '📱', name: 'WhatsApp',  credLabel: 'Phone Number',  credKey: 'phone' },
  imessage:  { icon: '💎', name: 'iMessage',  credLabel: 'Phone/Email',   credKey: 'phone' },
  matrix:    { icon: '🌐', name: 'Matrix',    credLabel: 'Access Token',  credKey: 'token' },
  email:     { icon: '📧', name: 'Email',     credLabel: 'Email Address', credKey: 'email' },
  webhook:   { icon: '🔗', name: 'Webhook',   credLabel: 'URL',           credKey: 'url' },
};

const STATUS_COLORS: Record<string, string> = {
  connected: '#00b894',
  disconnected: '#636e72',
  error: '#d63031',
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState('telegram');
  const [addLabel, setAddLabel] = useState('');
  const [addCred, setAddCred] = useState('');
  const [addChatId, setAddChatId] = useState('');

  useEffect(() => {
    loadChannels();
  }, []);

  async function loadChannels() {
    try {
      const resp = await fetch('/api/channels');
      if (resp.ok) {
        const data = await resp.json();
        setChannels(data.channels ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function addChannel() {
    const meta = PLATFORM_META[addType];
    if (!meta) return;

    try {
      const resp = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: addType,
          label: addLabel || `${meta.name} Channel`,
          credentials: {
            [meta.credKey]: addCred,
            ...(addChatId ? { chat_id: addChatId } : {}),
          },
        }),
      });
      if (resp.ok) {
        setShowAdd(false);
        setAddLabel('');
        setAddCred('');
        setAddChatId('');
        loadChannels();
      }
    } catch (err) {
      console.error('Add channel failed:', err);
    }
  }

  async function removeChannel(channelId: string) {
    if (!confirm('Remove this channel?')) return;
    try {
      await fetch(`/api/channels/${channelId}`, { method: 'DELETE' });
      loadChannels();
    } catch (err) {
      console.error('Remove channel failed:', err);
    }
  }

  const messagingChannels = channels.filter(ch => ch.type !== 'webhook');
  const webhookChannels = channels.filter(ch => ch.type === 'webhook');

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>📡 Channels</h1>
        <button className="btn-accent" onClick={() => setShowAdd(true)}>+ Add Channel</button>
      </div>

      {loading ? (
        <div className="loading-state">Loading channels…</div>
      ) : (
        <>
          {/* Messaging Platforms */}
          <section className="section-card">
            <h2>Messaging Platforms</h2>
            {messagingChannels.length === 0 ? (
              <p className="empty-state">No messaging channels connected. Click "Add Channel" to get started.</p>
            ) : (
              <div className="channel-list">
                {messagingChannels.map(ch => {
                  const meta = PLATFORM_META[ch.type] ?? { icon: '❓', name: ch.type };
                  return (
                    <div key={ch.channelId} className="channel-row">
                      <span className="ch-icon">{meta.icon}</span>
                      <div className="ch-info">
                        <strong>{ch.label}</strong>
                        <small>{meta.name} · {ch.messageCount} messages</small>
                      </div>
                      <span className="ch-status" style={{ color: STATUS_COLORS[ch.status] ?? '#636e72' }}>
                        ● {ch.status}
                      </span>
                      {ch.isolated && <span className="ch-badge">isolated</span>}
                      <button className="btn-ghost" onClick={() => removeChannel(ch.channelId)}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Webhooks */}
          <section className="section-card">
            <h2>Webhook Endpoints</h2>
            {webhookChannels.length === 0 ? (
              <p className="empty-state">No webhooks configured.</p>
            ) : (
              <div className="channel-list">
                {webhookChannels.map(ch => (
                  <div key={ch.channelId} className="channel-row">
                    <span className="ch-icon">🔗</span>
                    <div className="ch-info">
                      <strong>{ch.label}</strong>
                      <small>{ch.messageCount} messages</small>
                    </div>
                    <span className="ch-status" style={{ color: STATUS_COLORS[ch.status] ?? '#636e72' }}>
                      ● {ch.status}
                    </span>
                    <button className="btn-ghost" onClick={() => removeChannel(ch.channelId)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Add Channel Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="modal-card">
            <h3>Add Channel</h3>

            <div className="form-group">
              <label>Platform</label>
              <div className="platform-picker">
                {Object.entries(PLATFORM_META).map(([key, meta]) => (
                  <button key={key} className={`platform-btn ${addType === key ? 'selected' : ''}`}
                    onClick={() => setAddType(key)}>
                    <span>{meta.icon}</span>
                    <span>{meta.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Label (optional)</label>
              <input type="text" value={addLabel} onChange={e => setAddLabel(e.target.value)}
                placeholder={`${PLATFORM_META[addType]?.name ?? ''} Channel`} />
            </div>

            <div className="form-group">
              <label>{PLATFORM_META[addType]?.credLabel ?? 'Credential'}</label>
              <input type="text" value={addCred} onChange={e => setAddCred(e.target.value)} />
            </div>

            {['telegram', 'discord', 'slack'].includes(addType) && (
              <div className="form-group">
                <label>Chat / Channel ID</label>
                <input type="text" value={addChatId} onChange={e => setAddChatId(e.target.value)} />
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn-primary" onClick={addChannel} disabled={!addCred}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
