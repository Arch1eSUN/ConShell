import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    BackupManager,
    hashContent,
    computeChecksum,
    createManifest,
    verifyManifest,
} from './backup.js';
import type { BackupFileEntry } from './backup.js';

const SAMPLE_FILES: BackupFileEntry[] = [
    { path: 'state.db', sizeBytes: 1024, hash: hashContent('db-content'), encrypted: false },
    { path: 'SOUL.md', sizeBytes: 512, hash: hashContent('soul-content'), encrypted: false },
    { path: 'wallet.json', sizeBytes: 256, hash: hashContent('wallet-content'), encrypted: true },
];

describe('BackupManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('creates a backup', () => {
        const mgr = new BackupManager();
        const record = mgr.create('TestAgent', SAMPLE_FILES);
        expect(record.status).toBe('complete');
        expect(record.manifest.agentName).toBe('TestAgent');
        expect(record.manifest.files.length).toBe(3);
        expect(mgr.size).toBe(1);
    });

    it('verifies a valid backup', () => {
        const mgr = new BackupManager();
        const record = mgr.create('TestAgent', SAMPLE_FILES);
        expect(mgr.verify(record.id)).toBe(true);
        expect(mgr.find(record.id)!.status).toBe('verified');
    });

    it('restores a valid backup', () => {
        const mgr = new BackupManager();
        const record = mgr.create('TestAgent', SAMPLE_FILES);
        const result = mgr.restore(record.id);
        expect(result.success).toBe(true);
        expect(result.restoredFiles).toBe(3);
    });

    it('restore fails on unknown backup', () => {
        const mgr = new BackupManager();
        const result = mgr.restore('non-existent');
        expect(result.success).toBe(false);
    });

    it('deletes a backup', () => {
        const mgr = new BackupManager();
        const record = mgr.create('TestAgent', SAMPLE_FILES);
        expect(mgr.delete(record.id)).toBe(true);
        expect(mgr.size).toBe(0);
    });

    it('list returns newest first', () => {
        const mgr = new BackupManager();
        mgr.create('A', SAMPLE_FILES);
        vi.advanceTimersByTime(1000);
        mgr.create('B', SAMPLE_FILES);
        const list = mgr.list();
        expect(list[0]!.manifest.agentName).toBe('B');
    });

    it('evicts oldest when at max capacity', () => {
        const mgr = new BackupManager({ maxBackups: 2 });
        mgr.create('A', SAMPLE_FILES);
        mgr.create('B', SAMPLE_FILES);
        mgr.create('C', SAMPLE_FILES);
        expect(mgr.size).toBe(2);
    });
});

describe('manifest helpers', () => {
    it('hashContent is deterministic', () => {
        expect(hashContent('test')).toBe(hashContent('test'));
        expect(hashContent('test')).toMatch(/^[a-f0-9]{64}$/);
    });

    it('createManifest computes correct checksum', () => {
        const manifest = createManifest('Agent', SAMPLE_FILES);
        expect(verifyManifest(manifest)).toBe(true);
    });

    it('verifyManifest detects tampering', () => {
        const manifest = createManifest('Agent', SAMPLE_FILES);
        const tampered = { ...manifest, checksum: 'bad' };
        expect(verifyManifest(tampered)).toBe(false);
    });

    it('manifest totalSizeBytes is sum of files', () => {
        const manifest = createManifest('Agent', SAMPLE_FILES);
        expect(manifest.totalSizeBytes).toBe(1024 + 512 + 256);
    });
});
