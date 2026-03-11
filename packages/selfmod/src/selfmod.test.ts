import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTestLogger } from '@conshell/core';
import { openTestDatabase, ModificationsRepository } from '@conshell/state';
import { SelfModEngine, sha256 } from './engine.js';
import type Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);

let db: Database.Database;
let tmpDir: string;
let engine: SelfModEngine;
let repo: ModificationsRepository;

const noopLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
} as any;

// ── Test helpers ────────────────────────────────────────────────────────

async function initGitRepo(dir: string): Promise<void> {
    await execFileAsync('git', ['init'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'test@conshell.sh'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    // Initial commit so HEAD exists
    await fs.writeFile(path.join(dir, '.gitkeep'), '');
    await execFileAsync('git', ['add', '.'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir });
}

// ── Setup / teardown ───────────────────────────────────────────────────

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conshell-selfmod-'));
    await initGitRepo(tmpDir);

    const { logger } = createTestLogger();
    db = openTestDatabase(logger);
    repo = new ModificationsRepository(db);
    engine = new SelfModEngine(repo, noopLogger, { workDir: tmpDir });
});

afterEach(async () => {
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════
// sha256
// ═══════════════════════════════════════════════════════════════════════

describe('sha256', () => {
    it('returns 64-char hex hash', () => {
        const h = sha256('hello world');
        expect(h.length).toBe(64);
        expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
    });

    it('is deterministic', () => {
        expect(sha256('test')).toBe(sha256('test'));
    });

    it('changes with input', () => {
        expect(sha256('a')).not.toBe(sha256('b'));
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Protected files
// ═══════════════════════════════════════════════════════════════════════

describe('isProtected', () => {
    it('protects constitution.md', () => {
        expect(engine.isProtected('constitution.md')).toBe(true);
    });

    it('protects wallet.json', () => {
        expect(engine.isProtected('wallet.json')).toBe(true);
    });

    it('protects state.db', () => {
        expect(engine.isProtected('state.db')).toBe(true);
    });

    it('protects automaton.json', () => {
        expect(engine.isProtected('automaton.json')).toBe(true);
    });

    it('protects .git/ paths', () => {
        expect(engine.isProtected('.git/config')).toBe(true);
    });

    it('protects schema.ts', () => {
        expect(engine.isProtected('schema.ts')).toBe(true);
    });

    it('allows normal files', () => {
        expect(engine.isProtected('src/main.ts')).toBe(false);
    });

    it('allows nested normal files', () => {
        expect(engine.isProtected('tools/helper.js')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// File editing
// ═══════════════════════════════════════════════════════════════════════

describe('editFile', () => {
    it('creates a new file and records modification', async () => {
        const result = await engine.editFile({
            filePath: 'src/new-feature.ts',
            newContent: 'export const hello = "world";',
        });

        expect(result.success).toBe(true);
        expect(result.modificationId).toBeDefined();
        expect(result.gitCommit).toBeDefined();

        // File should exist in the working directory
        const content = await fs.readFile(path.join(tmpDir, 'src/new-feature.ts'), 'utf-8');
        expect(content).toBe('export const hello = "world";');

        // Audit record should be in the DB
        const mods = repo.findRecent(10);
        expect(mods.length).toBe(1);
        expect(mods[0]!.type).toBe('file_edit');
        expect(mods[0]!.target).toBe('src/new-feature.ts');
    });

    it('edits an existing file with before/after hash', async () => {
        // Write initial content
        await fs.writeFile(path.join(tmpDir, 'readme.md'), 'original');
        await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
        await execFileAsync('git', ['commit', '-m', 'add readme'], { cwd: tmpDir });

        const result = await engine.editFile({
            filePath: 'readme.md',
            newContent: 'updated',
        });

        expect(result.success).toBe(true);
        const mod = repo.findRecent(1)[0]!;
        expect(mod.before_hash).toBeTruthy();
        expect(mod.after_hash).toBeTruthy();
        expect(mod.before_hash).not.toBe(mod.after_hash);
    });

    it('rejects editing protected files', async () => {
        const result = await engine.editFile({
            filePath: 'constitution.md',
            newContent: 'hacked',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Protected');
        expect(repo.findRecent(10).length).toBe(0);
    });

    it('rejects editing wallet.json', async () => {
        const result = await engine.editFile({
            filePath: 'wallet.json',
            newContent: '{}',
        });
        expect(result.success).toBe(false);
    });

    it('rejects editing .git/ files', async () => {
        const result = await engine.editFile({
            filePath: '.git/config',
            newContent: 'hacked',
        });
        expect(result.success).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Skill creation
// ═══════════════════════════════════════════════════════════════════════

describe('createSkill', () => {
    it('creates a skill file', async () => {
        const content = '# My Skill\n\nDoes something useful.';
        const result = await engine.createSkill('my-skill', content);

        expect(result.success).toBe(true);
        const onDisk = await fs.readFile(path.join(tmpDir, 'skills', 'my-skill.md'), 'utf-8');
        expect(onDisk).toBe(content);

        const mod = repo.findRecent(1)[0]!;
        expect(mod.type).toBe('skill_create');
        expect(mod.target).toBe('my-skill');
    });

    it('rejects invalid skill names', async () => {
        const result = await engine.createSkill('INVALID NAME!', 'content');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid skill name');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Rate limiting
// ═══════════════════════════════════════════════════════════════════════

describe('rate limiting', () => {
    it('respects maxPerHour', async () => {
        // Create engine with very low limit
        const limitedEngine = new SelfModEngine(repo, noopLogger, {
            workDir: tmpDir,
            maxPerHour: 2,
        });

        // First two should succeed
        await limitedEngine.editFile({ filePath: 'a.txt', newContent: 'a' });
        await limitedEngine.editFile({ filePath: 'b.txt', newContent: 'b' });

        // Third should fail
        const result = await limitedEngine.editFile({ filePath: 'c.txt', newContent: 'c' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('Rate limit');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Rollback
// ═══════════════════════════════════════════════════════════════════════

describe('rollback', () => {
    it('reverts a file edit', async () => {
        const editResult = await engine.editFile({
            filePath: 'to-revert.txt',
            newContent: 'new content',
        });
        expect(editResult.success).toBe(true);

        const rollbackResult = await engine.rollback(editResult.modificationId!);
        expect(rollbackResult.success).toBe(true);
        expect(rollbackResult.revertModId).toBeDefined();

        // Rollback audit record
        const mods = repo.findRecent(10);
        const revertMod = mods.find(m => m.type === 'rollback');
        expect(revertMod).toBeDefined();
        expect(revertMod!.target).toContain('revert-of-mod');
    });

    it('rejects rollback of non-existent mod', async () => {
        const result = await engine.rollback(9999);
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });

    it('rejects rollback of a rollback', async () => {
        const edit = await engine.editFile({ filePath: 'x.txt', newContent: 'x' });
        const revert = await engine.rollback(edit.modificationId!);
        expect(revert.success).toBe(true);

        // Try to rollback the rollback
        const result = await engine.rollback(revert.revertModId!);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Cannot rollback a rollback');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// History
// ═══════════════════════════════════════════════════════════════════════

describe('getHistory', () => {
    it('returns empty when no modifications', () => {
        expect(engine.getHistory().length).toBe(0);
    });

    it('returns modifications in reverse chronological order', async () => {
        await engine.editFile({ filePath: 'first.txt', newContent: 'first' });
        await engine.editFile({ filePath: 'second.txt', newContent: 'second' });

        const history = engine.getHistory();
        expect(history.length).toBe(2);
        expect(history[0]!.target).toBe('second.txt');
    });

    it('getHistoryByType filters correctly', async () => {
        await engine.editFile({ filePath: 'file.txt', newContent: 'data' });
        await engine.createSkill('my-skill', 'content');

        expect(engine.getHistoryByType('file_edit').length).toBe(1);
        expect(engine.getHistoryByType('skill_create').length).toBe(1);
        expect(engine.getHistoryByType('package_install').length).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Git integration
// ═══════════════════════════════════════════════════════════════════════

describe('git integration', () => {
    it('creates git commits for file edits', async () => {
        await engine.editFile({ filePath: 'tracked.txt', newContent: 'tracked' });

        const { stdout } = await execFileAsync('git', ['log', '--oneline', '-5'], { cwd: tmpDir });
        expect(stdout).toContain('self-mod: file_edit tracked.txt');
    });

    it('creates git commits for skill creation', async () => {
        await engine.createSkill('test-skill', '# Test');

        const { stdout } = await execFileAsync('git', ['log', '--oneline', '-5'], { cwd: tmpDir });
        expect(stdout).toContain('self-mod: skill_create test-skill');
    });
});
