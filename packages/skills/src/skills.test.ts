/**
 * @web4-agent/skills — Unit tests for SkillRegistry + heartbeat triggers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillRegistry } from './registry.js';
import { getSkillHeartbeatTriggers } from './executor.js';
import type { LoadedSkill, SkillManifest } from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
    return {
        name: 'test-skill',
        description: 'A test skill',
        capabilities: [],
        tools: [],
        triggers: [],
        skillMdPath: '/tmp/test/SKILL.md',
        ...overrides,
    };
}

function makeLoadedSkill(overrides: Partial<LoadedSkill> & { manifest?: Partial<SkillManifest> } = {}): LoadedSkill {
    const { manifest: manifestOverrides, ...rest } = overrides;
    return {
        manifest: makeManifest(manifestOverrides),
        enabled: true,
        ...rest,
    };
}

// ── SkillRegistry ────────────────────────────────────────────────────────

describe('SkillRegistry', () => {
    let registry: SkillRegistry;

    beforeEach(() => {
        registry = new SkillRegistry();
    });

    it('starts empty', () => {
        expect(registry.size).toBe(0);
        expect(registry.getAll()).toEqual([]);
    });

    it('registerAll adds skills', () => {
        const skills = [
            makeLoadedSkill({ manifest: { name: 'alpha' } }),
            makeLoadedSkill({ manifest: { name: 'beta' } }),
        ];
        registry.registerAll(skills);
        expect(registry.size).toBe(2);
    });

    it('get returns skill by name', () => {
        const skill = makeLoadedSkill({ manifest: { name: 'my-skill' } });
        registry.registerAll([skill]);
        expect(registry.get('my-skill')?.manifest.name).toBe('my-skill');
        expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('setEnabled toggles skill state', () => {
        registry.registerAll([makeLoadedSkill({ manifest: { name: 'toggleable' } })]);

        expect(registry.get('toggleable')?.enabled).toBe(true);

        const result = registry.setEnabled('toggleable', false);
        expect(result).toBe(true);
        expect(registry.get('toggleable')?.enabled).toBe(false);

        // Re-enable
        registry.setEnabled('toggleable', true);
        expect(registry.get('toggleable')?.enabled).toBe(true);
    });

    it('setEnabled returns false for unknown skill', () => {
        expect(registry.setEnabled('ghost', false)).toBe(false);
    });

    it('listManifests includes enabled status', () => {
        registry.registerAll([
            makeLoadedSkill({ manifest: { name: 'a' }, enabled: true }),
            makeLoadedSkill({ manifest: { name: 'b' }, enabled: false }),
        ]);

        const manifests = registry.listManifests();
        expect(manifests).toHaveLength(2);

        const aManifest = manifests.find(m => m.name === 'a');
        const bManifest = manifests.find(m => m.name === 'b');
        expect(aManifest?.enabled).toBe(true);
        expect(bManifest?.enabled).toBe(false);
    });

    it('getAll returns all skills', () => {
        registry.registerAll([
            makeLoadedSkill({ manifest: { name: 'x' } }),
            makeLoadedSkill({ manifest: { name: 'y' } }),
            makeLoadedSkill({ manifest: { name: 'z' } }),
        ]);
        expect(registry.getAll()).toHaveLength(3);
    });

    it('registerAll overwrites existing skills with same name', () => {
        registry.registerAll([makeLoadedSkill({ manifest: { name: 'dup', description: 'v1' } })]);
        registry.registerAll([makeLoadedSkill({ manifest: { name: 'dup', description: 'v2' } })]);
        expect(registry.size).toBe(1);
        expect(registry.get('dup')?.manifest.description).toBe('v2');
    });

    it('updateLoadedSkill merges updates', () => {
        registry.registerAll([makeLoadedSkill({ manifest: { name: 'updatable' } })]);

        const fakeDefs = [{ name: 'tool1', category: 'test' as const, description: 'A tool', inputSchema: { type: 'object' as const }, riskLevel: 'safe' as const, requiredAuthority: 'self' as const, mcpExposed: false, auditFields: [] }];
        registry.updateLoadedSkill('updatable', { toolDefinitions: fakeDefs });

        const updated = registry.get('updatable');
        expect(updated?.toolDefinitions).toHaveLength(1);
        expect(updated?.toolDefinitions?.[0].name).toBe('tool1');
    });

    it('updateLoadedSkill is no-op for unknown skill', () => {
        // Should not throw
        registry.updateLoadedSkill('ghost', { toolDefinitions: [] });
        expect(registry.size).toBe(0);
    });
});

// ── getSkillsWithHeartbeatTriggers ───────────────────────────────────────

describe('SkillRegistry.getSkillsWithHeartbeatTriggers', () => {
    it('returns only enabled skills with heartbeat triggers', () => {
        const registry = new SkillRegistry();
        registry.registerAll([
            makeLoadedSkill({
                manifest: { name: 'cron-skill', triggers: [{ heartbeat: '*/5 * * * *' }] },
                enabled: true,
            }),
            makeLoadedSkill({
                manifest: { name: 'event-skill', triggers: [{ event: 'on_start' }] },
                enabled: true,
            }),
            makeLoadedSkill({
                manifest: { name: 'disabled-cron', triggers: [{ heartbeat: '0 * * * *' }] },
                enabled: false,
            }),
        ]);

        const result = registry.getSkillsWithHeartbeatTriggers();
        expect(result).toHaveLength(1);
        expect(result[0].manifest.name).toBe('cron-skill');
    });
});

// ── getSkillHeartbeatTriggers (executor function) ────────────────────────

describe('getSkillHeartbeatTriggers', () => {
    it('extracts heartbeat cron expressions from enabled skills', () => {
        const registry = new SkillRegistry();
        registry.registerAll([
            makeLoadedSkill({
                manifest: {
                    name: 'multi-trigger',
                    triggers: [
                        { heartbeat: '*/5 * * * *' },
                        { event: 'on_start' },
                        { heartbeat: '0 */2 * * *' },
                    ],
                },
                enabled: true,
            }),
            makeLoadedSkill({
                manifest: {
                    name: 'disabled-skill',
                    triggers: [{ heartbeat: '0 0 * * *' }],
                },
                enabled: false,
            }),
        ]);

        const triggers = getSkillHeartbeatTriggers(registry);
        expect(triggers).toHaveLength(2);
        expect(triggers[0]).toEqual({ skillName: 'multi-trigger', cron: '*/5 * * * *' });
        expect(triggers[1]).toEqual({ skillName: 'multi-trigger', cron: '0 */2 * * *' });
    });

    it('returns empty for no skills', () => {
        const registry = new SkillRegistry();
        expect(getSkillHeartbeatTriggers(registry)).toEqual([]);
    });
});
