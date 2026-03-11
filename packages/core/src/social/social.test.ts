/**
 * Tests for Social Layer (SocialHub)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SocialHub, validateMessage, hashMessage } from './social.js';
import type { SocialMessage, SocialConfig } from './social.js';

const ADDR_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ADDR_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function makeMessage(overrides?: Partial<SocialMessage>): SocialMessage {
    return {
        id: 'msg-1',
        from: ADDR_A,
        to: ADDR_B,
        content: 'Hello agent!',
        timestamp: Date.now(),
        ...overrides,
    };
}

describe('SocialHub', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('compose creates an outgoing message', () => {
        const hub = new SocialHub();
        const msg = hub.compose(ADDR_B, 'Hello!', ADDR_A);
        expect(msg.from).toBe(ADDR_A);
        expect(msg.to).toBe(ADDR_B);
        expect(msg.content).toBe('Hello!');
        expect(hub.getOutbox().length).toBe(1);
    });

    it('receive accepts valid message into inbox', () => {
        const hub = new SocialHub();
        const result = hub.receive(makeMessage());
        expect(result.valid).toBe(true);
        expect(hub.inboxSize).toBe(1);
    });

    it('receive rejects message from blocked sender', () => {
        const hub = new SocialHub();
        hub.block(ADDR_A);
        const result = hub.receive(makeMessage());
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('blocked');
    });

    it('receive rejects oversized message', () => {
        const hub = new SocialHub({ maxMessageSize: 10 });
        const result = hub.receive(makeMessage({ content: 'x'.repeat(20) }));
        expect(result.valid).toBe(false);
    });

    it('receive rejects old messages', () => {
        const hub = new SocialHub({ maxMessageAge: 5000 });
        const oldMsg = makeMessage({ timestamp: Date.now() - 10_000 });
        const result = hub.receive(oldMsg);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('too old');
    });

    it('getInbox filters by sender', () => {
        const hub = new SocialHub();
        hub.receive(makeMessage({ id: '1', from: ADDR_A }));
        hub.receive(makeMessage({ id: '2', from: ADDR_B, to: ADDR_A }));

        const filtered = hub.getInbox({ from: ADDR_A });
        expect(filtered.length).toBe(1);
        expect(filtered[0]!.id).toBe('1');
    });

    it('getInbox filters by timestamp', () => {
        const hub = new SocialHub();
        hub.receive(makeMessage({ id: '1' }));

        vi.advanceTimersByTime(5000);
        hub.receive(makeMessage({ id: '2', timestamp: Date.now() }));

        const cutoff = Date.now() - 3000;
        const filtered = hub.getInbox({ since: cutoff });
        expect(filtered.length).toBe(1);
    });

    it('flushOutbox clears sent messages', () => {
        const hub = new SocialHub();
        hub.compose(ADDR_B, 'msg1', ADDR_A);
        hub.compose(ADDR_B, 'msg2', ADDR_A);

        const flushed = hub.flushOutbox();
        expect(flushed.length).toBe(2);
        expect(hub.getOutbox().length).toBe(0);
    });

    it('feedback tracks reputation with weighted average', () => {
        const hub = new SocialHub();
        hub.feedback(ADDR_A, 80);
        expect(hub.getReputation(ADDR_A)!.feedbackScore).toBe(80);

        hub.feedback(ADDR_A, 40);
        // Weighted: (80 * 1 + 40) / 2 = 60
        expect(hub.getReputation(ADDR_A)!.feedbackScore).toBe(60);
        expect(hub.getReputation(ADDR_A)!.interactionCount).toBe(2);
    });

    it('auto-blocks agents with low reputation', () => {
        const hub = new SocialHub({ autoBlockThreshold: -50 });
        hub.feedback(ADDR_A, -60);
        expect(hub.isBlocked(ADDR_A)).toBe(true);
    });

    it('block and unblock', () => {
        const hub = new SocialHub();
        hub.block(ADDR_A);
        expect(hub.isBlocked(ADDR_A)).toBe(true);
        hub.unblock(ADDR_A);
        expect(hub.isBlocked(ADDR_A)).toBe(false);
    });

    it('inbox capacity evicts oldest messages', () => {
        const hub = new SocialHub({ maxInboxSize: 2 });
        hub.receive(makeMessage({ id: '1' }));
        hub.receive(makeMessage({ id: '2' }));
        hub.receive(makeMessage({ id: '3' }));

        expect(hub.inboxSize).toBe(2);
        const inbox = hub.getInbox();
        expect(inbox[0]!.id).toBe('2');
    });

    it('rejects invalid feedback score', () => {
        const hub = new SocialHub();
        expect(() => hub.feedback(ADDR_A, 200)).toThrow('between -100 and +100');
    });

    it('is case-insensitive on addresses', () => {
        const hub = new SocialHub();
        hub.feedback(ADDR_A.toUpperCase(), 50);
        expect(hub.getReputation(ADDR_A)).toBeDefined();
    });

    it('listReputation returns all entries', () => {
        const hub = new SocialHub();
        hub.feedback(ADDR_A, 50);
        hub.feedback(ADDR_B, -10);
        expect(hub.listReputation().length).toBe(2);
    });
});

describe('validateMessage', () => {
    it('accepts valid message', () => {
        const result = validateMessage(makeMessage(), {
            maxMessageSize: 4096,
            maxMessageAge: 3600_000,
            maxInboxSize: 1000,
            autoBlockThreshold: -50,
        });
        expect(result.valid).toBe(true);
    });

    it('rejects invalid sender address', () => {
        const result = validateMessage(makeMessage({ from: 'bad' }), {
            maxMessageSize: 4096,
            maxMessageAge: 3600_000,
            maxInboxSize: 1000,
            autoBlockThreshold: -50,
        });
        expect(result.valid).toBe(false);
    });
});

describe('hashMessage', () => {
    it('produces deterministic hash', () => {
        expect(hashMessage('test')).toBe(hashMessage('test'));
        expect(hashMessage('test')).toMatch(/^[a-f0-9]{64}$/);
    });
});
