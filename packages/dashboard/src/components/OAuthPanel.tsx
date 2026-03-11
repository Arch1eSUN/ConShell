import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import type { OAuthProviderInfo } from '../lib/api';
import './OAuthPanel.css';

const FLOW_LABELS: Record<string, string> = {
    device_code: 'Device Code',
    authorization_code: 'OAuth',
    guided_key: 'API Key',
};

export function OAuthPanel() {
    const [providers, setProviders] = useState<OAuthProviderInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [keyInput, setKeyInput] = useState<Record<string, string>>({});
    const [status, setStatus] = useState<Record<string, { type: string; msg: string }>>({});
    const pollRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

    const loadProviders = useCallback(async () => {
        try {
            const data = await api.oauthProviders();
            setProviders(data.providers ?? []);
        } catch {
            /* ignore — oauth routes may not be registered */
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadProviders();
        return () => {
            Object.values(pollRef.current).forEach(clearInterval);
        };
    }, [loadProviders]);

    // Start polling for device code / auth code flows
    const startPolling = useCallback((provider: string) => {
        if (pollRef.current[provider]) return;
        pollRef.current[provider] = setInterval(async () => {
            try {
                const data = await api.oauthStatus(provider);
                if (data.connected) {
                    clearInterval(pollRef.current[provider]);
                    delete pollRef.current[provider];
                    setStatus(prev => ({ ...prev, [provider]: { type: 'success', msg: 'Connected' } }));
                    loadProviders();
                } else if (data.flow?.error) {
                    clearInterval(pollRef.current[provider]);
                    delete pollRef.current[provider];
                    setStatus(prev => ({ ...prev, [provider]: { type: 'error', msg: data.flow?.error ?? 'Flow failed' } }));
                }
            } catch { /* ignore */ }
        }, 3000);
    }, [loadProviders]);

    const handleConnect = async (p: OAuthProviderInfo) => {
        setStatus(prev => ({ ...prev, [p.provider]: { type: 'info', msg: 'Starting...' } }));
        try {
            const data = await api.oauthStart(p.provider);
            const flow = data.flow;

            if (flow.flowType === 'device_code' && flow.userCode && flow.verificationUri) {
                setStatus(prev => ({
                    ...prev,
                    [p.provider]: {
                        type: 'pending',
                        msg: `Enter code: ${flow.userCode} at ${flow.verificationUri}`,
                    },
                }));
                window.open(flow.verificationUri, '_blank');
                startPolling(p.provider);
            } else if (flow.flowType === 'authorization_code' && flow.authUrl) {
                setStatus(prev => ({
                    ...prev,
                    [p.provider]: { type: 'pending', msg: 'Waiting for authorization...' },
                }));
                window.open(flow.authUrl, 'oauth_popup', 'width=600,height=700');
                startPolling(p.provider);
            } else if (flow.flowType === 'guided_key' && flow.guideUrl) {
                setStatus(prev => ({
                    ...prev,
                    [p.provider]: { type: 'guide', msg: flow.guideUrl ?? '' },
                }));
                window.open(flow.guideUrl, '_blank');
            }
        } catch (err) {
            setStatus(prev => ({
                ...prev,
                [p.provider]: { type: 'error', msg: err instanceof Error ? err.message : 'Failed' },
            }));
        }
    };

    const handleManualKey = async (provider: string) => {
        const key = keyInput[provider]?.trim();
        if (!key) return;
        setStatus(prev => ({ ...prev, [provider]: { type: 'info', msg: 'Validating...' } }));
        try {
            await api.oauthManual(provider, key);
            setStatus(prev => ({ ...prev, [provider]: { type: 'success', msg: 'Connected and validated' } }));
            setKeyInput(prev => ({ ...prev, [provider]: '' }));
            loadProviders();
        } catch (err) {
            setStatus(prev => ({
                ...prev,
                [provider]: { type: 'error', msg: err instanceof Error ? err.message : 'Invalid key' },
            }));
        }
    };

    const handleDisconnect = async (provider: string) => {
        try {
            await api.oauthDisconnect(provider);
            setStatus(prev => ({ ...prev, [provider]: { type: 'info', msg: 'Disconnected' } }));
            loadProviders();
        } catch { /* ignore */ }
    };

    if (loading) return <div className="oauth-loading">Loading providers...</div>;

    return (
        <div className="oauth-panel">
            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">OAuth Connections</div>
                        <div className="settings-card-subtitle">
                            Connect to AI providers via OAuth or API key
                        </div>
                    </div>
                </div>

                <div className="oauth-grid">
                    {providers.map(p => (
                        <div key={p.provider} className={`oauth-card ${p.connected ? 'connected' : ''}`}>
                            <div className="oauth-card-header">
                                <div className="oauth-provider-name">{p.displayName}</div>
                                <span className={`oauth-badge ${p.connected ? 'connected' : 'disconnected'}`}>
                                    {p.connected ? 'Connected' : 'Not connected'}
                                </span>
                            </div>

                            <div className="oauth-flow-type">
                                {FLOW_LABELS[p.flowType] ?? p.flowType}
                            </div>

                            {/* Status message */}
                            {status[p.provider] && (
                                <div className={`oauth-status ${status[p.provider].type}`}>
                                    {status[p.provider].type === 'pending' && (
                                        <span className="oauth-spinner" />
                                    )}
                                    {status[p.provider].msg}
                                </div>
                            )}

                            {/* Guided key input (for Claude/OpenAI) */}
                            {status[p.provider]?.type === 'guide' && !p.connected && (
                                <div className="oauth-key-input">
                                    <input
                                        type="password"
                                        className="settings-input"
                                        placeholder="Paste API key here..."
                                        value={keyInput[p.provider] ?? ''}
                                        onChange={e => setKeyInput(prev => ({ ...prev, [p.provider]: e.target.value }))}
                                        onKeyDown={e => e.key === 'Enter' && handleManualKey(p.provider)}
                                    />
                                    <button
                                        className="settings-btn settings-btn-primary"
                                        onClick={() => handleManualKey(p.provider)}
                                        disabled={!keyInput[p.provider]?.trim()}
                                    >
                                        Validate
                                    </button>
                                </div>
                            )}

                            {/* Action buttons */}
                            <div className="oauth-actions">
                                {p.connected ? (
                                    <button
                                        className="settings-btn oauth-disconnect-btn"
                                        onClick={() => handleDisconnect(p.provider)}
                                    >
                                        Disconnect
                                    </button>
                                ) : (
                                    <button
                                        className="settings-btn settings-btn-primary"
                                        onClick={() => handleConnect(p)}
                                        disabled={status[p.provider]?.type === 'pending'}
                                    >
                                        Connect
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {providers.length === 0 && (
                    <div className="oauth-empty">
                        OAuth routes not available. Ensure the backend is running with OAuth configuration.
                    </div>
                )}
            </div>
        </div>
    );
}
