/**
 * RemoteSkillLoader — Loads skills from ClawHub registry via openclaw-bridge.
 *
 * Extends the existing local-only SkillLoader with remote skill fetching,
 * security auditing, and caching.
 */
import { writeFile, mkdir, readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LoadedSkill } from './types.js';
import { parseSkillMd } from './loader.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface RemoteSkillSource {
    /** Search the remote registry. */
    search(query: string, opts?: { limit?: number; category?: string }): Promise<RemoteSkillEntry[]>;
    /** Fetch full manifest content from the registry. */
    fetchManifest(name: string): Promise<{ content: string; sha256: string; version: string }>;
    /** Run security audit on manifest content. Returns risk score 0-100. */
    audit(content: string): Promise<{ riskScore: number; recommendation: string; issues: AuditIssue[] }>;
}

export interface RemoteSkillEntry {
    readonly name: string;
    readonly description: string;
    readonly author: string;
    readonly version: string;
    readonly downloads: number;
}

export interface AuditIssue {
    readonly severity: 'info' | 'warning' | 'critical';
    readonly category: string;
    readonly description: string;
}

export interface RemoteLoaderOptions {
    /** Directory to cache downloaded skills. */
    readonly cacheDir: string;
    /** Maximum acceptable risk score (0-100). Skills above this are blocked. */
    readonly maxRiskScore?: number;
    /** Logger for diagnostics. */
    readonly logger?: {
        info: (message: string, data?: Record<string, unknown>) => void;
        warn: (message: string, data?: Record<string, unknown>) => void;
    };
}

// ── Remote Loader ──────────────────────────────────────────────────────

export class RemoteSkillLoader {
    private readonly source: RemoteSkillSource;
    private readonly opts: RemoteLoaderOptions;
    private readonly maxRisk: number;

    constructor(source: RemoteSkillSource, opts: RemoteLoaderOptions) {
        this.source = source;
        this.opts = opts;
        this.maxRisk = opts.maxRiskScore ?? 60;
    }

    /**
     * Search ClawHub for skills.
     */
    async search(query: string, limit = 20): Promise<RemoteSkillEntry[]> {
        return this.source.search(query, { limit });
    }

    /**
     * Install a remote skill: fetch, audit, cache, and return as LoadedSkill.
     */
    async install(name: string): Promise<{ skill: LoadedSkill; audit: { riskScore: number; recommendation: string; issues: AuditIssue[] } }> {
        this.opts.logger?.info(`Fetching remote skill: ${name}`);

        // 1. Fetch manifest
        const { content, sha256, version } = await this.source.fetchManifest(name);

        // 2. Security audit
        const auditResult = await this.source.audit(content);
        this.opts.logger?.info(`Audit result for ${name}`, {
            riskScore: auditResult.riskScore,
            recommendation: auditResult.recommendation,
            issues: auditResult.issues.length,
        });

        if (auditResult.riskScore > this.maxRisk) {
            throw new Error(
                `Skill "${name}" blocked: risk score ${auditResult.riskScore} exceeds maximum ${this.maxRisk}. ` +
                `Issues: ${auditResult.issues.map(i => i.description).join('; ')}`
            );
        }

        // 3. Cache to local filesystem
        const skillDir = join(this.opts.cacheDir, name);
        await mkdir(skillDir, { recursive: true });

        const skillMdPath = join(skillDir, 'SKILL.md');
        await writeFile(skillMdPath, content, 'utf-8');

        // Write metadata
        await writeFile(join(skillDir, '.remote-meta.json'), JSON.stringify({
            name,
            version,
            sha256,
            installedAt: new Date().toISOString(),
            riskScore: auditResult.riskScore,
            recommendation: auditResult.recommendation,
            source: 'clawhub',
        }, null, 2), 'utf-8');

        // 4. Parse manifest
        const manifest = parseSkillMd(content, skillMdPath);

        const loadedSkill: LoadedSkill = {
            manifest: { ...manifest, skillMdPath },
            enabled: true,
        };

        this.opts.logger?.info(`Installed remote skill: ${name}@${version}`, { riskScore: auditResult.riskScore });

        return { skill: loadedSkill, audit: auditResult };
    }

    /**
     * Load all cached remote skills from the cache directory.
     */
    async loadCached(): Promise<LoadedSkill[]> {
        const skills: LoadedSkill[] = [];

        try {
            const entries = await readdir(this.opts.cacheDir);
            for (const entry of entries) {
                const skillMdPath = join(this.opts.cacheDir, entry, 'SKILL.md');
                try {
                    await access(skillMdPath);
                    const content = await readFile(skillMdPath, 'utf-8');
                    const manifest = parseSkillMd(content, skillMdPath);
                    skills.push({ manifest: { ...manifest, skillMdPath }, enabled: true });
                } catch {
                    // Skip invalid entries
                }
            }
        } catch {
            // Cache dir doesn't exist yet
        }

        return skills;
    }

    /**
     * Audit a skill by name without installing it.
     */
    async auditRemote(name: string): Promise<{ riskScore: number; recommendation: string; issues: AuditIssue[] }> {
        const { content } = await this.source.fetchManifest(name);
        return this.source.audit(content);
    }
}
