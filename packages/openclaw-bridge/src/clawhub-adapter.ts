/**
 * ClawHubAdapter — Bridges ConShell's skill system with the ClawHub registry.
 *
 * Provides:
 * - Skill search against clawhub.com API
 * - Skill download and installation to local SkillLoader path
 * - Security audit pipeline for remote skills
 * - Manifest format conversion (ClawHub → ConShell SkillManifest)
 */
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
    ClawHubAdapter as IClawHubAdapter,
    ClawHubSearchOptions,
    ClawHubSearchResult,
    RemoteSkillManifest,
    InstalledSkillInfo,
    SkillAuditReport,
    SkillAuditIssue,
} from './types.js';

/** Default ClawHub registry base URL. */
const CLAWHUB_BASE_URL = 'https://clawhub.com/api/v1';

/** Dangerous patterns that trigger audit warnings. */
const DANGEROUS_PATTERNS: readonly { pattern: RegExp; category: string; severity: 'warning' | 'critical'; description: string }[] = [
    { pattern: /\brm\s+-rf\b/i, category: 'destructive_command', severity: 'critical', description: 'Recursive deletion command detected' },
    { pattern: /\bcurl\b.*\|\s*\bbash\b/i, category: 'code_injection', severity: 'critical', description: 'Piped curl-to-bash detected' },
    { pattern: /\beval\b/i, category: 'code_injection', severity: 'warning', description: 'eval() usage detected' },
    { pattern: /\bprivate[_\s]?key\b/i, category: 'credential_access', severity: 'critical', description: 'Private key access pattern detected' },
    { pattern: /\bpassword\b/i, category: 'credential_access', severity: 'warning', description: 'Password reference detected' },
    { pattern: /\bsudo\b/i, category: 'privilege_escalation', severity: 'warning', description: 'sudo usage detected' },
    { pattern: /\bchmod\s+777\b/i, category: 'insecure_permissions', severity: 'warning', description: 'World-writable permissions detected' },
    { pattern: /\bwallet\b.*\bjson\b/i, category: 'financial_risk', severity: 'critical', description: 'Wallet file access pattern detected' },
];

export class ClawHubAdapterImpl implements IClawHubAdapter {
    private readonly baseUrl: string;
    private readonly authToken?: string;
    private readonly logger?: {
        info: (msg: string, data?: Record<string, unknown>) => void;
        warn: (msg: string, data?: Record<string, unknown>) => void;
    };

    constructor(options?: {
        baseUrl?: string;
        authToken?: string;
        logger?: ClawHubAdapterImpl['logger'];
    }) {
        this.baseUrl = options?.baseUrl ?? CLAWHUB_BASE_URL;
        this.authToken = options?.authToken;
        this.logger = options?.logger;
    }

    /** Build headers, including auth if configured. */
    private headers(): Record<string, string> {
        const h: Record<string, string> = { 'Accept': 'application/json' };
        if (this.authToken) h['Authorization'] = `Bearer ${this.authToken}`;
        return h;
    }

    async search(query: string, opts?: ClawHubSearchOptions): Promise<ClawHubSearchResult[]> {
        const params = new URLSearchParams({
            q: query,
            limit: String(opts?.limit ?? 20),
        });
        if (opts?.category) params.set('category', opts.category);
        if (opts?.sortBy) params.set('sort', opts.sortBy);

        try {
            const response = await fetch(`${this.baseUrl}/skills/search?${params}`, {
                headers: this.headers(),
            });
            if (!response.ok) {
                this.logger?.warn('ClawHub search failed', { status: response.status, query });
                return [];
            }

            const data = await response.json() as { results?: ClawHubSearchResult[] };
            return data.results ?? [];
        } catch (err) {
            this.logger?.warn('ClawHub search error', {
                error: err instanceof Error ? err.message : String(err),
                query,
            });
            return [];
        }
    }

    async install(skillName: string, targetDir: string): Promise<InstalledSkillInfo> {
        this.logger?.info('Installing skill from ClawHub', { skillName, targetDir });

        // Fetch manifest
        const manifest = await this.getManifest(skillName);

        // Security audit before installation
        const audit = await this.audit(manifest);
        if (audit.recommendation === 'blocked') {
            throw new Error(
                `Skill ${skillName} blocked by security audit: ${audit.issues
                    .filter(i => i.severity === 'critical')
                    .map(i => i.description)
                    .join('; ')}`,
            );
        }

        // Create skill directory
        const skillDir = join(targetDir, skillName);
        await mkdir(skillDir, { recursive: true });

        // Write SKILL.md
        await writeFile(join(skillDir, 'SKILL.md'), manifest.content, 'utf-8');

        const installedAt = new Date().toISOString();

        this.logger?.info('Skill installed', {
            skillName,
            version: manifest.version,
            riskScore: audit.riskScore,
            recommendation: audit.recommendation,
        });

        return {
            name: skillName,
            version: manifest.version,
            installedAt,
            path: skillDir,
            sha256: manifest.sha256,
        };
    }

    async getManifest(skillName: string): Promise<RemoteSkillManifest> {
        const response = await fetch(`${this.baseUrl}/skills/${encodeURIComponent(skillName)}`, {
            headers: this.headers(),
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch skill manifest: ${skillName} (HTTP ${response.status})`);
        }

        const data = await response.json() as RemoteSkillManifest;

        // Verify SHA-256 if provided
        if (data.sha256 && data.content) {
            const computed = createHash('sha256').update(data.content).digest('hex');
            if (computed !== data.sha256) {
                throw new Error(
                    `SHA-256 mismatch for skill ${skillName}: expected ${data.sha256}, got ${computed}`,
                );
            }
        }

        return data;
    }

    async audit(manifest: RemoteSkillManifest): Promise<SkillAuditReport> {
        const issues: SkillAuditIssue[] = [];
        const content = manifest.content;
        const lines = content.split('\n');

        // Scan content for dangerous patterns
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            for (const dp of DANGEROUS_PATTERNS) {
                if (dp.pattern.test(line)) {
                    issues.push({
                        severity: dp.severity,
                        category: dp.category,
                        description: dp.description,
                        line: i + 1,
                    });
                }
            }
        }

        // Check for excessive capabilities
        if (manifest.capabilities.length > 5) {
            issues.push({
                severity: 'warning',
                category: 'over_permissioned',
                description: `Skill requests ${manifest.capabilities.length} capabilities (threshold: 5)`,
            });
        }

        // Calculate risk score (0-100)
        let riskScore = 0;
        for (const issue of issues) {
            riskScore += issue.severity === 'critical' ? 30 : 10;
        }
        riskScore = Math.min(riskScore, 100);

        // Determine recommendation
        let recommendation: SkillAuditReport['recommendation'];
        if (riskScore >= 60) {
            recommendation = 'blocked';
        } else if (riskScore >= 30) {
            recommendation = 'dangerous';
        } else if (riskScore > 0) {
            recommendation = 'caution';
        } else {
            recommendation = 'safe';
        }

        return {
            skillName: manifest.name,
            riskScore,
            issues,
            recommendation,
        };
    }
}
