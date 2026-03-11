import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PluginManager, validateManifest } from './plugins.js';
import type { PluginManifest } from './plugins.js';

function makeManifest(overrides?: Partial<PluginManifest>): PluginManifest {
    return {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        hooks: ['onTurn'],
        permissions: [],
        entrypoint: 'index.js',
        ...overrides,
    };
}

describe('PluginManager', () => {
    it('installs a plugin', () => {
        const mgr = new PluginManager();
        const plugin = mgr.install(makeManifest());
        expect(plugin.state).toBe('installed');
        expect(plugin.manifest.name).toBe('test-plugin');
        expect(mgr.size).toBe(1);
    });

    it('rejects invalid manifest', () => {
        const mgr = new PluginManager();
        expect(() => mgr.install(makeManifest({ name: '' }))).toThrow('Invalid manifest');
    });

    it('rejects duplicate plugin names', () => {
        const mgr = new PluginManager();
        mgr.install(makeManifest());
        expect(() => mgr.install(makeManifest())).toThrow('already installed');
    });

    it('enforces max plugins limit', () => {
        const mgr = new PluginManager({ maxPlugins: 1 });
        mgr.install(makeManifest({ name: 'a' }));
        expect(() => mgr.install(makeManifest({ name: 'b' }))).toThrow('max');
    });

    it('enables and disables plugins', () => {
        const mgr = new PluginManager();
        const plugin = mgr.install(makeManifest());
        mgr.enable(plugin.id);
        expect(mgr.find(plugin.id)!.state).toBe('enabled');

        mgr.disable(plugin.id);
        expect(mgr.find(plugin.id)!.state).toBe('disabled');
    });

    it('registers hook listeners on enable', () => {
        const mgr = new PluginManager();
        const plugin = mgr.install(makeManifest({ hooks: ['onTurn', 'onWake'] }));
        mgr.enable(plugin.id);

        expect(mgr.getHookListeners('onTurn').length).toBe(1);
        expect(mgr.getHookListeners('onWake').length).toBe(1);
        expect(mgr.getHookListeners('onSleep').length).toBe(0);
    });

    it('unregisters hook listeners on disable', () => {
        const mgr = new PluginManager();
        const plugin = mgr.install(makeManifest({ hooks: ['onTurn'] }));
        mgr.enable(plugin.id);
        mgr.disable(plugin.id);
        expect(mgr.getHookListeners('onTurn').length).toBe(0);
    });

    it('uninstall removes plugin completely', () => {
        const mgr = new PluginManager();
        const plugin = mgr.install(makeManifest());
        mgr.enable(plugin.id);
        mgr.uninstall(plugin.id);
        expect(mgr.size).toBe(0);
        expect(mgr.getHookListeners('onTurn').length).toBe(0);
    });

    it('emit triggers hooks and returns contexts', () => {
        const mgr = new PluginManager();
        const p1 = mgr.install(makeManifest({ name: 'a', hooks: ['onTurn'] }));
        const p2 = mgr.install(makeManifest({ name: 'b', hooks: ['onTurn'] }));
        mgr.enable(p1.id);
        mgr.enable(p2.id);

        const contexts = mgr.emit('onTurn', { turn: 1 });
        expect(contexts.length).toBe(2);
        expect(contexts[0]!.hookName).toBe('onTurn');
    });

    it('findByName locates plugin', () => {
        const mgr = new PluginManager();
        mgr.install(makeManifest({ name: 'finder' }));
        expect(mgr.findByName('finder')).toBeDefined();
        expect(mgr.findByName('missing')).toBeUndefined();
    });

    it('listEnabled returns only enabled plugins', () => {
        const mgr = new PluginManager();
        const a = mgr.install(makeManifest({ name: 'a' }));
        mgr.install(makeManifest({ name: 'b' }));
        mgr.enable(a.id);
        expect(mgr.listEnabled().length).toBe(1);
    });
});

describe('validateManifest', () => {
    it('accepts valid manifest', () => {
        expect(validateManifest(makeManifest()).valid).toBe(true);
    });

    it('rejects invalid name format', () => {
        const result = validateManifest(makeManifest({ name: 'Bad Name!' }));
        expect(result.valid).toBe(false);
    });

    it('rejects invalid version', () => {
        const result = validateManifest(makeManifest({ version: 'abc' }));
        expect(result.valid).toBe(false);
    });

    it('rejects empty hooks', () => {
        const result = validateManifest(makeManifest({ hooks: [] }));
        expect(result.valid).toBe(false);
    });
});
