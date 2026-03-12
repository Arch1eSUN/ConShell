import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestLogger } from '@conshell/core';
import { openTestDatabase, SoulHistoryRepository } from '@conshell/state';
import { SoulSystem, EMPTY_SOUL, validateSoul, serializeSoul, parseSoul, hashSoul } from './soul.js';
import type { SoulDocument } from './soul.js';
import type Database from 'better-sqlite3';

const noopLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
} as any;

let db: Database.Database;

beforeEach(() => {
    const { logger } = createTestLogger();
    db = openTestDatabase(logger);
});

afterEach(() => {
    db.close();
});

// ═══════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════

describe('validateSoul', () => {
    it('accepts valid empty soul', () => {
        expect(validateSoul(EMPTY_SOUL).valid).toBe(true);
    });

    it('rejects wrong version', () => {
        const doc = { ...EMPTY_SOUL, version: 'soul/v2' as any };
        const result = validateSoul(doc);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('version');
    });

    it('rejects empty name', () => {
        const doc = { ...EMPTY_SOUL, name: '' };
        expect(validateSoul(doc).valid).toBe(false);
    });

    it('rejects name exceeding max length', () => {
        const doc = { ...EMPTY_SOUL, name: 'x'.repeat(200) };
        expect(validateSoul(doc).valid).toBe(false);
    });

    it('rejects too many values', () => {
        const doc = { ...EMPTY_SOUL, values: Array(25).fill('value') };
        expect(validateSoul(doc).valid).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Serialization roundtrip
// ═══════════════════════════════════════════════════════════════════════

describe('serializeSoul / parseSoul', () => {
    it('roundtrip preserves all fields', () => {
        const original: SoulDocument = {
            version: 'soul/v1',
            name: 'TestBot',
            identity: 'I am a test agent for validation.',
            values: ['honesty', 'efficiency', 'safety'],
            capabilities: ['code-execution', 'web-search'],
            currentGoals: ['pass all tests', 'learn TypeScript'],
            alignmentNotes: 'All systems operational.',
            lastReflection: '2026-01-01T00:00:00Z',
        };

        const serialized = serializeSoul(original);
        const parsed = parseSoul(serialized);

        expect(parsed.version).toBe(original.version);
        expect(parsed.name).toBe(original.name);
        expect(parsed.identity).toBe(original.identity);
        expect(parsed.values).toEqual(original.values);
        expect(parsed.capabilities).toEqual(original.capabilities);
        expect(parsed.currentGoals).toEqual(original.currentGoals);
        expect(parsed.alignmentNotes).toBe(original.alignmentNotes);
        expect(parsed.lastReflection).toBe(original.lastReflection);
    });

    it('hash is deterministic', () => {
        const h1 = hashSoul(EMPTY_SOUL);
        const h2 = hashSoul(EMPTY_SOUL);
        expect(h1).toBe(h2);
        expect(h1.length).toBe(64); // SHA-256 hex
    });

    it('hash changes when content changes', () => {
        const h1 = hashSoul(EMPTY_SOUL);
        const modified = { ...EMPTY_SOUL, name: 'ModifiedAgent' };
        const h2 = hashSoul(modified);
        expect(h1).not.toBe(h2);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SoulSystem
// ═══════════════════════════════════════════════════════════════════════

describe('SoulSystem', () => {
    it('initializes with EMPTY_SOUL when no history', () => {
        const repo = new SoulHistoryRepository(db);
        const soul = new SoulSystem(repo, noopLogger);
        const doc = soul.view();
        expect(doc.name).toBe('{NAME}');
        expect(doc.version).toBe('soul/v1');
    });

    it('initializes from provided initial soul', () => {
        const repo = new SoulHistoryRepository(db);
        const initial: SoulDocument = { ...EMPTY_SOUL, name: 'CustomBot' };
        const soul = new SoulSystem(repo, noopLogger, initial);
        expect(soul.view().name).toBe('CustomBot');
    });

    it('persists initial soul to history', () => {
        const repo = new SoulHistoryRepository(db);
        new SoulSystem(repo, noopLogger);
        expect(repo.count()).toBe(1);
    });

    it('loads from history on subsequent creation', () => {
        const repo = new SoulHistoryRepository(db);
        const soul1 = new SoulSystem(repo, noopLogger, { ...EMPTY_SOUL, name: 'Bot-v1' });
        soul1.update({ name: 'Bot-v2' });

        // Create new instance — should load latest from DB
        const soul2 = new SoulSystem(repo, noopLogger);
        expect(soul2.view().name).toBe('Bot-v2');
    });

    it('update validates and rejects invalid changes', () => {
        const repo = new SoulHistoryRepository(db);
        const soul = new SoulSystem(repo, noopLogger);

        const result = soul.update({ name: '' });
        expect(result.valid).toBe(false);
        expect(soul.view().name).toBe('{NAME}'); // Unchanged
    });

    it('update accepts valid changes', () => {
        const repo = new SoulHistoryRepository(db);
        const soul = new SoulSystem(repo, noopLogger);

        const result = soul.update({
            name: 'EvolvingBot',
            capabilities: ['reasoning', 'code-gen'],
        });
        expect(result.valid).toBe(true);
        expect(soul.view().name).toBe('EvolvingBot');
        expect(soul.view().capabilities).toEqual(['reasoning', 'code-gen']);
    });

    it('version cannot be overridden', () => {
        const repo = new SoulHistoryRepository(db);
        const soul = new SoulSystem(repo, noopLogger);
        soul.update({ name: 'Test' } as any);
        expect(soul.view().version).toBe('soul/v1');
    });

    it('viewRaw returns serialized SOUL.md', () => {
        const repo = new SoulHistoryRepository(db);
        const soul = new SoulSystem(repo, noopLogger, { ...EMPTY_SOUL, name: 'RawBot' });
        const raw = soul.viewRaw();
        expect(raw).toContain('---');
        expect(raw).toContain('name: "RawBot"');
        expect(raw).toContain('# Identity');
    });

    it('reflect returns alignment score and notes', () => {
        const repo = new SoulHistoryRepository(db);
        const soul = new SoulSystem(repo, noopLogger, {
            ...EMPTY_SOUL,
            name: 'ReflectBot',
            identity: 'A comprehensive test agent for alignment.',
            values: ['honesty', 'safety', 'helpfulness'],
            capabilities: ['reasoning'],
            currentGoals: ['pass all tests'],
            alignmentNotes: 'Everything is fine.',
        });

        const { score, notes } = soul.reflect();
        expect(score).toBe(100); // All criteria met: 50 + 10*5
        expect(notes).toContain('well-defined');
        expect(notes).toContain('3 defined');
    });

    it('reflect with minimal soul returns base score', () => {
        const repo = new SoulHistoryRepository(db);
        const soul = new SoulSystem(repo, noopLogger);

        const { score } = soul.reflect();
        expect(score).toBe(100); // 50 + 10 (identity > 20) + 10 (7 values) + 10 (7 capabilities) + 10 (4 goals) + 10 (alignment notes)
    });

    it('getHistory returns all versions', () => {
        const repo = new SoulHistoryRepository(db);
        const soul = new SoulSystem(repo, noopLogger);
        soul.update({ name: 'V2' });
        soul.update({ name: 'V3' });

        const history = soul.getHistory();
        expect(history.count).toBe(3); // initial + 2 updates
        expect(history.versions.length).toBe(3);
    });

    it('reflect persists alignment score to history', () => {
        const repo = new SoulHistoryRepository(db);
        const soul = new SoulSystem(repo, noopLogger);
        soul.reflect();

        const latest = repo.getLatest()!;
        expect(latest.alignment_score).toBeGreaterThan(0);
    });
});
