import { describe, it, expect, beforeEach } from 'vitest';
import { LocalComputeProvider } from './local.js';
import { DockerComputeProvider } from './docker.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

// ── Mock logger ─────────────────────────────────────────────────────────

const noopLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
} as any;

// ═══════════════════════════════════════════════════════════════════════
// LocalComputeProvider tests
// ═══════════════════════════════════════════════════════════════════════

describe('LocalComputeProvider', () => {
    let provider: LocalComputeProvider;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'web4-compute-'));
        provider = new LocalComputeProvider(noopLogger, tmpDir);
    });

    it('createSandbox returns an ID', async () => {
        const id = await provider.createSandbox({ name: 'test-sandbox' });
        expect(id).toBe('test-sandbox');
    });

    it('createSandbox auto-generates ID if name omitted', async () => {
        const id = await provider.createSandbox({});
        expect(id).toBeTruthy();
        expect(id.length).toBeGreaterThan(0);
    });

    it('getSandbox returns sandbox info', async () => {
        const id = await provider.createSandbox({ name: 'test-sb' });
        const info = await provider.getSandbox(id);
        expect(info).toBeDefined();
        expect(info!.status).toBe('running');
        expect(info!.id).toBe('test-sb');
    });

    it('listSandboxes returns all sandboxes', async () => {
        await provider.createSandbox({ name: 'a' });
        await provider.createSandbox({ name: 'b' });
        const list = await provider.listSandboxes();
        expect(list.length).toBe(2);
    });

    it('destroySandbox marks sandbox as stopped', async () => {
        const id = await provider.createSandbox({ name: 'to-destroy' });
        await provider.destroySandbox(id);
        const info = await provider.getSandbox(id);
        expect(info!.status).toBe('stopped');
    });

    it('destroySandbox throws for unknown ID', async () => {
        await expect(provider.destroySandbox('nope')).rejects.toThrow('Sandbox not found');
    });

    it('exec runs a simple command', async () => {
        const id = await provider.createSandbox({ name: 'exec-test' });
        const result = await provider.exec(id, ['echo', 'hello']);
        expect(result.stdout.trim()).toBe('hello');
        expect(result.exitCode).toBe(0);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('exec returns non-zero exit code on failure', async () => {
        const id = await provider.createSandbox({ name: 'fail-test' });
        const result = await provider.exec(id, ['false']);
        expect(result.exitCode).not.toBe(0);
    });

    it('exec throws for unknown sandbox', async () => {
        await expect(provider.exec('nope', ['echo'])).rejects.toThrow('Sandbox not found');
    });

    it('writeFile + readFile roundtrip', async () => {
        const id = await provider.createSandbox({ name: 'file-test' });
        await provider.writeFile(id, 'test.txt', 'hello world');
        const content = await provider.readFile(id, 'test.txt');
        expect(content).toBe('hello world');
    });

    it('writeFile creates nested directories', async () => {
        const id = await provider.createSandbox({ name: 'nested-test' });
        await provider.writeFile(id, 'deep/nested/file.txt', 'deep content');
        const content = await provider.readFile(id, 'deep/nested/file.txt');
        expect(content).toBe('deep content');
    });

    it('readFile throws for missing file', async () => {
        const id = await provider.createSandbox({ name: 'missing-test' });
        await expect(provider.readFile(id, 'nonexistent.txt')).rejects.toThrow();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// DockerComputeProvider type correctness tests (no Docker daemon needed)
// ═══════════════════════════════════════════════════════════════════════

describe('DockerComputeProvider (interface check)', () => {
    it('implements ComputeProvider interface', () => {
        const provider = new DockerComputeProvider(noopLogger);
        expect(typeof provider.createSandbox).toBe('function');
        expect(typeof provider.destroySandbox).toBe('function');
        expect(typeof provider.getSandbox).toBe('function');
        expect(typeof provider.exec).toBe('function');
        expect(typeof provider.readFile).toBe('function');
        expect(typeof provider.writeFile).toBe('function');
        expect(typeof provider.listSandboxes).toBe('function');
    });
});
