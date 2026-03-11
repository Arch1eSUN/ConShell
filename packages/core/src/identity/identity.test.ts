/**
 * Tests for Identity system: AgentCard, SIWE, AgentRegistry
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCard, validateCard, serializeCard, hashCard } from './agent-card.js';
import { createSiweMessage, generateNonce } from './siwe.js';
import { AgentRegistry } from './agent-registry.js';
import type { AgentCard } from './agent-card.js';

// ── AgentCard ──────────────────────────────────────────────────────────

describe('AgentCard', () => {
    const VALID_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates a card with defaults', () => {
        const card = createCard({ name: 'TestBot', address: VALID_ADDRESS });
        expect(card['@context']).toBe('https://schema.org/');
        expect(card['@type']).toBe('SoftwareAgent');
        expect(card.name).toBe('TestBot');
        expect(card.address).toBe(VALID_ADDRESS);
        expect(card.capabilities).toEqual([]);
        expect(card.services).toEqual([]);
        expect(card.version).toBe('1.0.0');
    });

    it('creates a card with full options', () => {
        const card = createCard({
            name: 'ConShell',
            address: VALID_ADDRESS,
            capabilities: ['inference', 'web_browsing'],
            services: [{ name: 'chat', description: 'AI chat service', pricePerCallCents: 1 }],
            endpoint: 'https://agent.example.com',
            version: '2.0.0',
            description: 'A sovereign AI agent',
        });
        expect(card.capabilities).toEqual(['inference', 'web_browsing']);
        expect(card.services.length).toBe(1);
        expect(card.endpoint).toBe('https://agent.example.com');
        expect(card.description).toBe('A sovereign AI agent');
    });

    it('validates a correct card', () => {
        const card = createCard({ name: 'Bot', address: VALID_ADDRESS });
        const result = validateCard(card);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('rejects card with invalid address', () => {
        const card = createCard({ name: 'Bot', address: 'not-an-address' });
        const result = validateCard(card);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Ethereum address'))).toBe(true);
    });

    it('rejects card with empty name', () => {
        const card = createCard({ name: '', address: VALID_ADDRESS });
        const result = validateCard(card);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('name'))).toBe(true);
    });

    it('produces deterministic serialization', () => {
        const card = createCard({ name: 'Bot', address: VALID_ADDRESS });
        const s1 = serializeCard(card);
        const s2 = serializeCard(card);
        expect(s1).toBe(s2);
        expect(s1).toContain('"@context"');
    });

    it('hash is deterministic', () => {
        const card = createCard({ name: 'Bot', address: VALID_ADDRESS });
        const h1 = hashCard(card);
        const h2 = hashCard(card);
        expect(h1).toBe(h2);
        expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });
});

// ── SIWE ───────────────────────────────────────────────────────────────

describe('SIWE', () => {
    it('creates a valid SIWE message', () => {
        const msg = createSiweMessage({
            domain: 'conshell.local',
            address: '0x1234567890abcdef1234567890abcdef12345678',
            statement: 'Sign in to ConShell',
            uri: 'https://conshell.local/api/auth',
            nonce: 'abc123',
            issuedAt: '2026-03-11T12:00:00Z',
        });

        expect(msg).toContain('conshell.local wants you to sign in');
        expect(msg).toContain('0x1234567890abcdef1234567890abcdef12345678');
        expect(msg).toContain('Sign in to ConShell');
        expect(msg).toContain('URI: https://conshell.local/api/auth');
        expect(msg).toContain('Nonce: abc123');
        expect(msg).toContain('Version: 1');
        expect(msg).toContain('Chain ID: 1');
    });

    it('creates message with resources', () => {
        const msg = createSiweMessage({
            domain: 'test.com',
            address: '0x1234567890abcdef1234567890abcdef12345678',
            uri: 'https://test.com/auth',
            nonce: 'xyz',
            issuedAt: '2026-03-11T12:00:00Z',
            resources: ['urn:cap:soul', 'urn:cap:wallet'],
        });
        expect(msg).toContain('Resources:');
        expect(msg).toContain('- urn:cap:soul');
        expect(msg).toContain('- urn:cap:wallet');
    });

    it('generateNonce produces correct length', () => {
        const nonce = generateNonce(24);
        expect(nonce.length).toBe(24);
    });

    it('generateNonce produces unique values', () => {
        const n1 = generateNonce();
        const n2 = generateNonce();
        expect(n1).not.toBe(n2);
    });
});

// ── AgentRegistry ──────────────────────────────────────────────────────

describe('AgentRegistry', () => {
    const ADDR1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const ADDR2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    function makeCard(address: string, caps: string[] = [], services: { name: string; description: string }[] = []): AgentCard {
        return createCard({ name: `Agent-${address.slice(-4)}`, address, capabilities: caps, services });
    }

    it('register and find', () => {
        const registry = new AgentRegistry();
        const card = makeCard(ADDR1, ['inference']);
        registry.register(card);
        expect(registry.find(ADDR1)).toBe(card);
        expect(registry.size).toBe(1);
    });

    it('find is case-insensitive', () => {
        const registry = new AgentRegistry();
        registry.register(makeCard(ADDR1));
        expect(registry.find(ADDR1.toUpperCase())).toBeDefined();
    });

    it('findByCapability returns matching agents', () => {
        const registry = new AgentRegistry();
        registry.register(makeCard(ADDR1, ['inference', 'web']));
        registry.register(makeCard(ADDR2, ['web']));

        const webAgents = registry.findByCapability('web');
        expect(webAgents.length).toBe(2);

        const inferenceAgents = registry.findByCapability('inference');
        expect(inferenceAgents.length).toBe(1);
    });

    it('findByService returns matching agents', () => {
        const registry = new AgentRegistry();
        registry.register(makeCard(ADDR1, [], [{ name: 'chat', description: 'Chat service' }]));
        registry.register(makeCard(ADDR2, [], [{ name: 'code-review', description: 'Code review' }]));

        const chatAgents = registry.findByService('chat');
        expect(chatAgents.length).toBe(1);
    });

    it('list returns all agents', () => {
        const registry = new AgentRegistry();
        registry.register(makeCard(ADDR1));
        registry.register(makeCard(ADDR2));
        expect(registry.list().length).toBe(2);
    });

    it('remove deletes an agent', () => {
        const registry = new AgentRegistry();
        registry.register(makeCard(ADDR1));
        expect(registry.remove(ADDR1)).toBe(true);
        expect(registry.find(ADDR1)).toBeUndefined();
        expect(registry.size).toBe(0);
    });

    it('remove returns false for unknown address', () => {
        const registry = new AgentRegistry();
        expect(registry.remove(ADDR1)).toBe(false);
    });
});
