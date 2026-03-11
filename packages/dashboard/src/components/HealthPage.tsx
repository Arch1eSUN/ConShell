import { useState, useEffect, useCallback } from 'react';

interface HealthData {
    status: string;
    agent: string;
    state: string;
    uptime: number;
    authRequired: boolean;
}

interface HealthCheck {
    name: string;
    status: 'pass' | 'warn' | 'fail' | 'checking';
    detail: string;
}

const STATUS_ICON: Record<string, string> = {
    pass: '✓',
    warn: '△',
    fail: '×',
    checking: '…',
};

function buildChecks(data: HealthData): HealthCheck[] {
    const checks: HealthCheck[] = [
        {
            name: 'Server Status',
            status: data.status === 'ok' ? 'pass' : 'fail',
            detail: data.status === 'ok' ? 'Running' : `Status: ${data.status}`,
        },
        {
            name: 'Agent State',
            status: ['running', 'idle'].includes(data.state) ? 'pass' : 'warn',
            detail: data.state,
        },
        {
            name: 'Uptime',
            status: data.uptime > 60 ? 'pass' : 'warn',
            detail: formatUptime(data.uptime),
        },
        {
            name: 'Authentication',
            status: 'pass',
            detail: data.authRequired ? 'Required' : 'Disabled',
        },
        {
            name: 'Agent Name',
            status: data.agent ? 'pass' : 'warn',
            detail: data.agent || 'Not configured',
        },
    ];
    return checks;
}

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

export function HealthPage() {
    const [checks, setChecks] = useState<HealthCheck[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const runDiagnostics = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/health');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: HealthData = await res.json();
            setChecks(buildChecks(data));
        } catch (err) {
            setError('Unable to reach server. Is ConShell running?');
            setChecks([]);
        }
        setLoading(false);
    }, []);

    useEffect(() => { runDiagnostics(); }, [runDiagnostics]);

    const passCount = checks.filter(c => c.status === 'pass').length;

    return (
        <div className="page-health">
            <header className="page-header">
                <h2 className="page-title">Health</h2>
                <p className="page-subtitle">
                    System diagnostics{checks.length > 0 ? ` — ${passCount}/${checks.length} checks passing` : ''}
                </p>
            </header>

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Diagnostic Report</div>
                        <div className="settings-card-subtitle">Equivalent to `conshell doctor`</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            className="settings-btn settings-btn-primary"
                            onClick={runDiagnostics}
                            disabled={loading}
                        >
                            {loading ? 'Running...' : 'Re-run'}
                        </button>
                    </div>
                </div>

                {error ? (
                    <div className="settings-empty" style={{ marginTop: '0.5rem', color: 'var(--ink-muted)' }}>
                        {error}
                    </div>
                ) : (
                    <div className="provider-list" style={{ marginTop: '0.5rem' }}>
                        {checks.map(check => (
                            <div key={check.name} className="provider-item">
                                <div className="provider-item-info">
                                    <span style={{
                                        fontSize: '1.25rem',
                                        marginRight: '0.5rem',
                                        fontWeight: 600,
                                        color: check.status === 'pass' ? 'var(--color-accent, #16A34A)' :
                                               check.status === 'warn' ? '#d97706' : 'var(--ink-muted)',
                                    }}>
                                        {STATUS_ICON[check.status]}
                                    </span>
                                    <div>
                                        <div className="provider-item-name">{check.name}</div>
                                        <div className="provider-item-type">{check.detail}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
