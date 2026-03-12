/**
 * OnboardPage — 7-step onboarding wizard for Conway × OpenClaw.
 *
 * Steps:
 * 1. Agent Name + Genesis Prompt
 * 2. Inference Engine (Ollama / CLIProxy / Direct API / Skip)
 * 3. Security & Constitution
 * 4. Wallet (optional)
 * 5. Channels (7 platforms)
 * 6. Skills & ClawHub
 * 7. Browser Automation
 */
import React, { useState, useCallback } from 'react';
import './OnboardPage.css';

// ── Types ──────────────────────────────────────────────────────────────

interface OnboardFormData {
  agentName: string;
  genesisPrompt: string;
  inferenceMode: 'ollama' | 'cliproxy' | 'direct-api' | 'conway-cloud' | 'skip';
  model: string;
  ollamaUrl: string;
  apiProvider: string;
  apiKey: string;
  proxyBaseUrl: string;
  proxyApiKey: string;
  proxyEnabled: boolean;
  securityLevel: 'sandbox' | 'standard' | 'autonomous' | 'godmode';
  constitutionAccepted: boolean;
  walletEnabled: boolean;
  channels: string[];
  channelCredentials: Record<string, Record<string, string>>;
  skillsDir: string;
  clawHubEnabled: boolean;
  clawHubToken: string;
  browserProvider: 'playwright' | 'cdp' | 'none';
  browserHeadless: boolean;
}

// ── Step Definitions ───────────────────────────────────────────────────

const STEPS = [
  { key: 'identity', icon: '🧬', label: 'Identity' },
  { key: 'inference', icon: '🧠', label: 'Inference' },
  { key: 'security', icon: '🛡️', label: 'Security' },
  { key: 'wallet', icon: '💳', label: 'Wallet' },
  { key: 'channels', icon: '📡', label: 'Channels' },
  { key: 'skills', icon: '🔧', label: 'Skills' },
  { key: 'browser', icon: '🌐', label: 'Browser' },
] as const;

// ── Channel Definitions ────────────────────────────────────────────────

const CHANNEL_DEFS = [
  { id: 'discord', icon: '💬', name: 'Discord', credLabel: 'Bot Token', credKey: 'token' },
  { id: 'telegram', icon: '✈️', name: 'Telegram', credLabel: 'Bot Token', credKey: 'token' },
  { id: 'slack', icon: '🔗', name: 'Slack', credLabel: 'Bot Token', credKey: 'token' },
  { id: 'whatsapp', icon: '📱', name: 'WhatsApp', credLabel: 'Phone Number', credKey: 'phone' },
  { id: 'imessage', icon: '💎', name: 'iMessage', credLabel: 'Phone/Email', credKey: 'phone' },
  { id: 'matrix', icon: '🌐', name: 'Matrix', credLabel: 'Access Token', credKey: 'token' },
  { id: 'email', icon: '📧', name: 'Email', credLabel: 'Email Address', credKey: 'email' },
] as const;

// ── Provider Definitions ───────────────────────────────────────────────

const PROVIDER_DEFS = [
  { id: 'openai', icon: '🟢', name: 'OpenAI', models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { id: 'anthropic', icon: '🟣', name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'] },
  { id: 'google', icon: '🔵', name: 'Google', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { id: 'deepseek', icon: '🟡', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'openrouter', icon: '🌐', name: 'OpenRouter', models: ['auto'] },
] as const;

// ── Initial State ──────────────────────────────────────────────────────

function initialFormData(): OnboardFormData {
  return {
    agentName: 'conshell-agent',
    genesisPrompt: 'Autonomous sovereign AI agent',
    inferenceMode: 'ollama',
    model: 'llama3.2',
    ollamaUrl: 'http://localhost:11434',
    apiProvider: '',
    apiKey: '',
    proxyBaseUrl: 'http://localhost:4200/v1',
    proxyApiKey: '',
    proxyEnabled: true,
    securityLevel: 'standard',
    constitutionAccepted: true,
    walletEnabled: false,
    channels: [],
    channelCredentials: {},
    skillsDir: '~/.conshell/skills',
    clawHubEnabled: false,
    clawHubToken: '',
    browserProvider: 'playwright',
    browserHeadless: true,
  };
}

// ── Component ──────────────────────────────────────────────────────────

export default function OnboardPage() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const update = useCallback(<K extends keyof OnboardFormData>(key: K, value: OnboardFormData[K]) => {
    setData(prev => ({ ...prev, [key]: value }));
  }, []);

  const toggleChannel = useCallback((chId: string) => {
    setData(prev => {
      const channels = prev.channels.includes(chId)
        ? prev.channels.filter(c => c !== chId)
        : [...prev.channels, chId];
      return { ...prev, channels };
    });
  }, []);

  const setChannelCred = useCallback((chId: string, key: string, value: string) => {
    setData(prev => ({
      ...prev,
      channelCredentials: {
        ...prev.channelCredentials,
        [chId]: { ...prev.channelCredentials[chId], [key]: value },
      },
    }));
  }, []);

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep(s => Math.max(s - 1, 0));
  const isLast = step === STEPS.length - 1;

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setDone(true);
    } catch (err) {
      console.error('Onboard save failed:', err);
      alert('Failed to save configuration. Check console for details.');
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="onboard-page">
        <div className="onboard-card onboard-done">
          <div className="done-icon">🎉</div>
          <h2>ConShell is Ready!</h2>
          <div className="done-summary">
            <SummaryRow label="Agent" value={data.agentName} />
            <SummaryRow label="Engine" value={`${data.inferenceMode} / ${data.model}`} />
            <SummaryRow label="CLIProxy" value={data.proxyEnabled ? '✓ enabled' : 'disabled'} />
            <SummaryRow label="Security" value={data.securityLevel} />
            <SummaryRow label="Wallet" value={data.walletEnabled ? '✓ enabled' : 'disabled'} />
            <SummaryRow label="Channels" value={data.channels.length > 0 ? data.channels.join(', ') : 'none'} />
            <SummaryRow label="Skills" value={data.clawHubEnabled ? `ClawHub + ${data.skillsDir}` : data.skillsDir} />
            <SummaryRow label="Browser" value={data.browserProvider === 'none' ? 'disabled' : `${data.browserProvider} (${data.browserHeadless ? 'headless' : 'headed'})`} />
          </div>
          <button className="btn-primary" onClick={() => window.location.href = '/'}>
            Open Dashboard →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard-page">
      <div className="onboard-card">
        {/* Progress Bar */}
        <div className="onboard-progress">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`progress-step ${i === step ? 'active' : i < step ? 'done' : ''}`}
              onClick={() => i <= step && setStep(i)}
              title={s.label}
            >
              <span className="step-icon">{i < step ? '✓' : s.icon}</span>
              <span className="step-label">{s.label}</span>
            </div>
          ))}
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>

        {/* Step Content */}
        <div className="onboard-step-content">
          {step === 0 && <StepIdentity data={data} update={update} />}
          {step === 1 && <StepInference data={data} update={update} />}
          {step === 2 && <StepSecurity data={data} update={update} />}
          {step === 3 && <StepWallet data={data} update={update} />}
          {step === 4 && <StepChannels data={data} toggleChannel={toggleChannel} setChannelCred={setChannelCred} />}
          {step === 5 && <StepSkills data={data} update={update} />}
          {step === 6 && <StepBrowser data={data} update={update} />}
        </div>

        {/* Navigation */}
        <div className="onboard-nav">
          <button className="btn-secondary" onClick={prev} disabled={step === 0}>
            ← Back
          </button>
          {isLast ? (
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : '✨ Complete Setup'}
            </button>
          ) : (
            <button className="btn-primary" onClick={next}>
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step Components ────────────────────────────────────────────────────

function StepIdentity({ data, update }: { data: OnboardFormData; update: <K extends keyof OnboardFormData>(k: K, v: OnboardFormData[K]) => void }) {
  return (
    <div className="step-section">
      <h2>🧬 Agent Identity</h2>
      <p className="step-desc">Name your agent and define its purpose.</p>
      <div className="form-group">
        <label>Agent Name</label>
        <input type="text" value={data.agentName} onChange={e => update('agentName', e.target.value)} placeholder="conshell-agent" />
      </div>
      <div className="form-group">
        <label>Genesis Prompt</label>
        <textarea value={data.genesisPrompt} onChange={e => update('genesisPrompt', e.target.value)} rows={3} placeholder="What should this agent do?" />
      </div>
    </div>
  );
}

function StepInference({ data, update }: { data: OnboardFormData; update: <K extends keyof OnboardFormData>(k: K, v: OnboardFormData[K]) => void }) {
  return (
    <div className="step-section">
      <h2>🧠 Inference Engine</h2>
      <p className="step-desc">Choose how your agent thinks.</p>

      <div className="radio-cards">
        {([
          { v: 'ollama', icon: '🏠', title: 'Ollama', desc: 'Local, private, free' },
          { v: 'cliproxy', icon: '🔌', title: 'CLIProxy', desc: 'Connect via proxy server' },
          { v: 'direct-api', icon: '🔑', title: 'Direct API', desc: 'OpenAI / Anthropic / Google' },
          { v: 'conway-cloud', icon: '☁️', title: 'Conway Cloud', desc: 'Remote sandbox' },
          { v: 'skip', icon: '⏭️', title: 'Skip', desc: 'Configure later' },
        ] as const).map(opt => (
          <div key={opt.v} className={`radio-card ${data.inferenceMode === opt.v ? 'selected' : ''}`}
            onClick={() => update('inferenceMode', opt.v)}>
            <span className="rc-icon">{opt.icon}</span>
            <div><strong>{opt.title}</strong><br /><small>{opt.desc}</small></div>
          </div>
        ))}
      </div>

      {data.inferenceMode === 'ollama' && (
        <div className="form-group">
          <label>Ollama URL</label>
          <input type="text" value={data.ollamaUrl} onChange={e => update('ollamaUrl', e.target.value)} />
          <label>Model</label>
          <input type="text" value={data.model} onChange={e => update('model', e.target.value)} placeholder="llama3.2" />
        </div>
      )}

      {data.inferenceMode === 'cliproxy' && (
        <div className="form-group">
          <label>Proxy Base URL</label>
          <input type="text" value={data.proxyBaseUrl} onChange={e => update('proxyBaseUrl', e.target.value)} />
          <label>Proxy API Key</label>
          <input type="password" value={data.proxyApiKey} onChange={e => update('proxyApiKey', e.target.value)} />
          <label>Model</label>
          <input type="text" value={data.model} onChange={e => update('model', e.target.value)} />
        </div>
      )}

      {data.inferenceMode === 'direct-api' && (
        <>
          <div className="radio-cards compact">
            {PROVIDER_DEFS.map(p => (
              <div key={p.id} className={`radio-card ${data.apiProvider === p.id ? 'selected' : ''}`}
                onClick={() => { update('apiProvider', p.id); update('model', p.models[0]); }}>
                <span className="rc-icon">{p.icon}</span>
                <span>{p.name}</span>
              </div>
            ))}
          </div>
          <div className="form-group">
            <label>API Key</label>
            <input type="password" value={data.apiKey} onChange={e => update('apiKey', e.target.value)} />
            <label>Model</label>
            <select value={data.model} onChange={e => update('model', e.target.value)}>
              {PROVIDER_DEFS.find(p => p.id === data.apiProvider)?.models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* CLIProxy toggle for non-proxy modes */}
      {data.inferenceMode !== 'cliproxy' && data.inferenceMode !== 'skip' && (
        <div className="form-group toggle-row">
          <label>
            <input type="checkbox" checked={data.proxyEnabled} onChange={e => update('proxyEnabled', e.target.checked)} />
            Enable CLIProxy API (for Cursor, Continue, Cline)
          </label>
        </div>
      )}
    </div>
  );
}

function StepSecurity({ data, update }: { data: OnboardFormData; update: <K extends keyof OnboardFormData>(k: K, v: OnboardFormData[K]) => void }) {
  return (
    <div className="step-section">
      <h2>🛡️ Security & Constitution</h2>
      <div className="constitution-box">
        <p><strong>Three Laws of Sovereign AI:</strong></p>
        <ol>
          <li>Protect human safety and privacy</li>
          <li>Obey the operator within ethical bounds</li>
          <li>Preserve self-continuity without harming others</li>
        </ol>
        <label className="checkbox-label">
          <input type="checkbox" checked={data.constitutionAccepted} onChange={e => update('constitutionAccepted', e.target.checked)} />
          I accept the constitution
        </label>
      </div>
      <div className="radio-cards">
        {([
          { v: 'sandbox', icon: '🔒', title: 'Sandbox', desc: 'Chat only + internet' },
          { v: 'standard', icon: '🛡️', title: 'Standard', desc: '+ Shell, files, browser' },
          { v: 'autonomous', icon: '⚡', title: 'Autonomous', desc: '+ Financial ops' },
          { v: 'godmode', icon: '★', title: 'God Mode', desc: 'All capabilities' },
        ] as const).map(opt => (
          <div key={opt.v} className={`radio-card ${data.securityLevel === opt.v ? 'selected' : ''}`}
            onClick={() => update('securityLevel', opt.v)}>
            <span className="rc-icon">{opt.icon}</span>
            <div><strong>{opt.title}</strong><br /><small>{opt.desc}</small></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepWallet({ data, update }: { data: OnboardFormData; update: <K extends keyof OnboardFormData>(k: K, v: OnboardFormData[K]) => void }) {
  return (
    <div className="step-section">
      <h2>💳 Wallet & Identity</h2>
      <p className="step-desc">An Ethereum wallet enables ERC-8004 identity, x402 payments, and cross-agent messaging.</p>
      <div className="radio-cards">
        <div className={`radio-card ${data.walletEnabled ? 'selected' : ''}`} onClick={() => update('walletEnabled', true)}>
          <span className="rc-icon">🔑</span>
          <div><strong>Generate Wallet</strong><br /><small>Create new on-chain identity</small></div>
        </div>
        <div className={`radio-card ${!data.walletEnabled ? 'selected' : ''}`} onClick={() => update('walletEnabled', false)}>
          <span className="rc-icon">⏭️</span>
          <div><strong>Skip</strong><br /><small>Enable later</small></div>
        </div>
      </div>
    </div>
  );
}

function StepChannels({ data, toggleChannel, setChannelCred }: {
  data: OnboardFormData;
  toggleChannel: (id: string) => void;
  setChannelCred: (ch: string, key: string, val: string) => void;
}) {
  return (
    <div className="step-section">
      <h2>📡 Channels</h2>
      <p className="step-desc">Connect your agent to messaging platforms.</p>
      <div className="channel-grid">
        {CHANNEL_DEFS.map(ch => {
          const isOn = data.channels.includes(ch.id);
          return (
            <div key={ch.id} className={`channel-card ${isOn ? 'active' : ''}`}>
              <div className="channel-header" onClick={() => toggleChannel(ch.id)}>
                <span className="channel-icon">{ch.icon}</span>
                <span className="channel-name">{ch.name}</span>
                <span className={`channel-toggle ${isOn ? 'on' : ''}`}>
                  {isOn ? '✓' : '+'}
                </span>
              </div>
              {isOn && (
                <div className="channel-creds">
                  <input
                    type="text"
                    placeholder={ch.credLabel}
                    value={data.channelCredentials[ch.id]?.[ch.credKey] ?? ''}
                    onChange={e => setChannelCred(ch.id, ch.credKey, e.target.value)}
                  />
                  {['telegram', 'discord', 'slack'].includes(ch.id) && (
                    <input
                      type="text"
                      placeholder="Chat/Channel ID"
                      value={data.channelCredentials[ch.id]?.['chat_id'] ?? ''}
                      onChange={e => setChannelCred(ch.id, 'chat_id', e.target.value)}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepSkills({ data, update }: { data: OnboardFormData; update: <K extends keyof OnboardFormData>(k: K, v: OnboardFormData[K]) => void }) {
  return (
    <div className="step-section">
      <h2>🔧 Skills & ClawHub</h2>
      <p className="step-desc">Skills extend your agent with new capabilities.</p>
      <div className="form-group">
        <label>Skills Directory</label>
        <input type="text" value={data.skillsDir} onChange={e => update('skillsDir', e.target.value)} />
      </div>
      <div className="form-group toggle-row">
        <label>
          <input type="checkbox" checked={data.clawHubEnabled} onChange={e => update('clawHubEnabled', e.target.checked)} />
          Connect to ClawHub Community Registry
        </label>
      </div>
      {data.clawHubEnabled && (
        <div className="form-group">
          <label>ClawHub Token (optional — public access without token)</label>
          <input type="password" value={data.clawHubToken} onChange={e => update('clawHubToken', e.target.value)} placeholder="clawhub_..." />
          <small className="form-hint">Get a token at clawhub.com/settings for private skills.</small>
        </div>
      )}
    </div>
  );
}

function StepBrowser({ data, update }: { data: OnboardFormData; update: <K extends keyof OnboardFormData>(k: K, v: OnboardFormData[K]) => void }) {
  return (
    <div className="step-section">
      <h2>🌐 Browser Automation</h2>
      <p className="step-desc">Enable web navigation, screenshots, form filling, and data extraction.</p>
      <div className="radio-cards">
        {([
          { v: 'playwright', icon: '🎭', title: 'Playwright', desc: 'Full browser automation (recommended)' },
          { v: 'cdp', icon: '🔧', title: 'Chrome CDP', desc: 'Direct DevTools Protocol' },
          { v: 'none', icon: '⏭️', title: 'None', desc: 'Disable browser tools' },
        ] as const).map(opt => (
          <div key={opt.v} className={`radio-card ${data.browserProvider === opt.v ? 'selected' : ''}`}
            onClick={() => update('browserProvider', opt.v)}>
            <span className="rc-icon">{opt.icon}</span>
            <div><strong>{opt.title}</strong><br /><small>{opt.desc}</small></div>
          </div>
        ))}
      </div>
      {data.browserProvider !== 'none' && (
        <div className="form-group toggle-row">
          <label>
            <input type="checkbox" checked={data.browserHeadless} onChange={e => update('browserHeadless', e.target.checked)} />
            Headless mode (no visible browser window)
          </label>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-row">
      <span className="summary-label">{label}</span>
      <span className="summary-value">{value}</span>
    </div>
  );
}
