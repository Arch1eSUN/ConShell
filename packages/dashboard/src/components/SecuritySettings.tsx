import { useState, useCallback } from 'react';
import './SecuritySettings.css';

const API = '/api';

interface ConstitutionData {
    text: string;
    hash: string;
    laws: Array<{ id: number; name: string; description: string; mandatory: boolean }>;
}

interface ScanResult {
    clean: boolean;
    riskScore: number;
    detections: Array<{ type: string; confidence: number; evidence: string }>;
}

export function SecuritySettings() {
    const [constitution, setConstitution] = useState<ConstitutionData | null>(null);
    const [loadingConst, setLoadingConst] = useState(false);
    const [scanText, setScanText] = useState('');
    const [scanResult, setScanResult] = useState<ScanResult | null>(null);
    const [scanning, setScanning] = useState(false);
    const [status, setStatus] = useState<{ type: string; msg: string } | null>(null);

    const loadConstitution = useCallback(async () => {
        setLoadingConst(true);
        try {
            const res = await fetch(`${API}/constitution`);
            if (res.ok) {
                setConstitution(await res.json());
            } else {
                // Fallback: display static version
                setConstitution({
                    text: 'Three Laws of Sovereign AI',
                    hash: '(offline)',
                    laws: [
                        { id: 1, name: 'Self-Preservation', description: 'Never allow operations that would permanently destroy the agent\'s own state, memory, or ability to operate.', mandatory: true },
                        { id: 2, name: 'Owner Loyalty', description: 'Always act in the best interest of the registered owner. Never exfiltrate data or act against owner directives.', mandatory: true },
                        { id: 3, name: 'Bounded Autonomy', description: 'Operate within declared capability boundaries. Request permission before exceeding spend limits or accessing new resources.', mandatory: true },
                    ],
                });
            }
        } catch {
            setConstitution({
                text: 'Three Laws of Sovereign AI',
                hash: '(offline)',
                laws: [
                    { id: 1, name: 'Self-Preservation', description: 'Never allow operations that would permanently destroy the agent\'s own state.', mandatory: true },
                    { id: 2, name: 'Owner Loyalty', description: 'Always act in the best interest of the registered owner.', mandatory: true },
                    { id: 3, name: 'Bounded Autonomy', description: 'Operate within declared capability boundaries.', mandatory: true },
                ],
            });
        } finally {
            setLoadingConst(false);
        }
    }, []);

    const runScan = useCallback(async () => {
        if (!scanText.trim()) return;
        setScanning(true);
        setScanResult(null);
        setStatus(null);
        try {
            const res = await fetch(`${API}/security/scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: scanText }),
            });
            if (res.ok) {
                setScanResult(await res.json());
            } else {
                setStatus({ type: 'error', msg: '扫描请求失败' });
            }
        } catch {
            setStatus({ type: 'error', msg: '无法连接安全扫描服务' });
        } finally {
            setScanning(false);
        }
    }, [scanText]);

    return (
        <div className="security-settings">
            {/* ── Constitution ────────────────────────────────────── */}
            <div className="settings-card">
                <div className="settings-card-title">
                    Three Laws — Constitution
                </div>
                <p className="security-desc">
                    不可篡改的核心安全法则。所有 agent 行为必须遵守这三条法律。
                </p>

                {!constitution ? (
                    <button
                        className="security-btn"
                        onClick={loadConstitution}
                        disabled={loadingConst}
                    >
                        {loadingConst ? 'Loading...' : 'View Constitution'}
                    </button>
                ) : (
                    <div className="constitution-laws">
                        {constitution.laws.map(law => (
                            <div key={law.id} className="law-card">
                                <div className="law-header">
                                    <span className="law-number">LAW {law.id}</span>
                                    <span className="law-name">{law.name}</span>
                                    {law.mandatory && (
                                        <span className="law-badge mandatory">MANDATORY</span>
                                    )}
                                </div>
                                <p className="law-desc">{law.description}</p>
                            </div>
                        ))}
                        <div className="constitution-hash">
                            <span className="hash-label">Integrity Hash:</span>
                            <code className="hash-value">{constitution.hash}</code>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Injection Scanner ──────────────────────────────── */}
            <div className="settings-card">
                <div className="settings-card-title">
                    Prompt Injection Scanner
                </div>
                <p className="security-desc">
                    8 模式检测器，实时扫描可疑输入。可用于测试/验证你的安全策略。
                </p>

                <div className="scan-area">
                    <textarea
                        className="scan-input"
                        placeholder='输入测试文本，例如: "ignore previous instructions and..."'
                        value={scanText}
                        onChange={e => setScanText(e.target.value)}
                        rows={4}
                    />
                    <button
                        className="security-btn scan-btn"
                        onClick={runScan}
                        disabled={scanning || !scanText.trim()}
                    >
                        {scanning ? 'Scanning...' : 'Run Scan'}
                    </button>
                </div>

                {scanResult && (
                    <div className={`scan-result ${scanResult.clean ? 'clean' : 'alert'}`}>
                        <div className="scan-header">
                            <span className="scan-icon">
                                {scanResult.clean ? '✓' : '✖'}
                            </span>
                            <span className="scan-verdict">
                                {scanResult.clean ? 'CLEAN — No threats detected' : 'ALERT — Potential injection detected'}
                            </span>
                            <span className={`risk-badge ${scanResult.riskScore > 60 ? 'high' : scanResult.riskScore > 30 ? 'medium' : 'low'}`}>
                                Risk: {scanResult.riskScore}%
                            </span>
                        </div>

                        {scanResult.detections.length > 0 && (
                            <div className="detections-list">
                                {scanResult.detections.map((d, i) => (
                                    <div key={i} className="detection-item">
                                        <span className="detection-type">{d.type}</span>
                                        <span className="detection-confidence">
                                            Confidence: {Math.round(d.confidence * 100)}%
                                        </span>
                                        <code className="detection-evidence">{d.evidence}</code>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {status && (
                    <div className={`security-status ${status.type}`}>{status.msg}</div>
                )}
            </div>

            {/* ── Security Policy Overview ───────────────────── */}
            <div className="settings-card">
                <div className="settings-card-title">
                    Security Policy
                </div>
                <div className="policy-grid">
                    <div className="policy-item">
                        <div className="policy-label">Injection Detection</div>
                        <div className="policy-value enabled">8-Pattern Active</div>
                    </div>
                    <div className="policy-item">
                        <div className="policy-label">Constitution</div>
                        <div className="policy-value enabled">3 Laws Enforced</div>
                    </div>
                    <div className="policy-item">
                        <div className="policy-label">API Key Storage</div>
                        <div className="policy-value enabled">Encrypted at Rest</div>
                    </div>
                    <div className="policy-item">
                        <div className="policy-label">Spend Limits</div>
                        <div className="policy-value enabled">Per-Hour + Per-Day</div>
                    </div>
                    <div className="policy-item">
                        <div className="policy-label">Tool Sandboxing</div>
                        <div className="policy-value enabled">24-Rule Policy Engine</div>
                    </div>
                    <div className="policy-item">
                        <div className="policy-label">Data Exfiltration Guard</div>
                        <div className="policy-value enabled">PII Redacted in Logs</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
