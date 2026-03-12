import { useState, useEffect, useCallback } from 'react';
import './SettingsPage.css';
import { CapabilitySettings } from './CapabilitySettings';
import { SkillsPanel } from './SkillsPanel';
import { SecuritySettings } from './SecuritySettings';
import { OAuthPanel } from './OAuthPanel';

// ── Types ─────────────────────────────────────────────────────────────

interface ProviderConfig {
    name: string;
    auth_type: string;
    endpoint: string | null;
    api_key: string | null;
    enabled: number;
    priority: number;
}

interface ModelEntry {
    id: string;
    provider: string;
    name: string;
    input_cost_micro: number;
    output_cost_micro: number;
    max_tokens: number;
    available: number;
    classification: { tier: string; isZeroCost: boolean; label: string };
}

interface RoutingEntry {
    tier: string;
    task_type: string;
    model_id: string;
    priority: number;
    is_custom: number;
}

type SettingsTab = 'providers' | 'oauth' | 'models' | 'routing' | 'capabilities' | 'skills' | 'security' | 'guide';

const API = '/api/settings';

// ── Helpers ─────────────────────────────────────────────────────────────

async function api(path: string, method = 'GET', body?: unknown) {
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(`${API}${path}`, opts);
            if (!res.ok) {
                const text = await res.text().catch(() => res.statusText);
                throw new Error(`API ${res.status}: ${text}`);
            }
            return res.json();
        } catch (err) {
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
            throw new Error(err instanceof Error ? err.message : '连接后端失败，请检查服务是否在运行');
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// SettingsPage
// ══════════════════════════════════════════════════════════════════════════

export function SettingsPage() {
    const [tab, setTab] = useState<SettingsTab>('providers');

    return (
        <div className="settings-page">
            <header className="page-header">
                <h2 className="page-title">Settings</h2>
                <p className="page-subtitle">Provider configuration, model management & routing</p>
            </header>

            <div className="settings-tabs">
                {(['providers', 'oauth', 'models', 'routing', 'capabilities', 'skills', 'security', 'guide'] as SettingsTab[]).map(t => (
                    <button
                        key={t}
                        className={`settings-tab-btn ${tab === t ? 'active' : ''}`}
                        onClick={() => setTab(t)}
                    >
                        {t === 'providers' ? 'Providers' :
                            t === 'oauth' ? 'OAuth' :
                                t === 'models' ? 'Models' :
                                    t === 'routing' ? 'Routing' :
                                        t === 'capabilities' ? 'Permissions' :
                                            t === 'skills' ? 'Skills' :
                                                t === 'security' ? 'Security' : 'Guide'}
                    </button>
                ))}
            </div>

            {tab === 'providers' && <ProvidersSection />}
            {tab === 'oauth' && <OAuthPanel />}
            {tab === 'models' && <ModelsSection />}
            {tab === 'routing' && <RoutingSection />}
            {tab === 'capabilities' && <CapabilitySettings />}
            {tab === 'skills' && <SkillsPanel />}
            {tab === 'security' && <SecuritySettings />}
            {tab === 'guide' && <GuideSection />}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════
// ProvidersSection
// ══════════════════════════════════════════════════════════════════════════

function ProvidersSection() {
    const [providers, setProviders] = useState<ProviderConfig[]>([]);
    const [status, setStatus] = useState<{ type: string; msg: string } | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({
        name: '', authType: 'apiKey', endpoint: '', apiKey: '', priority: 100,
    });
    const [saving, setSaving] = useState(false);

    const [loading, setLoading] = useState(true);

    const loadProviders = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api('/providers');
            setProviders(data.providers ?? []);
            setStatus(null);
        } catch (err) {
            setStatus({ type: 'error', msg: `Failed to load providers: ${err instanceof Error ? err.message : 'Connection error'}` });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadProviders(); }, [loadProviders]);

    const handleSave = async () => {
        setSaving(true);
        setStatus(null);
        try {
            const result = await api('/providers', 'POST', form);
            const discoveredCount = result.discovered?.length ?? 0;
            setStatus({
                type: 'success',
                msg: `✓ Saved "${form.name}" — ${discoveredCount} models discovered`,
            });
            setShowForm(false);
            setForm({ name: '', authType: 'apiKey', endpoint: '', apiKey: '', priority: 100 });
            loadProviders();
        } catch {
            setStatus({ type: 'error', msg: 'Failed to save provider' });
        } finally { setSaving(false); }
    };

    const handleDelete = async (name: string) => {
        await api(`/providers/${name}`, 'DELETE');
        loadProviders();
    };

    const handleToggle = async (name: string, enabled: boolean) => {
        await api(`/providers/${name}`, 'PUT', { enabled: !enabled });
        loadProviders();
    };

    const handleTest = async (name: string) => {
        setStatus({ type: 'info', msg: `Testing ${name}...` });
        const result = await api(`/providers/${name}/test`, 'POST');
        setStatus({
            type: result.ok ? 'success' : 'error',
            msg: result.ok ? `✓ ${name} — ${result.modelCount} models` : `✗ ${name} — ${result.error ?? 'Failed'}`,
        });
    };

    const handleDiscover = async (name: string) => {
        setStatus({ type: 'info', msg: `Discovering models from ${name}...` });
        const result = await api(`/providers/${name}/discover`, 'POST');
        const count = result.discovered?.length ?? 0;
        setStatus({ type: 'success', msg: `Found ${count} models from ${name}` });
    };

    return (
        <>
            {status && (
                <div className={`settings-status ${status.type}`}>{status.msg}</div>
            )}

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">LLM Providers</div>
                        <div className="settings-card-subtitle">Configure API keys and endpoints for AI providers</div>
                    </div>
                    <button className="settings-btn settings-btn-primary" onClick={() => setShowForm(!showForm)}>
                        {showForm ? 'Cancel' : '+ Add Provider'}
                    </button>
                </div>

                {showForm && (
                    <div style={{ marginBottom: '1rem' }}>
                        <div className="settings-input-row">
                            <div className="settings-form-group">
                                <label className="settings-label">Provider Name</label>
                                <input
                                    className="settings-input"
                                    placeholder="e.g. cliproxyapi, openai, ollama"
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                />
                            </div>
                            <div className="settings-form-group">
                                <label className="settings-label">Auth Type</label>
                                <select
                                    className="settings-select"
                                    value={form.authType}
                                    onChange={e => setForm({ ...form, authType: e.target.value })}
                                >
                                    <option value="apiKey">API Key</option>
                                    <option value="proxy">Proxy (CLIProxyAPI)</option>
                                    <option value="local">Local (Ollama)</option>
                                    <option value="oauth">OAuth</option>
                                </select>
                            </div>
                        </div>
                        <div className="settings-form-group">
                            <label className="settings-label">Endpoint</label>
                            <input
                                className="settings-input"
                                placeholder="https://api.example.com"
                                value={form.endpoint}
                                onChange={e => setForm({ ...form, endpoint: e.target.value })}
                            />
                        </div>
                        <div className="settings-form-group">
                            <label className="settings-label">API Key</label>
                            <input
                                className="settings-input"
                                type="password"
                                placeholder="sk-..."
                                value={form.apiKey}
                                onChange={e => setForm({ ...form, apiKey: e.target.value })}
                            />
                        </div>
                        <div className="settings-btn-row">
                            <button
                                className="settings-btn settings-btn-primary"
                                onClick={handleSave}
                                disabled={saving || !form.name}
                            >
                                {saving ? 'Saving...' : 'Save & Discover Models'}
                            </button>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="settings-empty" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}>
                        ⏳ Loading providers...
                    </div>
                ) : status?.type === 'error' && providers.length === 0 ? (
                    <div className="settings-empty" style={{ textAlign: 'center' }}>
                        <p style={{ color: '#ef4444', marginBottom: '0.75rem' }}>{status.msg}</p>
                        <button className="settings-btn settings-btn-secondary" onClick={loadProviders}>⟳ Retry</button>
                    </div>
                ) : providers.length === 0 ? (
                    <div className="settings-empty">
                        No providers configured yet. Click "+ Add Provider" to get started.
                    </div>
                ) : (
                    <div className="provider-list">
                        {providers.map(p => (
                            <div key={p.name} className="provider-item">
                                <div className="provider-item-info">
                                    <span className={`provider-dot ${p.enabled ? 'enabled' : 'disabled'}`} />
                                    <div>
                                        <div className="provider-item-name">{p.name}</div>
                                        <div className="provider-item-type">
                                            {p.auth_type} · {(() => { try { return p.endpoint ? new URL(p.endpoint).host : 'no endpoint'; } catch { return p.endpoint ?? 'no endpoint'; } })()}
                                        </div>
                                    </div>
                                </div>
                                <div className="provider-item-actions">
                                    <button
                                        className="provider-action-btn"
                                        title="Toggle enabled"
                                        onClick={() => handleToggle(p.name, !!p.enabled)}
                                    >
                                        {p.enabled ? 'On' : 'Off'}
                                    </button>
                                    <button
                                        className="provider-action-btn"
                                        title="Test connection"
                                        onClick={() => handleTest(p.name)}
                                    >
                                        Test
                                    </button>
                                    <button
                                        className="provider-action-btn"
                                        title="Refresh models"
                                        onClick={() => handleDiscover(p.name)}
                                    >
                                        Sync
                                    </button>
                                    <button
                                        className="provider-action-btn"
                                        title="Delete"
                                        onClick={() => handleDelete(p.name)}
                                    >
                                        Del
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

// ══════════════════════════════════════════════════════════════════════════
// ModelsSection
// ══════════════════════════════════════════════════════════════════════════

function ModelsSection() {
    const [models, setModels] = useState<ModelEntry[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [status, setStatus] = useState<{ type: string; msg: string } | null>(null);
    const [saving, setSaving] = useState(false);

    const loadModels = useCallback(async () => {
        try {
            const data = await api('/models');
            const ms = (data.models ?? []) as ModelEntry[];
            setModels(ms);
            setSelectedIds(new Set(ms.filter(m => m.available === 1).map(m => m.id)));
        } catch { setStatus({ type: 'error', msg: 'Failed to load models' }); }
    }, []);

    useEffect(() => { loadModels(); }, [loadModels]);

    const toggleModel = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleSave = async () => {
        setSaving(true);
        setStatus(null);
        try {
            const result = await api('/models/save-selection', 'POST', {
                selectedIds: [...selectedIds],
            });
            setStatus({
                type: 'success',
                msg: `✓ ${result.selectedCount} models enabled, ${result.routingEntries} routing entries generated`,
            });
        } catch {
            setStatus({ type: 'error', msg: 'Failed to save model selection' });
        } finally { setSaving(false); }
    };

    // Group models by provider
    const grouped = models.reduce<Record<string, ModelEntry[]>>((acc, m) => {
        (acc[m.provider] ??= []).push(m);
        return acc;
    }, {});

    return (
        <>
            {status && (
                <div className={`settings-status ${status.type}`}>{status.msg}</div>
            )}

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Available Models</div>
                        <div className="settings-card-subtitle">
                            Select models for the routing matrix — {selectedIds.size} of {models.length} selected
                        </div>
                    </div>
                    <button
                        className="settings-btn settings-btn-primary"
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? 'Saving...' : `Save Selection (${selectedIds.size})`}
                    </button>
                </div>

                {models.length === 0 ? (
                    <div className="settings-empty">
                        No models discovered. Add a provider first, then models will appear here.
                    </div>
                ) : (
                    Object.entries(grouped).map(([provider, models]) => (
                        <div key={provider} style={{ marginBottom: '1rem' }}>
                            <div className="settings-label" style={{ marginBottom: '0.5rem' }}>
                                {provider.toUpperCase()} ({models.length})
                            </div>
                            <div className="models-grid">
                                {models.map(m => (
                                    <div
                                        key={m.id}
                                        className={`model-card ${selectedIds.has(m.id) ? 'selected' : ''}`}
                                        onClick={() => toggleModel(m.id)}
                                    >
                                        <input
                                            type="checkbox"
                                            className="model-checkbox"
                                            checked={selectedIds.has(m.id)}
                                            onChange={() => toggleModel(m.id)}
                                        />
                                        <div>
                                            <div className="model-name">{m.name}</div>
                                            <div className="model-meta">
                                                <span className={`model-tier-badge ${m.classification.tier}`}>
                                                    {m.classification.label}
                                                </span>
                                                {m.classification.isZeroCost && (
                                                    <span className="model-zero-cost">FREE</span>
                                                )}
                                                <span className="model-provider">{m.provider}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </>
    );
}

// ══════════════════════════════════════════════════════════════════════════
// RoutingSection
// ══════════════════════════════════════════════════════════════════════════

function RoutingSection() {
    const [entries, setEntries] = useState<RoutingEntry[]>([]);
    const [dimensions, setDimensions] = useState<{ tiers: string[]; taskTypes: string[] }>({
        tiers: [], taskTypes: [],
    });
    const [status, setStatus] = useState<{ type: string; msg: string } | null>(null);

    const loadRouting = useCallback(async () => {
        try {
            const data = await api('/routing');
            setEntries(data.entries ?? []);
            setDimensions(data.dimensions ?? { tiers: [], taskTypes: [] });
        } catch { setStatus({ type: 'error', msg: 'Failed to load routing' }); }
    }, []);

    useEffect(() => { loadRouting(); }, [loadRouting]);

    const handleReset = async () => {
        setStatus({ type: 'info', msg: 'Regenerating routing...' });
        const result = await api('/routing/reset', 'POST');
        setStatus({ type: 'success', msg: `✓ Regenerated ${result.entries} routing entries` });
        loadRouting();
    };

    // Group entries by tier × taskType
    const matrix: Record<string, Record<string, RoutingEntry[]>> = {};
    for (const tier of dimensions.tiers) {
        matrix[tier] = {};
        for (const task of dimensions.taskTypes) {
            matrix[tier][task] = entries
                .filter(e => e.tier === tier && e.task_type === task)
                .sort((a, b) => a.priority - b.priority);
        }
    }

    return (
        <>
            {status && (
                <div className={`settings-status ${status.type}`}>{status.msg}</div>
            )}

            <div className="settings-card">
                <div className="settings-card-header">
                    <div>
                        <div className="settings-card-title">Routing Matrix</div>
                        <div className="settings-card-subtitle">
                            Auto-generated model priority by tier × task type. Lower priority = preferred.
                        </div>
                    </div>
                    <button className="settings-btn settings-btn-secondary" onClick={handleReset}>
                        Regenerate
                    </button>
                </div>

                {entries.length === 0 ? (
                    <div className="settings-empty">
                        No routing entries. Select models first, then routing will be auto-generated.
                    </div>
                ) : (
                    <div className="routing-matrix">
                        <table className="routing-table">
                            <thead>
                                <tr>
                                    <th>Tier</th>
                                    {dimensions.taskTypes.map(t => <th key={t}>{t}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {dimensions.tiers.map(tier => (
                                    <tr key={tier}>
                                        <td style={{ fontWeight: 600 }}>{tier}</td>
                                        {dimensions.taskTypes.map(task => (
                                            <td key={task}>
                                                {(matrix[tier]?.[task] ?? []).slice(0, 3).map(e => (
                                                    <span key={e.model_id}>
                                                        <span className="routing-model-chip">
                                                            {e.model_id.split(':').pop()}
                                                        </span>
                                                        <span className="routing-priority">#{e.priority}</span>
                                                        {e.is_custom ? <span className="routing-custom-badge">✏️</span> : null}
                                                    </span>
                                                ))}
                                                {(matrix[tier]?.[task]?.length ?? 0) > 3 && (
                                                    <span className="routing-priority">
                                                        +{(matrix[tier]?.[task]?.length ?? 0) - 3} more
                                                    </span>
                                                )}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </>
    );
}

// ══════════════════════════════════════════════════════════════════════════
// GuideSection — CLIProxyAPI Tutorial
// ══════════════════════════════════════════════════════════════════════════

function GuideSection() {
    return (
        <div className="settings-card">
            <div className="settings-card-title" style={{ marginBottom: '1rem' }}>
                CLIProxyAPI 快速接入指南
            </div>

            <div className="guide-section">
                <h3>什么是 CLIProxyAPI？</h3>
                <p>
                    CLIProxyAPI 是一个统一的 AI 资源池网关，可以将你已有的包月订阅（如 Claude Pro、Cursor Pro）、
                    OAuth 资源池、免费额度等转化为标准的 OpenAI 兼容 API，让你的数字生命优先使用<strong>零边际成本</strong>资源。
                </p>

                <h3>接入步骤</h3>

                <div className="guide-step">
                    <div className="guide-step-number">1</div>
                    <div className="guide-step-content">
                        <div className="guide-step-title">安装 CLIProxyAPI</div>
                        <div className="guide-step-desc">
                            克隆并部署 CLIProxyAPI 服务：
                        </div>
                        <code className="guide-code">{`git clone https://github.com/anthropics/anthropic-cookbook
cd CLIProxyAPI
pip install -r requirements.txt
python main.py --port 5600`}</code>
                    </div>
                </div>

                <div className="guide-step">
                    <div className="guide-step-number">2</div>
                    <div className="guide-step-content">
                        <div className="guide-step-title">配置订阅账号</div>
                        <div className="guide-step-desc">
                            在 CLIProxyAPI 的配置文件中添加你的订阅账号（Claude Pro、ChatGPT Plus 等），让它管理你的资源池。
                        </div>
                        <code className="guide-code">{`# config.yaml
accounts:
  - type: claude_pro
    email: your@email.com
    session_key: sk-ant-...
  - type: cursor_pro
    token: cur_...`}</code>
                    </div>
                </div>

                <div className="guide-step">
                    <div className="guide-step-number">3</div>
                    <div className="guide-step-content">
                        <div className="guide-step-title">在 ConShell 中添加 Provider</div>
                        <div className="guide-step-desc">
                            回到上方的 <strong>Providers</strong> 标签页，点击 "+ Add Provider"：
                        </div>
                        <code className="guide-code">{`Name:     cliproxyapi
Type:     Proxy (CLIProxyAPI)
Endpoint: http://localhost:5600
API Key:  (如果已设定密钥则填写)`}</code>
                    </div>
                </div>

                <div className="guide-step">
                    <div className="guide-step-number">4</div>
                    <div className="guide-step-content">
                        <div className="guide-step-title">选择模型</div>
                        <div className="guide-step-desc">
                            保存后系统会自动发现可用模型。切换到 <strong>Models</strong> 标签页，
                            勾选你想启用的模型，点击 "Save Selection"。
                        </div>
                    </div>
                </div>

                <div className="guide-step">
                    <div className="guide-step-number">5</div>
                    <div className="guide-step-content">
                        <div className="guide-step-title">查看路由</div>
                        <div className="guide-step-desc">
                            系统会根据模型能力和成本自动生成路由矩阵。
                            切换到 <strong>Routing</strong> 标签页查看或手动调整。
                            零成本模型（订阅/本地）将被优先使用。
                        </div>
                    </div>
                </div>

                <h3>工作原理</h3>
                <p>
                    ConShell 的智能路由系统会根据以下规则自动分配模型：
                </p>
                <div className="guide-step">
                    <div className="guide-step-number">→</div>
                    <div className="guide-step-content">
                        <div className="guide-step-title">路由优先级</div>
                        <div className="guide-step-desc">
                            1. 零成本模型（订阅/本地）永远优先<br />
                            2. 难度高的任务（推理/编码）→ 旗舰模型<br />
                            3. 简单任务（对话）→ 快速/低成本模型<br />
                            4. 同级别中按成本排序（便宜优先）<br />
                            5. 本地模型作为最终 fallback
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
