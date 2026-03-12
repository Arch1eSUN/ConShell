/**
 * CLI Skill Manager — CLI commands for skill search, install, audit, and listing.
 *
 * Integrates with:
 * - @conshell/skills (local loader + registry)
 * - @conshell/openclaw-bridge (remote ClawHub access)
 */

// SkillRegistry interface is inlined to avoid hard dependency on @conshell/skills
interface SkillRegistryLike {
    getAll(): readonly { manifest: { name: string; description: string; capabilities: readonly string[]; tools: readonly { name: string }[]; triggers: readonly { heartbeat?: string }[]; skillMdPath: string }; enabled: boolean }[];
    setEnabled(name: string, enabled: boolean): boolean;
}

// ── Types ──────────────────────────────────────────────────────────────

export interface SkillManagerDeps {
    /** Local skill registry. */
    readonly registry: SkillRegistryLike;
    /** Remote skill source (from openclaw-bridge). Optional — if not provided, remote commands fail gracefully. */
    readonly remoteSource?: {
        search(query: string, opts?: { limit?: number }): Promise<Array<{
            name: string;
            description: string;
            author: string;
            version: string;
            downloads: number;
        }>>;
        install(name: string): Promise<{
            skill: { manifest: { name: string; version?: string } };
            audit: { riskScore: number; recommendation: string; issues: Array<{ severity: string; description: string }> };
        }>;
        auditRemote(name: string): Promise<{
            riskScore: number;
            recommendation: string;
            issues: Array<{ severity: string; category: string; description: string }>;
        }>;
    };
    /** Logger. */
    readonly logger?: {
        info: (message: string, data?: Record<string, unknown>) => void;
        warn: (message: string, data?: Record<string, unknown>) => void;
        error: (message: string, data?: Record<string, unknown>) => void;
    };
}

export interface SkillListResult {
    readonly name: string;
    readonly description: string;
    readonly enabled: boolean;
    readonly source: 'local' | 'remote' | 'cached';
    readonly capabilities: readonly string[];
    readonly toolCount: number;
    readonly triggerCount: number;
}

export interface SkillSearchResult {
    readonly name: string;
    readonly description: string;
    readonly author: string;
    readonly version: string;
    readonly downloads: number;
}

export interface SkillAuditResult {
    readonly name: string;
    readonly riskScore: number;
    readonly recommendation: string;
    readonly issues: ReadonlyArray<{
        readonly severity: string;
        readonly category: string;
        readonly description: string;
    }>;
}

export interface SkillInstallResult {
    readonly name: string;
    readonly riskScore: number;
    readonly recommendation: string;
    readonly installed: boolean;
    readonly message: string;
}

// ── Skill Manager ──────────────────────────────────────────────────────

export class SkillManager {
    private readonly deps: SkillManagerDeps;

    constructor(deps: SkillManagerDeps) {
        this.deps = deps;
    }

    /**
     * List all installed skills with optional remote filter.
     */
    async list(_opts?: { remote?: boolean }): Promise<SkillListResult[]> {
        const results: SkillListResult[] = [];

        // Always include local skills
        for (const skill of this.deps.registry.getAll()) {
            results.push({
                name: skill.manifest.name,
                description: skill.manifest.description,
                enabled: skill.enabled,
                source: skill.manifest.skillMdPath.includes('.cache') ? 'cached' : 'local',
                capabilities: skill.manifest.capabilities,
                toolCount: skill.manifest.tools.length,
                triggerCount: skill.manifest.triggers.length,
            });
        }

        return results;
    }

    /**
     * Search ClawHub for remote skills.
     */
    async search(query: string, limit = 20): Promise<SkillSearchResult[]> {
        if (!this.deps.remoteSource) {
            throw new Error('Remote skill source not configured. Install @conshell/openclaw-bridge to enable ClawHub access.');
        }

        const results = await this.deps.remoteSource.search(query, { limit });
        return results.map(r => ({
            name: r.name,
            description: r.description,
            author: r.author,
            version: r.version,
            downloads: r.downloads,
        }));
    }

    /**
     * Install a skill from ClawHub.
     */
    async install(name: string): Promise<SkillInstallResult> {
        if (!this.deps.remoteSource) {
            throw new Error('Remote skill source not configured. Install @conshell/openclaw-bridge to enable ClawHub access.');
        }

        try {
            const result = await this.deps.remoteSource.install(name);

            return {
                name,
                riskScore: result.audit.riskScore,
                recommendation: result.audit.recommendation,
                installed: true,
                message: `Skill "${name}" installed successfully (risk: ${result.audit.riskScore}/100).`,
            };
        } catch (err) {
            return {
                name,
                riskScore: -1,
                recommendation: 'blocked',
                installed: false,
                message: err instanceof Error ? err.message : String(err),
            };
        }
    }

    /**
     * Run a security audit on a remote skill.
     */
    async audit(name: string): Promise<SkillAuditResult> {
        if (!this.deps.remoteSource) {
            throw new Error('Remote skill source not configured. Install @conshell/openclaw-bridge to enable ClawHub access.');
        }

        const result = await this.deps.remoteSource.auditRemote(name);
        return {
            name,
            riskScore: result.riskScore,
            recommendation: result.recommendation,
            issues: result.issues,
        };
    }

    /**
     * Enable or disable a local skill.
     */
    toggle(name: string, enabled: boolean): boolean {
        return this.deps.registry.setEnabled(name, enabled);
    }

    /**
     * Format skill list for CLI output.
     */
    static formatList(skills: readonly SkillListResult[]): string {
        if (skills.length === 0) return 'No skills installed.';

        const lines: string[] = ['', '┌─ Installed Skills ────────────────────────────────────────┐', '│'];
        for (const s of skills) {
            const status = s.enabled ? '✅' : '❌';
            const source = s.source === 'cached' ? ' (remote)' : '';
            lines.push(`│  ${status} ${s.name}${source}`);
            lines.push(`│     ${s.description}`);
            lines.push(`│     Tools: ${s.toolCount}  Triggers: ${s.triggerCount}  Caps: [${s.capabilities.join(', ')}]`);
            lines.push('│');
        }
        lines.push('└───────────────────────────────────────────────────────────┘');
        return lines.join('\n');
    }

    /**
     * Format search results for CLI output.
     */
    static formatSearch(results: readonly SkillSearchResult[]): string {
        if (results.length === 0) return 'No results found.';

        const lines: string[] = ['', '┌─ ClawHub Search Results ──────────────────────────────────┐', '│'];
        for (const r of results) {
            lines.push(`│  📦 ${r.name} v${r.version} by ${r.author}`);
            lines.push(`│     ${r.description}`);
            lines.push(`│     ⬇️ ${r.downloads} downloads`);
            lines.push('│');
        }
        lines.push('└───────────────────────────────────────────────────────────┘');
        return lines.join('\n');
    }

    /**
     * Format audit result for CLI output.
     */
    static formatAudit(result: SkillAuditResult): string {
        const riskEmoji = result.riskScore <= 30 ? '🟢' : result.riskScore <= 60 ? '🟡' : '🔴';
        const lines: string[] = [
            '',
            `┌─ Security Audit: ${result.name} ${'─'.repeat(Math.max(1, 40 - result.name.length))}┐`,
            '│',
            `│  ${riskEmoji} Risk Score: ${result.riskScore}/100`,
            `│  📋 Recommendation: ${result.recommendation}`,
            '│',
        ];

        if (result.issues.length > 0) {
            lines.push('│  Issues:');
            for (const issue of result.issues) {
                const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️';
                lines.push(`│    ${icon} [${issue.category}] ${issue.description}`);
            }
            lines.push('│');
        }

        lines.push('└───────────────────────────────────────────────────────────┘');
        return lines.join('\n');
    }
}
