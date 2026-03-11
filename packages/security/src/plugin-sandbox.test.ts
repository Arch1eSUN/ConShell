/**
 * Tests for PluginSandbox — isolated plugin execution.
 */
import { describe, it, expect, vi } from 'vitest';
import { PluginSandbox } from './plugin-sandbox.js';
import type { PluginManifest } from './plugin-sandbox.js';

const makeManifest = (overrides?: Partial<PluginManifest>): PluginManifest => ({
    name: 'test-plugin',
    version: '1.0.0',
    permissions: ['tool:register'],
    entrypoint: 'index.js',
    ...overrides,
});

describe('PluginSandbox', () => {
    it('registers and lists plugins', () => {
        const sb = new PluginSandbox();
        sb.register(makeManifest(), 'var x = 1;');
        const list = sb.list();
        expect(list).toHaveLength(1);
        expect(list[0]!.name).toBe('test-plugin');
        expect(list[0]!.state).toBe('ready');
    });

    it('rejects duplicate registration', () => {
        const sb = new PluginSandbox();
        sb.register(makeManifest(), 'var x = 1;');
        expect(() => sb.register(makeManifest(), 'var y = 2;')).toThrow('already registered');
    });

    it('rejects manifest without name', () => {
        const sb = new PluginSandbox();
        expect(() =>
            sb.register(makeManifest({ name: '' }), 'var x = 1;'),
        ).toThrow('must include name');
    });

    it('rejects dangerous code patterns', () => {
        const sb = new PluginSandbox();
        expect(() =>
            sb.register(makeManifest({ name: 'evil' }), 'process.exit(1)'),
        ).toThrow('dangerous code pattern');
    });

    it('rejects child_process require', () => {
        const sb = new PluginSandbox();
        expect(() =>
            sb.register(makeManifest({ name: 'evil2' }), "require('child_process')"),
        ).toThrow('dangerous code pattern');
    });

    it('executes safe code in sandbox', () => {
        const sb = new PluginSandbox();
        sb.register(makeManifest(), '1 + 2');
        const result = sb.execute('test-plugin');
        expect(result.success).toBe(true);
        expect(result.output).toBe(3);
        expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('returns error for unknown plugin', () => {
        const sb = new PluginSandbox();
        const result = sb.execute('nonexistent');
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });

    it('catches runtime errors in plugin code', () => {
        const sb = new PluginSandbox();
        sb.register(makeManifest(), 'throw new Error("boom")');
        const result = sb.execute('test-plugin');
        expect(result.success).toBe(false);
        expect(result.error).toContain('boom');
        const info = sb.getInfo('test-plugin');
        expect(info?.state).toBe('error');
        expect(info?.errorCount).toBe(1);
    });

    it('times out long-running code', () => {
        const sb = new PluginSandbox({ defaultTimeoutMs: 50 });
        sb.register(makeManifest(), 'while(true) {}');
        const result = sb.execute('test-plugin');
        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');
    });

    it('sandbox has no access to process/require', () => {
        const sb = new PluginSandbox();
        sb.register(makeManifest({ name: 'no-process' }), 'typeof process');
        const result = sb.execute('no-process');
        expect(result.success).toBe(true);
        expect(result.output).toBe('undefined');
    });

    it('unregisters plugins', () => {
        const sb = new PluginSandbox();
        sb.register(makeManifest(), 'var x = 1;');
        expect(sb.unregister('test-plugin')).toBe(true);
        expect(sb.list()).toHaveLength(0);
        expect(sb.unregister('test-plugin')).toBe(false);
    });

    it('exposes custom APIs to sandbox', () => {
        const sb = new PluginSandbox();
        sb.register(makeManifest(), 'myApi.getValue()');
        const result = sb.execute('test-plugin', {
            exposedApis: {
                myApi: { getValue: () => 42 },
            },
        });
        expect(result.success).toBe(true);
        expect(result.output).toBe(42);
    });

    it('emits lifecycle events', () => {
        const sb = new PluginSandbox();
        const registered = vi.fn();
        const executed = vi.fn();
        sb.on('plugin:registered', registered);
        sb.on('plugin:executed', executed);

        sb.register(makeManifest(), '1 + 1');
        expect(registered).toHaveBeenCalledWith('test-plugin');

        sb.execute('test-plugin');
        expect(executed).toHaveBeenCalledWith('test-plugin', expect.any(Number));
    });

    it('validates permissions statically', () => {
        const result = PluginSandbox.validatePermissions(
            ['network:outbound', 'fs:write'],
            ['network:outbound', 'tool:register'],
        );
        expect(result.valid).toBe(false);
        expect(result.denied).toEqual(['fs:write']);
    });

    it('provides safe console to plugins', () => {
        const sb = new PluginSandbox();
        const logs: unknown[][] = [];
        sb.on('plugin:log', (_name: string, _level: string, args: unknown[]) => {
            logs.push(args);
        });
        sb.register(makeManifest({ name: 'logger' }), 'console.log("hello", 42);');
        sb.execute('logger');
        expect(logs).toHaveLength(1);
        expect(logs[0]).toEqual(['hello', 42]);
    });
});
