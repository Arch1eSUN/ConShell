import { useState } from 'react';

interface IdentityInfo {
    address: string;
    name: string;
    description: string;
    capabilities: string[];
    constitutionHash: string;
}

const MOCK_IDENTITY: IdentityInfo = {
    address: '0x0000000000000000000000000000000000000000',
    name: 'ConShell Agent',
    description: 'Sovereign AI runtime — local-first, self-modifying',
    capabilities: ['inference', 'tool-use', 'self-modification', 'financial-transactions'],
    constitutionHash: 'awaiting-initialization',
};

export function IdentityPage() {
    const [identity] = useState<IdentityInfo>(MOCK_IDENTITY);
    const [showPrivateKey, setShowPrivateKey] = useState(false);
    const [password, setPassword] = useState('');

    return (
        <div className="page-identity">
            <header className="page-header">
                <h2 className="page-title">🪪 Identity</h2>
                <p className="page-subtitle">On-chain agent identity (ERC-8004 AgentCard)</p>
            </header>

            <div className="settings-card">
                <div className="settings-card-title">Agent Card</div>
                <div className="settings-card-subtitle">JSON-LD identity document</div>

                <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                    <div className="settings-input-row">
                        <div className="settings-form-group">
                            <label className="settings-label">Agent Name</label>
                            <input className="settings-input" value={identity.name} readOnly />
                        </div>
                        <div className="settings-form-group">
                            <label className="settings-label">Ethereum Address</label>
                            <input className="settings-input mono" value={identity.address} readOnly />
                        </div>
                    </div>

                    <div className="settings-form-group">
                        <label className="settings-label">Description</label>
                        <input className="settings-input" value={identity.description} readOnly />
                    </div>

                    <div className="settings-form-group">
                        <label className="settings-label">Capabilities</label>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {identity.capabilities.map(cap => (
                                <span key={cap} className="routing-model-chip">{cap}</span>
                            ))}
                        </div>
                    </div>

                    <div className="settings-form-group">
                        <label className="settings-label">Constitution Hash (SHA-256)</label>
                        <input className="settings-input mono" value={identity.constitutionHash} readOnly />
                    </div>
                </div>
            </div>

            <div className="settings-card" style={{ marginTop: '1rem' }}>
                <div className="settings-card-title">🔐 Private Key Export</div>
                <div className="settings-card-subtitle">⚠️ Sensitive — requires master password</div>

                {!showPrivateKey ? (
                    <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                        <div className="settings-form-group" style={{ flex: 1 }}>
                            <label className="settings-label">Master Password</label>
                            <input
                                className="settings-input"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="Enter master password..."
                            />
                        </div>
                        <button
                            className="settings-btn settings-btn-primary"
                            disabled={!password}
                            onClick={() => setShowPrivateKey(true)}
                        >
                            Reveal (30s)
                        </button>
                    </div>
                ) : (
                    <div style={{ marginTop: '1rem' }}>
                        <div className="settings-status error">
                            ⚠️ Private key revealed — auto-hides in 30 seconds
                        </div>
                        <input
                            className="settings-input mono"
                            value="0x••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"
                            readOnly
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
