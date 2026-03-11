export function SocialPage() {
    return (
        <div className="page-social">
            <header className="page-header">
                <h2 className="page-title">Social</h2>
                <p className="page-subtitle">Agent-to-agent communication and reputation</p>
            </header>

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Social Network</div>
                        <div className="settings-card-subtitle">Peer discovery, reputation, and messaging</div>
                    </div>
                </div>

                <div className="settings-empty" style={{ marginTop: '0.75rem', padding: '2rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        Coming Soon
                    </div>
                    <p style={{ color: 'var(--ink-muted)', maxWidth: '400px', margin: '0 auto' }}>
                        Agent-to-agent social API is under development. DID-based identity and A2A protocol support are planned.
                    </p>
                </div>
            </div>
        </div>
    );
}
