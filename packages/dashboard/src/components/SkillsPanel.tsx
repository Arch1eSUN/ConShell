import { useState, useEffect } from 'react';
import './SkillsPanel.css';

interface SkillInfo {
    name: string;
    description: string;
    capabilities: string[];
    tools: { name: string; description: string }[];
    triggers: { heartbeat?: string; event?: string }[];
    enabled: boolean;
    handlerPath?: string;
}

const CAPABILITY_ICONS: Record<string, string> = {
    internet_access: '🌐',
    browser_control: '🖥️',
    shell_exec: '⚡',
    file_system: '📁',
    financial_ops: '💰',
    account_creation: '🔑',
    self_deploy: '🚀',
    self_modify: '🧬',
};

export function SkillsPanel() {
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/skills')
            .then(r => r.json())
            .then(data => {
                setSkills(data.skills || []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const toggleSkill = async (name: string, enabled: boolean) => {
        try {
            await fetch(`/api/skills/${name}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !enabled }),
            });
            setSkills(prev =>
                prev.map(s => s.name === name ? { ...s, enabled: !enabled } : s),
            );
        } catch (err) {
            console.error('Failed to toggle skill:', err);
        }
    };

    if (loading) return <div className="skills-loading">Loading skills...</div>;

    return (
        <div className="skills-panel">
            <div className="skills-header">
                <h2>🧩 Agent Skills</h2>
                <p className="skills-subtitle">
                    Installed skills extend your agent's capabilities.
                    Place skill folders in <code>~/.conshell/skills/</code>
                </p>
            </div>

            {skills.length === 0 ? (
                <div className="skills-empty">
                    <span className="skills-empty-icon">📦</span>
                    <h3>No Skills Installed</h3>
                    <p>Create a folder in <code>~/.conshell/skills/your-skill/</code> with a <code>SKILL.md</code> file.</p>
                    <pre className="skills-example">{`---
name: my-skill
description: What this skill does
capabilities: [internet_access]
tools:
  - name: my_tool
    description: Tool description
triggers:
  - heartbeat: "0 */6 * * *"
---

# My Skill Instructions
...`}</pre>
                </div>
            ) : (
                <div className="skills-grid">
                    {skills.map(skill => (
                        <div key={skill.name} className={`skill-card ${skill.enabled ? 'enabled' : 'disabled'}`}>
                            <div className="skill-card-header">
                                <div className="skill-info">
                                    <h3>{skill.name}</h3>
                                    <p className="skill-desc">{skill.description}</p>
                                </div>
                                <label className="skill-switch">
                                    <input
                                        type="checkbox"
                                        checked={skill.enabled}
                                        onChange={() => toggleSkill(skill.name, skill.enabled)}
                                    />
                                    <span className="skill-slider" />
                                </label>
                            </div>

                            <div className="skill-meta">
                                {skill.capabilities.length > 0 && (
                                    <div className="skill-caps">
                                        {skill.capabilities.map(cap => (
                                            <span key={cap} className="skill-cap-badge">
                                                {CAPABILITY_ICONS[cap] || '❓'} {cap.replace(/_/g, ' ')}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {skill.tools.length > 0 && (
                                    <div className="skill-tools-list">
                                        <span className="skill-meta-label">Tools:</span>
                                        {skill.tools.map(t => (
                                            <span key={t.name} className="skill-tool-badge">{t.name}</span>
                                        ))}
                                    </div>
                                )}

                                {skill.triggers.length > 0 && (
                                    <div className="skill-triggers">
                                        <span className="skill-meta-label">Triggers:</span>
                                        {skill.triggers.map((t, i) => (
                                            <span key={i} className="skill-trigger-badge">
                                                {t.heartbeat ? `⏰ ${t.heartbeat}` : `📡 ${t.event}`}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="skill-type">
                                    {skill.handlerPath
                                        ? <span className="skill-type-code">📝 Code + Docs</span>
                                        : <span className="skill-type-md">📄 Docs Only</span>
                                    }
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
