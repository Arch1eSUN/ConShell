import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

type Step = 'name' | 'inference' | 'security' | 'wallet' | 'channels' | 'complete';

const STEPS: { id: Step; label: string; optional?: boolean }[] = [
    { id: 'name', label: 'Agent Name' },
    { id: 'inference', label: 'Inference' },
    { id: 'security', label: 'Security' },
    { id: 'wallet', label: 'Wallet', optional: true },
    { id: 'channels', label: 'Channels', optional: true },
];

export function OnboardPage() {
    const [step, setStep] = useState<Step>('name');
    const [data, setData] = useState({
        agentName: '',
        genesisPrompt: '',
        inferenceMode: 'ollama' as 'ollama' | 'cloud' | 'api',
        securityLevel: 'standard' as 'standard' | 'strict' | 'paranoid',
        walletEnabled: false,
        channels: [] as string[],
    });

    const currentIdx = STEPS.findIndex(s => s.id === step);
    const progress = step === 'complete' ? 100 : Math.round((currentIdx / STEPS.length) * 100);

    const canNext = (): boolean => {
        if (step === 'name') return data.agentName.length > 0;
        return true;
    };

    const next = () => {
        if (currentIdx < STEPS.length - 1) {
            setStep(STEPS[currentIdx + 1]!.id);
        } else {
            setStep('complete');
        }
    };

    const prev = () => {
        if (currentIdx > 0) setStep(STEPS[currentIdx - 1]!.id);
    };

    if (step === 'complete') {
        return (
            <div className="page-onboard">
                <header className="page-header">
                    <h2 className="page-title">Setup Complete</h2>
                    <p className="page-subtitle">Your agent "{data.agentName}" is ready</p>
                </header>

                <div className="settings-card" style={{ textAlign: 'center', padding: '3rem' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '1rem', fontWeight: 600 }}>✓</div>
                    <div className="settings-card-title" style={{ fontSize: '1.5rem' }}>Agent Configured</div>
                    <div className="settings-card-subtitle" style={{ marginTop: '0.5rem' }}>
                        Mode: {data.inferenceMode} · Security: {data.securityLevel}
                        {data.walletEnabled && ' · Wallet: Enabled'}
                        {data.channels.length > 0 && ` · Channels: ${data.channels.join(', ')}`}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page-onboard">
            <header className="page-header">
                <h2 className="page-title">Onboarding</h2>
                <p className="page-subtitle">
                    Step {currentIdx + 1} of {STEPS.length} — {progress}% complete
                </p>
            </header>

            {/* Progress bar */}
            <div style={{
                height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px',
                marginBottom: '1.5rem', overflow: 'hidden',
            }}>
                <div style={{
                    height: '100%', width: `${progress}%`,
                    background: 'var(--color-accent, #6366f1)',
                    transition: 'width 0.3s ease',
                }} />
            </div>

            {/* Step indicators */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {STEPS.map((s, i) => (
                    <button
                        key={s.id}
                        className={`settings-tab-btn ${step === s.id ? 'active' : ''}`}
                        onClick={() => i <= currentIdx && setStep(s.id)}
                        disabled={i > currentIdx}
                        style={{ opacity: i > currentIdx ? 0.4 : 1 }}
                    >
                        {s.label} {s.optional ? '(opt)' : ''}
                    </button>
                ))}
            </div>

            <div className="settings-card">
                {step === 'name' && (
                    <>
                        <div className="settings-card-title">Name Your Agent</div>
                        <div className="settings-card-subtitle">Choose a name and describe its purpose</div>
                        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                            <div className="settings-form-group">
                                <label className="settings-label">Agent Name *</label>
                                <input
                                    className="settings-input"
                                    placeholder="e.g., ConShell-Alpha"
                                    value={data.agentName}
                                    onChange={e => setData({ ...data, agentName: e.target.value })}
                                    maxLength={64}
                                />
                            </div>
                            <div className="settings-form-group">
                                <label className="settings-label">Genesis Prompt</label>
                                <textarea
                                    className="settings-input"
                                    rows={4}
                                    placeholder="Describe your agent's initial purpose and personality..."
                                    value={data.genesisPrompt}
                                    onChange={e => setData({ ...data, genesisPrompt: e.target.value })}
                                    style={{ resize: 'vertical' }}
                                />
                            </div>
                        </div>
                    </>
                )}

                {step === 'inference' && (
                    <>
                        <div className="settings-card-title">Choose Inference Mode</div>
                        <div className="settings-card-subtitle">How will your agent think?</div>
                        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                            {([
                                { value: 'ollama', label: 'Local (Ollama)', desc: 'Free, private, runs on your machine' },
                                { value: 'cloud', label: 'ConShell Cloud', desc: 'Powerful models via ConShell Terminal MCP' },
                                { value: 'api', label: 'Direct API', desc: 'OpenAI/Anthropic/etc with your own keys' },
                            ] as const).map(opt => (
                                <label
                                    key={opt.value}
                                    className={`provider-item ${data.inferenceMode === opt.value ? 'selected' : ''}`}
                                    style={{ cursor: 'pointer', border: data.inferenceMode === opt.value ? '1px solid var(--color-accent, #6366f1)' : '1px solid transparent' }}
                                >
                                    <div className="provider-item-info">
                                        <input
                                            type="radio"
                                            name="inference"
                                            checked={data.inferenceMode === opt.value}
                                            onChange={() => setData({ ...data, inferenceMode: opt.value })}
                                            style={{ marginRight: '0.75rem' }}
                                        />
                                        <div>
                                            <div className="provider-item-name">{opt.label}</div>
                                            <div className="provider-item-type">{opt.desc}</div>
                                        </div>
                                    </div>
                                </label>
                            ))}
                        </div>

                        {/* CLIProxy Auto-Detect Banner */}
                        {(data.inferenceMode === 'cloud' || data.inferenceMode === 'api') && (
                            <CliProxyDetectBanner />
                        )}
                    </>
                )}

                {step === 'security' && (
                    <>
                        <div className="settings-card-title">Security Level</div>
                        <div className="settings-card-subtitle">Configure how strict the agent's safety system should be</div>
                        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                            {([
                                { value: 'standard', label: 'Standard', desc: 'Constitution + injection defense + path protection' },
                                { value: 'strict', label: 'Strict', desc: 'Standard + command whitelist + financial limits' },
                                { value: 'paranoid', label: 'Paranoid', desc: 'Strict + all tool calls require confirmation' },
                            ] as const).map(opt => (
                                <label
                                    key={opt.value}
                                    className={`provider-item ${data.securityLevel === opt.value ? 'selected' : ''}`}
                                    style={{ cursor: 'pointer', border: data.securityLevel === opt.value ? '1px solid var(--color-accent, #6366f1)' : '1px solid transparent' }}
                                >
                                    <div className="provider-item-info">
                                        <input
                                            type="radio"
                                            name="security"
                                            checked={data.securityLevel === opt.value}
                                            onChange={() => setData({ ...data, securityLevel: opt.value })}
                                            style={{ marginRight: '0.75rem' }}
                                        />
                                        <div>
                                            <div className="provider-item-name">{opt.label}</div>
                                            <div className="provider-item-type">{opt.desc}</div>
                                        </div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </>
                )}

                {step === 'wallet' && (
                    <>
                        <div className="settings-card-title">Ethereum Wallet (Optional)</div>
                        <div className="settings-card-subtitle">Enable on-chain identity and x402 payments</div>
                        <div style={{ marginTop: '1rem' }}>
                            <label className="provider-item" style={{ cursor: 'pointer' }}>
                                <div className="provider-item-info">
                                    <input
                                        type="checkbox"
                                        checked={data.walletEnabled}
                                        onChange={e => setData({ ...data, walletEnabled: e.target.checked })}
                                        style={{ marginRight: '0.75rem' }}
                                    />
                                    <div>
                                        <div className="provider-item-name">Generate Wallet</div>
                                        <div className="provider-item-type">
                                            Creates an Ethereum keypair for ERC-8004 AgentCard + USDC payments
                                        </div>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </>
                )}

                {step === 'channels' && (
                    <>
                        <div className="settings-card-title">Messaging Channels (Optional)</div>
                        <div className="settings-card-subtitle">Connect your agent to messaging platforms</div>
                        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                            {['telegram', 'discord', 'slack'].map(ch => (
                                <label key={ch} className="provider-item" style={{ cursor: 'pointer' }}>
                                    <div className="provider-item-info">
                                        <input
                                            type="checkbox"
                                            checked={data.channels.includes(ch)}
                                            onChange={e => {
                                                const next = e.target.checked
                                                    ? [...data.channels, ch]
                                                    : data.channels.filter(c => c !== ch);
                                                setData({ ...data, channels: next });
                                            }}
                                            style={{ marginRight: '0.75rem' }}
                                        />
                                        <div className="provider-item-name" style={{ textTransform: 'capitalize' }}>
                                            {ch}
                                        </div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                <button
                    className="settings-btn settings-btn-secondary"
                    onClick={prev}
                    disabled={currentIdx === 0}
                >
                    ← Back
                </button>
                <button
                    className="settings-btn settings-btn-primary"
                    onClick={next}
                    disabled={!canNext()}
                >
                    {currentIdx === STEPS.length - 1 ? '✓ Finish' : 'Next →'}
                </button>
            </div>
        </div>
    );
}

// ── CLIProxy Auto-Detect Banner ─────────────────────────────────────

function CliProxyDetectBanner() {
    const [status, setStatus] = useState<'idle' | 'detecting' | 'found' | 'notfound' | 'registered'>('idle');
    const [proxyInfo, setProxyInfo] = useState<{ endpoint: string; modelCount: number } | null>(null);

    const detect = useCallback(async () => {
        setStatus('detecting');
        try {
            const data = await api.cliproxyDetect();
            if (data.available && data.endpoint) {
                setProxyInfo({ endpoint: data.endpoint, modelCount: data.models?.length ?? 0 });
                setStatus('found');
            } else {
                setStatus('notfound');
            }
        } catch {
            setStatus('notfound');
        }
    }, []);

    useEffect(() => { detect(); }, [detect]);

    const registerProxy = async () => {
        if (!proxyInfo) return;
        try {
            await fetch('/api/settings/providers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'cliproxyapi',
                    authType: 'proxy',
                    endpoint: proxyInfo.endpoint,
                    apiKey: '',
                    priority: 10,
                }),
            });
            setStatus('registered');
        } catch { /* ignore */ }
    };

    return (
        <div style={{
            marginTop: '1rem',
            padding: '1rem',
            borderRadius: '8px',
            background: status === 'found' ? 'rgba(0,255,136,0.08)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${
                status === 'found' ? 'rgba(0,255,136,0.2)' :
                status === 'registered' ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.1)'
            }`,
        }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                CLIProxyAPI Auto-Detect
            </div>
            {status === 'idle' || status === 'detecting' ? (
                <div style={{ color: '#888', fontSize: '0.8rem' }}>Scanning local ports...</div>
            ) : status === 'found' && proxyInfo ? (
                <div style={{ fontSize: '0.8rem' }}>
                    <span style={{ color: '#00ff88' }}>Found at {proxyInfo.endpoint}</span>
                    <span style={{ color: '#888' }}> — {proxyInfo.modelCount} models available</span>
                    <button
                        className="settings-btn settings-btn-primary"
                        style={{ marginLeft: '1rem', fontSize: '0.75rem', padding: '0.3rem 0.8rem' }}
                        onClick={registerProxy}
                    >
                        Register as Provider
                    </button>
                </div>
            ) : status === 'registered' ? (
                <div style={{ color: '#6366f1', fontSize: '0.8rem' }}>
                    Registered. Models will be available after setup.
                </div>
            ) : (
                <div style={{ fontSize: '0.8rem' }}>
                    <span style={{ color: '#888' }}>No local CLIProxyAPI detected.</span>
                    <button
                        className="settings-btn"
                        style={{ marginLeft: '0.5rem', fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                        onClick={detect}
                    >
                        Retry
                    </button>
                </div>
            )}
        </div>
    );
}
