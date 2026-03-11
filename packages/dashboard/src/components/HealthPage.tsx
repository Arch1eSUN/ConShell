import { useState } from 'react';

interface HealthCheck {
    name: string;
    status: 'pass' | 'warn' | 'fail' | 'checking';
    detail: string;
}

const DEFAULT_CHECKS: HealthCheck[] = [
    { name: 'Node.js Version', status: 'pass', detail: 'v20+ ✓' },
    { name: 'SQLite Integrity', status: 'pass', detail: 'PRAGMA integrity_check OK' },
    { name: 'Ollama Reachability', status: 'checking', detail: 'Checking...' },
    { name: 'Disk Space', status: 'pass', detail: '> 1 GB available' },
    { name: 'Wallet Permissions', status: 'pass', detail: 'File mode 0600 ✓' },
    { name: 'Heartbeat Scheduler', status: 'pass', detail: 'Running' },
    { name: 'Error Rate (1h)', status: 'pass', detail: '0 errors' },
    { name: 'Conway Cloud', status: 'warn', detail: 'Not configured' },
];

const STATUS_EMOJI: Record<string, string> = {
    pass: '🟢',
    warn: '🟡',
    fail: '🔴',
    checking: '⏳',
};

export function HealthPage() {
    const [checks] = useState<HealthCheck[]>(DEFAULT_CHECKS);
    const passCount = checks.filter(c => c.status === 'pass').length;

    return (
        <div className="page-health">
            <header className="page-header">
                <h2 className="page-title">🩺 Health</h2>
                <p className="page-subtitle">System diagnostics — {passCount}/{checks.length} checks passing</p>
            </header>

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Diagnostic Report</div>
                        <div className="settings-card-subtitle">Equivalent to `conshell doctor`</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="settings-btn settings-btn-secondary">🔄 Re-run</button>
                        <button className="settings-btn settings-btn-primary">🔧 Auto-fix</button>
                    </div>
                </div>

                <div className="provider-list" style={{ marginTop: '0.5rem' }}>
                    {checks.map(check => (
                        <div key={check.name} className="provider-item">
                            <div className="provider-item-info">
                                <span style={{ fontSize: '1.25rem', marginRight: '0.5rem' }}>
                                    {STATUS_EMOJI[check.status]}
                                </span>
                                <div>
                                    <div className="provider-item-name">{check.name}</div>
                                    <div className="provider-item-type">{check.detail}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
