import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelManager } from './channels.js';
import type { ChannelConfig, ChannelMessage } from './channels.js';

function makeTelegram(name = 'my-bot'): ChannelConfig {
    return { platform: 'telegram', name, token: 'tg-token-123' };
}

describe('ChannelManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('adds a channel', () => {
        const mgr = new ChannelManager();
        const ch = mgr.add(makeTelegram());
        expect(ch.platform).toBe('telegram');
        expect(ch.status).toBe('disconnected');
        expect(mgr.size).toBe(1);
    });

    it('enforces max channels', () => {
        const mgr = new ChannelManager({ maxChannels: 1 });
        mgr.add(makeTelegram('a'));
        expect(() => mgr.add(makeTelegram('b'))).toThrow('max');
    });

    it('rejects duplicate platform+name', () => {
        const mgr = new ChannelManager();
        mgr.add(makeTelegram('bot'));
        expect(() => mgr.add(makeTelegram('bot'))).toThrow('already exists');
    });

    it('connects and disconnects', () => {
        const mgr = new ChannelManager();
        const ch = mgr.add(makeTelegram());
        mgr.connect(ch.id);
        expect(mgr.find(ch.id)!.status).toBe('connected');
        mgr.disconnect(ch.id);
        expect(mgr.find(ch.id)!.status).toBe('disconnected');
    });

    it('receives incoming messages', () => {
        const mgr = new ChannelManager();
        const ch = mgr.add(makeTelegram());
        const msg: ChannelMessage = {
            channelId: ch.id,
            platform: 'telegram',
            sender: 'user123',
            content: 'Hello!',
            timestamp: Date.now(),
        };

        expect(mgr.receiveMessage(msg)).toBe(true);
        const drained = mgr.drainIncoming();
        expect(drained.length).toBe(1);
        expect(drained[0]!.content).toBe('Hello!');
    });

    it('rejects oversized incoming messages', () => {
        const mgr = new ChannelManager({ maxMessageLength: 10 });
        const ch = mgr.add(makeTelegram());
        const msg: ChannelMessage = {
            channelId: ch.id,
            platform: 'telegram',
            sender: 'user',
            content: 'x'.repeat(20),
            timestamp: Date.now(),
        };
        expect(mgr.receiveMessage(msg)).toBe(false);
    });

    it('sends outgoing messages on connected channels', () => {
        const mgr = new ChannelManager();
        const ch = mgr.add(makeTelegram());
        mgr.connect(ch.id);

        const msg = mgr.sendMessage(ch.id, 'Reply!');
        expect(msg).not.toBeNull();
        expect(mgr.drainOutgoing().length).toBe(1);
    });

    it('refuses to send on disconnected channels', () => {
        const mgr = new ChannelManager();
        const ch = mgr.add(makeTelegram());
        expect(mgr.sendMessage(ch.id, 'nope')).toBeNull();
    });

    it('rate limits outgoing messages', () => {
        const mgr = new ChannelManager({ rateLimitPerMinute: 2 });
        const ch = mgr.add(makeTelegram());
        mgr.connect(ch.id);

        mgr.sendMessage(ch.id, '1');
        mgr.sendMessage(ch.id, '2');
        expect(mgr.sendMessage(ch.id, '3')).toBeNull();
    });

    it('remove deletes channel', () => {
        const mgr = new ChannelManager();
        const ch = mgr.add(makeTelegram());
        mgr.remove(ch.id);
        expect(mgr.size).toBe(0);
    });

    it('listConnected filters correctly', () => {
        const mgr = new ChannelManager();
        const a = mgr.add(makeTelegram('a'));
        mgr.add(makeTelegram('b'));
        mgr.connect(a.id);
        expect(mgr.listConnected().length).toBe(1);
    });
});
