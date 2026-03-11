import { useState, useEffect } from 'react';
import './ProviderPanel.css';

interface ProviderInfo {
    name: string;
    available: boolean;
    authType: string;
    endpoint: string;
}

export function ProviderPanel() {
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/providers')
            .then(r => r.json())
            .then(data => {
                setProviders(data.providers ?? []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="provider-panel">
                <div className="panel-skeleton" />
            </div>
        );
    }

    const AUTH_ICONS: Record<string, string> = {
        local: '*',
        apiKey: '#',
        oauth: '~',
        proxy: '/',
    };

    return (
        <div className="provider-panel">
            <h3 className="panel-title">LLM Providers</h3>
            <div className="provider-list">
                {providers.length === 0 ? (
                    <div className="provider-empty">No providers configured</div>
                ) : (
                    providers.map(p => (
                        <div key={p.name} className={`provider-row ${p.available ? 'available' : 'unavailable'}`}>
                            <span className="provider-dot" />
                            <span className="provider-name">{p.name}</span>
                            <span className="provider-auth">
                                {AUTH_ICONS[p.authType] ?? '?'} {p.authType}
                            </span>
                            <span className="provider-status">
                                {p.available ? '✓ ready' : '✗ offline'}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
