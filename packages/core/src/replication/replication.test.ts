/**
 * Tests for Self-Replication (ReplicationManager)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplicationManager, validateGenesis, hashConstitution } from './replication.js';
import type { GenesisConfig } from './replication.js';

const VALID_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const VALID_HASH = 'a'.repeat(64);

function makeGenesis(overrides?: Partial<GenesisConfig>): GenesisConfig {
    return {
        name: 'Child-1',
        prompt: 'You are a helpful assistant',
        parentAddress: VALID_ADDRESS,
        constitutionHash: VALID_HASH,
        initialCredits: 100,
        ...overrides,
    };
}

describe('ReplicationManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('spawns a child agent', () => {
        const mgr = new ReplicationManager();
        const child = mgr.spawn(makeGenesis());
        expect(child.name).toBe('Child-1');
        expect(child.state).toBe('spawning');
        expect(child.id).toHaveLength(16);
    });

    it('enforces max children limit', () => {
        const mgr = new ReplicationManager({ maxChildren: 2 });
        mgr.spawn(makeGenesis({ name: 'A' }));
        mgr.spawn(makeGenesis({ name: 'B' }));
        expect(() => mgr.spawn(makeGenesis({ name: 'C' }))).toThrow('max children');
    });

    it('rejects invalid genesis config', () => {
        const mgr = new ReplicationManager();
        expect(() => mgr.spawn(makeGenesis({ name: '' }))).toThrow('Invalid genesis');
    });

    it('transitions through lifecycle states', () => {
        const mgr = new ReplicationManager();
        const child = mgr.spawn(makeGenesis());

        mgr.transition(child.id, 'provisioning');
        expect(mgr.find(child.id)!.state).toBe('provisioning');

        mgr.transition(child.id, 'configuring');
        mgr.transition(child.id, 'starting');
        mgr.transition(child.id, 'alive');
        expect(mgr.find(child.id)!.state).toBe('alive');
    });

    it('rejects invalid state transitions', () => {
        const mgr = new ReplicationManager();
        const child = mgr.spawn(makeGenesis());
        expect(() => mgr.transition(child.id, 'alive')).toThrow('Invalid transition');
    });

    it('heartbeat tracking marks unhealthy and dead', () => {
        const mgr = new ReplicationManager({ unhealthyThreshold: 2, deadThreshold: 4 });
        const child = mgr.spawn(makeGenesis());
        mgr.transition(child.id, 'provisioning');
        mgr.transition(child.id, 'configuring');
        mgr.transition(child.id, 'starting');
        mgr.transition(child.id, 'alive');

        mgr.heartbeat(child.id, false);
        mgr.heartbeat(child.id, false);
        expect(mgr.find(child.id)!.state).toBe('unhealthy');

        mgr.heartbeat(child.id, false);
        mgr.heartbeat(child.id, false);
        expect(mgr.find(child.id)!.state).toBe('dead');
    });

    it('successful heartbeat recovers unhealthy child', () => {
        const mgr = new ReplicationManager({ unhealthyThreshold: 1 });
        const child = mgr.spawn(makeGenesis());
        mgr.transition(child.id, 'provisioning');
        mgr.transition(child.id, 'configuring');
        mgr.transition(child.id, 'starting');
        mgr.transition(child.id, 'alive');

        mgr.heartbeat(child.id, false);
        expect(mgr.find(child.id)!.state).toBe('unhealthy');

        mgr.heartbeat(child.id, true);
        expect(mgr.find(child.id)!.state).toBe('alive');
    });

    it('sends messages with rate limiting', () => {
        const mgr = new ReplicationManager({ maxMessagesPerHour: 2 });
        const child = mgr.spawn(makeGenesis());

        mgr.sendMessage(child.id, 'hello');
        mgr.sendMessage(child.id, 'world');
        expect(() => mgr.sendMessage(child.id, 'blocked')).toThrow('Rate limit');
    });

    it('enforces message size limit', () => {
        const mgr = new ReplicationManager({ maxMessageSize: 10 });
        const child = mgr.spawn(makeGenesis());
        expect(() => mgr.sendMessage(child.id, 'a'.repeat(11))).toThrow('max size');
    });

    it('kills and cleans up dead children', () => {
        const mgr = new ReplicationManager();
        const child = mgr.spawn(makeGenesis());
        mgr.kill(child.id);
        expect(mgr.find(child.id)!.state).toBe('dead');

        const removed = mgr.cleanup();
        expect(removed).toBe(1);
        expect(mgr.list().length).toBe(0);
    });

    it('listAlive filters out dead children', () => {
        const mgr = new ReplicationManager();
        const alive = mgr.spawn(makeGenesis({ name: 'A' }));
        const dead = mgr.spawn(makeGenesis({ name: 'B' }));
        mgr.kill(dead.id);

        expect(mgr.listAlive().length).toBe(1);
        expect(mgr.listAlive()[0]!.id).toBe(alive.id);
    });
});

describe('validateGenesis', () => {
    it('accepts valid genesis', () => {
        const result = validateGenesis(makeGenesis(), 2000);
        expect(result.valid).toBe(true);
    });

    it('rejects empty name', () => {
        const result = validateGenesis(makeGenesis({ name: '' }), 2000);
        expect(result.valid).toBe(false);
    });

    it('rejects long prompt', () => {
        const result = validateGenesis(makeGenesis({ prompt: 'x'.repeat(100) }), 50);
        expect(result.valid).toBe(false);
    });

    it('rejects invalid parent address', () => {
        const result = validateGenesis(makeGenesis({ parentAddress: 'bad' }), 2000);
        expect(result.valid).toBe(false);
    });
});

describe('hashConstitution', () => {
    it('produces deterministic hash', () => {
        const h1 = hashConstitution('Three Laws');
        const h2 = hashConstitution('Three Laws');
        expect(h1).toBe(h2);
        expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });
});
