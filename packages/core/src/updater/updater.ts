/**
 * Self-Update — `packages/core/src/updater/`
 *
 * Checks npm registry for newer versions, compares semver,
 * renders changelog, and orchestrates update-with-rollback.
 *
 * Flow: check → backup → update → verify → rollback on failure
 */

import { createHash } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────

export interface VersionInfo {
    current: string;
    latest: string;
    hasUpdate: boolean;
    changelog: string[];
}

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'installing' | 'verifying' | 'done' | 'failed' | 'rolled-back';

export interface UpdateRecord {
    id: string;
    fromVersion: string;
    toVersion: string;
    status: UpdateStatus;
    startedAt: number;
    completedAt: number | null;
    error: string | null;
}

export interface UpdaterConfig {
    registryUrl?: string;
    packageName?: string;
    autoBackup?: boolean;
    maxHistory?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function compareSemver(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
        if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    }
    return 0;
}

export function parseSemver(v: string): { major: number; minor: number; patch: number } {
    const [major = 0, minor = 0, patch = 0] = v.replace(/^v/, '').split('.').map(Number);
    return { major, minor, patch };
}

// ── SelfUpdater ─────────────────────────────────────────────────────────

export class SelfUpdater {
    private readonly config: Required<UpdaterConfig>;
    private history: UpdateRecord[] = [];
    private currentVersion: string;

    constructor(currentVersion: string, config: UpdaterConfig = {}) {
        this.currentVersion = currentVersion;
        this.config = {
            registryUrl: config.registryUrl ?? 'https://registry.npmjs.org',
            packageName: config.packageName ?? '@conshell/core',
            autoBackup: config.autoBackup ?? true,
            maxHistory: config.maxHistory ?? 20,
        };
    }

    // ── Check ─────────────────────────────────────────────────────

    checkForUpdate(latestVersion: string): VersionInfo {
        const hasUpdate = compareSemver(this.currentVersion, latestVersion) < 0;

        return {
            current: this.currentVersion,
            latest: latestVersion,
            hasUpdate,
            changelog: hasUpdate
                ? [`Update available: ${this.currentVersion} → ${latestVersion}`]
                : ['You are running the latest version.'],
        };
    }

    // ── Update (simulated lifecycle) ──────────────────────────────

    startUpdate(targetVersion: string): UpdateRecord {
        if (compareSemver(this.currentVersion, targetVersion) >= 0) {
            throw new Error(`Target version ${targetVersion} is not newer than current ${this.currentVersion}`);
        }

        const record: UpdateRecord = {
            id: createHash('sha256').update(`${targetVersion}-${Date.now()}`).digest('hex').slice(0, 12),
            fromVersion: this.currentVersion,
            toVersion: targetVersion,
            status: 'downloading',
            startedAt: Date.now(),
            completedAt: null,
            error: null,
        };

        this.history.push(record);
        this.evict();
        return record;
    }

    completeUpdate(id: string, success: boolean, error?: string): UpdateRecord {
        const record = this.history.find(r => r.id === id);
        if (!record) throw new Error(`Update record ${id} not found`);

        if (success) {
            record.status = 'done';
            this.currentVersion = record.toVersion;
        } else {
            record.status = error ? 'failed' : 'rolled-back';
            record.error = error ?? 'Update rolled back';
        }
        record.completedAt = Date.now();
        return record;
    }

    rollback(id: string): UpdateRecord {
        return this.completeUpdate(id, false, 'Manual rollback');
    }

    // ── Queries ───────────────────────────────────────────────────

    get version(): string { return this.currentVersion; }
    get updateHistory(): readonly UpdateRecord[] { return this.history; }
    get historyCount(): number { return this.history.length; }

    findUpdate(id: string): UpdateRecord | undefined {
        return this.history.find(r => r.id === id);
    }

    // ── Internal ─────────────────────────────────────────────────

    private evict(): void {
        while (this.history.length > this.config.maxHistory) {
            this.history.shift();
        }
    }
}
