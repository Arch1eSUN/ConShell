/**
 * SelfModEngine — Git-backed self-modification subsystem.
 *
 * Spec §7: Every modification follows a strict audit workflow:
 *   1. Policy check (delegated to caller)
 *   2. Read current state → before_hash
 *   3. Apply the change
 *   4. Compute after_hash
 *   5. Git add + commit (with structured message)
 *   6. Insert audit record into modifications table
 *   7. Return result to caller
 *
 * Rollback is a revert of the original git commit, recorded as a new modification.
 *
 * Protected files are never writable by the agent.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModificationType, SHA256Hash } from '@web4-agent/core';
import type { ModificationsRepository, ModificationRow } from '@web4-agent/state';
import type { Logger } from '@web4-agent/core';

const execFileAsync = promisify(execFile);

// ── Config ──────────────────────────────────────────────────────────────

export interface SelfModConfig {
    /** Agent's working directory (git root). */
    readonly workDir: string;

    /** Max self-modifications per hour (default 10, per ADR-005). */
    readonly maxPerHour?: number;

    /** Max package installs per hour (default 5). */
    readonly maxInstallsPerHour?: number;

    /** Additional protected file patterns (beyond defaults). */
    readonly extraProtectedPatterns?: readonly string[];
}

// ── Default protected files (spec §7) ───────────────────────────────────

const DEFAULT_PROTECTED_BASENAMES: ReadonlySet<string> = new Set([
    'constitution.md',
    'wallet.json',
    'state.db',
    'automaton.json',
    'api-key',
    'schema.ts',
]);

const DEFAULT_PROTECTED_PATTERNS: readonly string[] = [
    '.git/',
    'conways-rules.txt',
];

// ── Result types ────────────────────────────────────────────────────────

export interface SelfModResult {
    readonly success: boolean;
    readonly modificationId?: number;
    readonly gitCommit?: string;
    readonly error?: string;
}

export interface FileEditRequest {
    readonly filePath: string;
    readonly newContent: string;
}

export interface RollbackResult {
    readonly success: boolean;
    readonly revertModId?: number;
    readonly error?: string;
}

// ── SelfModEngine ───────────────────────────────────────────────────────

export class SelfModEngine {
    private readonly workDir: string;
    private readonly maxPerHour: number;
    private readonly maxInstallsPerHour: number;
    private readonly protectedBasenames: ReadonlySet<string>;
    private readonly protectedPatterns: readonly string[];

    constructor(
        private readonly repo: ModificationsRepository,
        private readonly logger: Logger,
        config: SelfModConfig,
    ) {
        this.workDir = config.workDir;
        this.maxPerHour = config.maxPerHour ?? 10;
        this.maxInstallsPerHour = config.maxInstallsPerHour ?? 5;

        // Merge default + extra protected patterns
        this.protectedBasenames = DEFAULT_PROTECTED_BASENAMES;
        this.protectedPatterns = [
            ...DEFAULT_PROTECTED_PATTERNS,
            ...(config.extraProtectedPatterns ?? []),
        ];
    }

    // ── Public API ────────────────────────────────────────────────────

    /**
     * Edit a file in the agent's working directory.
     * Returns error if file is protected or rate-limited.
     */
    async editFile(req: FileEditRequest): Promise<SelfModResult> {
        const resolved = path.resolve(this.workDir, req.filePath);

        // 1. Protected-file check
        const protErr = this.checkProtected(resolved);
        if (protErr) return { success: false, error: protErr };

        // 2. Rate-limit check
        const rateErr = this.checkRateLimit();
        if (rateErr) return { success: false, error: rateErr };

        // 3. Before state
        let beforeHash: SHA256Hash | undefined;
        try {
            const existing = await fs.readFile(resolved, 'utf-8');
            beforeHash = sha256(existing);
        } catch {
            // New file — no before_hash
        }

        // 4. Apply the edit
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, req.newContent, 'utf-8');
        const afterHash = sha256(req.newContent);

        // 5. Git commit
        const relPath = path.relative(this.workDir, resolved);
        const gitCommit = await this.gitCommit(
            [relPath],
            `self-mod: file_edit ${relPath} [${shortHash(beforeHash)}→${shortHash(afterHash)}]`,
        );

        // 6. Audit record
        const diff = this.computeDiffSummary(beforeHash, afterHash, relPath);
        const modId = this.repo.insert({
            type: 'file_edit',
            target: relPath,
            diff,
            beforeHash,
            afterHash,
            gitCommit,
        });

        this.logger.info(`self-mod: file_edit ${relPath} → mod#${modId}`);
        return { success: true, modificationId: modId, gitCommit };
    }

    /**
     * Install an npm package.
     */
    async installPackage(packageName: string): Promise<SelfModResult> {
        // Validate package name
        if (!/^[a-z0-9@][a-z0-9._/-]*$/.test(packageName)) {
            return { success: false, error: `Invalid package name: ${packageName}` };
        }

        // Rate-limit for installs
        const rateErr = this.checkInstallRateLimit();
        if (rateErr) return { success: false, error: rateErr };

        try {
            // Run npm install
            await execFileAsync('npm', ['install', packageName], {
                cwd: this.workDir,
                timeout: 120_000,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, error: `npm install failed: ${msg}` };
        }

        // Git commit
        const gitCommit = await this.gitCommit(
            ['package.json', 'package-lock.json'],
            `self-mod: package_install ${packageName}`,
        );

        const modId = this.repo.insert({
            type: 'package_install',
            target: packageName,
            diff: `Installed ${packageName}`,
            gitCommit,
        });

        this.logger.info(`self-mod: package_install ${packageName} → mod#${modId}`);
        return { success: true, modificationId: modId, gitCommit };
    }

    /**
     * Create a skill file.
     */
    async createSkill(skillName: string, content: string): Promise<SelfModResult> {
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(skillName)) {
            return { success: false, error: `Invalid skill name: ${skillName}` };
        }

        const rateErr = this.checkRateLimit();
        if (rateErr) return { success: false, error: rateErr };

        const skillDir = path.join(this.workDir, 'skills');
        const skillFile = path.join(skillDir, `${skillName}.md`);

        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(skillFile, content, 'utf-8');
        const afterHash = sha256(content);

        const relPath = path.relative(this.workDir, skillFile);
        const gitCommit = await this.gitCommit(
            [relPath],
            `self-mod: skill_create ${skillName} [→${shortHash(afterHash)}]`,
        );

        const modId = this.repo.insert({
            type: 'skill_create',
            target: skillName,
            diff: `Created skill: ${skillName}`,
            afterHash,
            gitCommit,
        });

        this.logger.info(`self-mod: skill_create ${skillName} → mod#${modId}`);
        return { success: true, modificationId: modId, gitCommit };
    }

    /**
     * Rollback a previous modification by reverting its git commit.
     */
    async rollback(modificationId: number): Promise<RollbackResult> {
        const mods = this.repo.findRecent(1000);
        const target = mods.find((m: ModificationRow) => m.id === modificationId);

        if (!target) {
            return { success: false, error: `Modification #${modificationId} not found` };
        }

        if (!target.git_commit) {
            return { success: false, error: `Modification #${modificationId} has no git commit to revert` };
        }

        if (target.type === 'rollback') {
            return { success: false, error: 'Cannot rollback a rollback' };
        }

        try {
            await execFileAsync('git', ['revert', '--no-edit', target.git_commit], {
                cwd: this.workDir,
                timeout: 30_000,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Abort the failed revert to clean up
            try {
                await execFileAsync('git', ['revert', '--abort'], { cwd: this.workDir });
            } catch {
                // Best-effort abort
            }
            return { success: false, error: `git revert failed (conflict?): ${msg}` };
        }

        // Get the revert commit hash
        const { stdout: revertHash } = await execFileAsync(
            'git', ['rev-parse', 'HEAD'],
            { cwd: this.workDir },
        );

        const revertModId = this.repo.insert({
            type: 'rollback',
            target: `revert-of-mod#${modificationId}`,
            diff: `Reverted modification #${modificationId} (${target.type}: ${target.target})`,
            gitCommit: revertHash.trim(),
        });

        this.logger.info(`self-mod: rollback mod#${modificationId} → revert-mod#${revertModId}`);
        return { success: true, revertModId };
    }

    /**
     * Query modification history.
     */
    getHistory(limit = 20): readonly ModificationRow[] {
        return this.repo.findRecent(limit);
    }

    /**
     * Query modifications by type.
     */
    getHistoryByType(type: ModificationType, limit = 50): readonly ModificationRow[] {
        return this.repo.findByType(type, limit);
    }

    /**
     * Check if a file path is protected.
     */
    isProtected(filePath: string): boolean {
        return this.checkProtected(path.resolve(this.workDir, filePath)) !== undefined;
    }

    // ── Internal helpers ──────────────────────────────────────────────

    private checkProtected(resolved: string): string | undefined {
        const basename = path.basename(resolved);
        if (this.protectedBasenames.has(basename)) {
            return `Protected file: ${basename} cannot be modified by the agent`;
        }
        const rel = path.relative(this.workDir, resolved);
        for (const pattern of this.protectedPatterns) {
            if (rel.includes(pattern)) {
                return `Protected path pattern: ${pattern} — ${rel} cannot be modified`;
            }
        }
        // Verify the file is within the working directory
        if (!resolved.startsWith(this.workDir)) {
            return `Path escapes working directory: ${resolved}`;
        }
        return undefined;
    }

    private checkRateLimit(): string | undefined {
        const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
        const count = this.repo.countSince(oneHourAgo);
        if (count >= this.maxPerHour) {
            return `Rate limit exceeded: ${count}/${this.maxPerHour} modifications this hour`;
        }
        return undefined;
    }

    private checkInstallRateLimit(): string | undefined {
        const general = this.checkRateLimit();
        if (general) return general;

        const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
        const installs = [
            ...this.repo.findByType('package_install', 1000),
            ...this.repo.findByType('mcp_install', 1000),
        ].filter(m => m.created_at >= oneHourAgo).length;

        if (installs >= this.maxInstallsPerHour) {
            return `Install rate limit exceeded: ${installs}/${this.maxInstallsPerHour} installs this hour`;
        }
        return undefined;
    }

    private async gitCommit(files: string[], message: string): Promise<string | undefined> {
        try {
            // Stage files
            for (const f of files) {
                try {
                    await execFileAsync('git', ['add', f], { cwd: this.workDir });
                } catch {
                    // File might not exist (e.g., package-lock.json)
                }
            }

            // Commit
            await execFileAsync(
                'git',
                ['commit', '-m', message, '--allow-empty'],
                { cwd: this.workDir },
            );

            // Get commit hash
            const { stdout } = await execFileAsync(
                'git', ['rev-parse', 'HEAD'],
                { cwd: this.workDir },
            );
            return stdout.trim();
        } catch (err) {
            this.logger.warn(`git commit failed: ${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        }
    }

    private computeDiffSummary(
        beforeHash: SHA256Hash | undefined,
        afterHash: SHA256Hash,
        relPath: string,
    ): string {
        if (!beforeHash) {
            return `Created new file: ${relPath}`;
        }
        return `Modified ${relPath}: ${shortHash(beforeHash)} → ${shortHash(afterHash)}`;
    }
}

// ── Utility functions ──────────────────────────────────────────────────

export function sha256(content: string): SHA256Hash {
    return createHash('sha256').update(content, 'utf-8').digest('hex') as SHA256Hash;
}

function shortHash(hash: SHA256Hash | undefined): string {
    return hash ? hash.slice(0, 8) : 'null';
}
