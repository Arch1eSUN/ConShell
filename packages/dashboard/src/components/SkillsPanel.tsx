/**
 * SkillsPanel — Browse local skills + ClawHub remote registry.
 *
 * Two tabs:
 * 1. Local — installed SKILL.md files (existing)
 * 2. ClawHub — search & install from community registry (new)
 */
import React, { useState, useEffect, useCallback } from 'react';

interface LocalSkill {
  name: string;
  path: string;
  description: string;
}

interface RemoteSkill {
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  updatedAt: string;
  categories: string[];
}

interface AuditReport {
  skillName: string;
  riskScore: number;
  recommendation: 'safe' | 'caution' | 'dangerous' | 'blocked';
  issues: { severity: string; description: string }[];
}

type Tab = 'local' | 'clawhub';

export default function SkillsPanel() {
  const [tab, setTab] = useState<Tab>('local');
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkill[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [auditPreview, setAuditPreview] = useState<AuditReport | null>(null);
  const [error, setError] = useState('');

  // Load local skills on mount
  useEffect(() => {
    fetch('/api/skills')
      .then(r => r.ok ? r.json() : { skills: [] })
      .then(data => setLocalSkills(data.skills ?? []))
      .catch(() => setLocalSkills([]));
  }, []);

  // ClawHub search
  const searchClawHub = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError('');
    try {
      const resp = await fetch(`/api/skills/clawhub/search?q=${encodeURIComponent(searchQuery)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setRemoteSkills(data.results ?? []);
      if ((data.results ?? []).length === 0) {
        setError('No skills found for your query.');
      }
    } catch (err) {
      setError(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
      setRemoteSkills([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  // Install from ClawHub
  const installSkill = async (skillName: string) => {
    setInstalling(skillName);
    setAuditPreview(null);
    try {
      // First, get audit preview
      const auditResp = await fetch(`/api/skills/clawhub/audit?name=${encodeURIComponent(skillName)}`);
      if (auditResp.ok) {
        const audit = await auditResp.json() as AuditReport;
        if (audit.recommendation === 'blocked') {
          setAuditPreview(audit);
          setInstalling(null);
          return;
        }
        if (audit.recommendation !== 'safe') {
          setAuditPreview(audit);
          // Show preview — user must confirm
          return;
        }
      }

      // Install
      const resp = await fetch('/api/skills/clawhub/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName }),
      });
      if (!resp.ok) throw new Error(`Install failed (HTTP ${resp.status})`);

      // Refresh local list
      const refreshResp = await fetch('/api/skills');
      if (refreshResp.ok) {
        const data = await refreshResp.json();
        setLocalSkills(data.skills ?? []);
      }
      setTab('local');
    } catch (err) {
      setError(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstalling(null);
    }
  };

  const confirmInstall = async () => {
    if (auditPreview) {
      setAuditPreview(null);
      await installSkill(auditPreview.skillName);
    }
  };

  const RISK_COLORS: Record<string, string> = {
    safe: '#00b894',
    caution: '#fdcb6e',
    dangerous: '#e17055',
    blocked: '#d63031',
  };

  return (
    <div className="skills-panel">
      {/* Tab Bar */}
      <div className="skills-tabs">
        <button className={`tab-btn ${tab === 'local' ? 'active' : ''}`} onClick={() => setTab('local')}>
          📁 Local Skills ({localSkills.length})
        </button>
        <button className={`tab-btn ${tab === 'clawhub' ? 'active' : ''}`} onClick={() => setTab('clawhub')}>
          🌐 ClawHub
        </button>
      </div>

      {/* Local Tab */}
      {tab === 'local' && (
        <div className="skills-list">
          {localSkills.length === 0 ? (
            <p className="empty-state">No local skills installed. Browse ClawHub or add SKILL.md files to your skills directory.</p>
          ) : (
            localSkills.map(skill => (
              <div key={skill.name} className="skill-card">
                <div className="skill-header">
                  <strong>{skill.name}</strong>
                </div>
                <p className="skill-desc">{skill.description}</p>
                <small className="skill-path">{skill.path}</small>
              </div>
            ))
          )}
        </div>
      )}

      {/* ClawHub Tab */}
      {tab === 'clawhub' && (
        <div className="clawhub-section">
          <div className="search-bar">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchClawHub()}
              placeholder="Search ClawHub skills…"
            />
            <button className="btn-primary" onClick={searchClawHub} disabled={searching || !searchQuery.trim()}>
              {searching ? '⏳' : '🔍'} Search
            </button>
          </div>

          {error && <div className="error-msg">{error}</div>}

          <div className="skills-list">
            {remoteSkills.map(skill => (
              <div key={skill.name} className="skill-card remote">
                <div className="skill-header">
                  <strong>{skill.name}</strong>
                  <span className="skill-version">v{skill.version}</span>
                  <span className="skill-downloads">⬇️ {skill.downloads.toLocaleString()}</span>
                </div>
                <p className="skill-desc">{skill.description}</p>
                <div className="skill-footer">
                  <span className="skill-author">by {skill.author}</span>
                  {skill.categories.length > 0 && (
                    <div className="skill-tags">
                      {skill.categories.map(c => <span key={c} className="tag">{c}</span>)}
                    </div>
                  )}
                  <button
                    className="btn-install"
                    onClick={() => installSkill(skill.name)}
                    disabled={installing === skill.name}
                  >
                    {installing === skill.name ? 'Installing…' : '📦 Install'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Preview Modal */}
      {auditPreview && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAuditPreview(null)}>
          <div className="modal-card">
            <h3>⚠️ Security Audit</h3>
            <div className="audit-summary">
              <div className="audit-score">
                <span className="score-label">Risk Score</span>
                <span className="score-value" style={{ color: RISK_COLORS[auditPreview.recommendation] }}>
                  {auditPreview.riskScore}/100
                </span>
              </div>
              <span className="audit-badge" style={{
                background: `${RISK_COLORS[auditPreview.recommendation]}22`,
                color: RISK_COLORS[auditPreview.recommendation],
                border: `1px solid ${RISK_COLORS[auditPreview.recommendation]}44`,
              }}>
                {auditPreview.recommendation.toUpperCase()}
              </span>
            </div>

            {auditPreview.issues.length > 0 && (
              <div className="audit-issues">
                {auditPreview.issues.map((issue, i) => (
                  <div key={i} className={`audit-issue ${issue.severity}`}>
                    <span className="issue-severity">
                      {issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️'}
                    </span>
                    <span>{issue.description}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setAuditPreview(null)}>Cancel</button>
              {auditPreview.recommendation !== 'blocked' && (
                <button className="btn-primary" onClick={confirmInstall}>
                  Install Anyway
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
