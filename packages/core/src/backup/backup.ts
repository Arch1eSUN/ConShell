/**
 * Backup/Restore — agent state backup with manifest and verification.
 *
 * Backup contents: state.db, SOUL.md, config, wallet (encrypted), skills
 * Format: manifest.json + file list with SHA-256 hashes
 * wallet.json gets double-encrypted with Vault master password
 */

import { createHash, randomBytes } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────

export type BackupStatus = 'pending' | 'in-progress' | 'complete' | 'failed' | 'verified';

export interface BackupManifest {
    readonly id: string;
    readonly version: string;
    readonly createdAt: string; // ISO 8601
    readonly agentName: string;
    readonly files: readonly BackupFileEntry[];
    readonly totalSizeBytes: number;
    readonly checksum: string; // SHA-256 of all file hashes concatenated
}

export interface BackupFileEntry {
    readonly path: string;
    readonly sizeBytes: number;
    readonly hash: string; // SHA-256
    readonly encrypted: boolean;
}

export interface BackupRecord {
    readonly id: string;
    readonly manifest: BackupManifest;
    status: BackupStatus;
    readonly createdAt: number;
    verifiedAt?: number;
    error?: string;
}

export interface RestoreResult {
    readonly success: boolean;
    readonly restoredFiles: number;
    readonly skippedFiles: number;
    readonly errors: string[];
}

export interface BackupManagerConfig {
    readonly maxBackups?: number;
    readonly backupVersion?: string;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_BM_CONFIG: Required<BackupManagerConfig> = {
    maxBackups: 50,
    backupVersion: '1.0.0',
};

// ── Manifest Helpers ───────────────────────────────────────────────────

/** Compute SHA-256 hash of content */
export function hashContent(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex');
}

/** Compute manifest checksum from file entries */
export function computeChecksum(files: readonly BackupFileEntry[]): string {
    const combined = files.map(f => f.hash).sort().join('');
    return hashContent(combined);
}

/** Create a backup manifest */
export function createManifest(
    agentName: string,
    files: readonly BackupFileEntry[],
    version: string = '1.0.0',
): BackupManifest {
    const totalSizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
    return {
        id: randomBytes(16).toString('hex'),
        version,
        createdAt: new Date().toISOString(),
        agentName,
        files,
        totalSizeBytes,
        checksum: computeChecksum(files),
    };
}

/** Verify manifest integrity */
export function verifyManifest(manifest: BackupManifest): boolean {
    const expectedChecksum = computeChecksum(manifest.files);
    return manifest.checksum === expectedChecksum;
}

// ── BackupManager ──────────────────────────────────────────────────────

export class BackupManager {
    private readonly config: Required<BackupManagerConfig>;
    private readonly backups = new Map<string, BackupRecord>();

    constructor(config?: BackupManagerConfig) {
        this.config = { ...DEFAULT_BM_CONFIG, ...config };
    }

    /** Create a new backup record from file entries */
    create(agentName: string, files: readonly BackupFileEntry[]): BackupRecord {
        // Limit
        if (this.backups.size >= this.config.maxBackups) {
            // Evict oldest
            const oldest = this.getOldest();
            if (oldest) this.backups.delete(oldest.id);
        }

        const manifest = createManifest(agentName, files, this.config.backupVersion);
        const record: BackupRecord = {
            id: manifest.id,
            manifest,
            status: 'complete',
            createdAt: Date.now(),
        };

        this.backups.set(record.id, record);
        return record;
    }

    /** Verify a backup's integrity */
    verify(backupId: string): boolean {
        const record = this.backups.get(backupId);
        if (!record) throw new Error(`Unknown backup: ${backupId}`);

        const valid = verifyManifest(record.manifest);
        record.status = valid ? 'verified' : 'failed';
        record.verifiedAt = Date.now();
        return valid;
    }

    /** Simulate restore — validates manifest and returns result */
    restore(backupId: string): RestoreResult {
        const record = this.backups.get(backupId);
        if (!record) {
            return { success: false, restoredFiles: 0, skippedFiles: 0, errors: ['Backup not found'] };
        }

        if (!verifyManifest(record.manifest)) {
            return { success: false, restoredFiles: 0, skippedFiles: 0, errors: ['Checksum mismatch'] };
        }

        // In real implementation, would write files to disk
        return {
            success: true,
            restoredFiles: record.manifest.files.length,
            skippedFiles: 0,
            errors: [],
        };
    }

    /** Delete a backup */
    delete(backupId: string): boolean {
        return this.backups.delete(backupId);
    }

    /** Find a backup by ID */
    find(backupId: string): BackupRecord | undefined {
        return this.backups.get(backupId);
    }

    /** List all backups (newest first) */
    list(): readonly BackupRecord[] {
        return [...this.backups.values()].sort((a, b) => b.createdAt - a.createdAt);
    }

    /** Number of backups */
    get size(): number {
        return this.backups.size;
    }

    // ── Private ────────────────────────────────────────────────────────

    private getOldest(): BackupRecord | undefined {
        let oldest: BackupRecord | undefined;
        for (const record of this.backups.values()) {
            if (!oldest || record.createdAt < oldest.createdAt) {
                oldest = record;
            }
        }
        return oldest;
    }
}
