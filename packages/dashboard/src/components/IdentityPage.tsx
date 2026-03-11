export function IdentityPage() {
    return (
        <div className="page-identity">
            <header className="page-header">
                <h2 className="page-title">Identity</h2>
                <p className="page-subtitle">On-chain agent identity (ERC-8004 AgentCard)</p>
            </header>

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Agent Identity</div>
                        <div className="settings-card-subtitle">DID, AgentCard, and key management</div>
                    </div>
                </div>

                <div className="settings-empty" style={{ marginTop: '0.75rem', padding: '2rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        Coming Soon
                    </div>
                    <p style={{ color: 'var(--ink-muted)', maxWidth: '400px', margin: '0 auto' }}>
                        On-chain identity management API is under development. AgentCard minting and DID resolution are planned.
                    </p>
                </div>
            </div>
        </div>
    );
}
