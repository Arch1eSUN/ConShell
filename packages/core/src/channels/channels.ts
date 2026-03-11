/**
 * Channels — multi-platform messaging integration.
 *
 * Supported platforms: Telegram, Discord, Slack, Custom Webhook.
 * Token storage is vault-backed (AES-256-GCM), never plaintext.
 * All incoming messages pass through Injection Defense before Agent Loop.
 */

import { randomBytes } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────

export type ChannelPlatform = 'telegram' | 'discord' | 'slack' | 'webhook';
export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ChannelConfig {
    readonly platform: ChannelPlatform;
    readonly name: string;
    /** Token/API key (stored encrypted, shown here for type definition) */
    readonly token: string;
    /** Platform-specific settings */
    readonly settings?: Record<string, unknown>;
}

export interface Channel {
    readonly id: string;
    readonly platform: ChannelPlatform;
    readonly name: string;
    status: ChannelStatus;
    readonly createdAt: number;
    lastMessageAt?: number;
    messageCount: number;
    lastError?: string;
}

export interface ChannelMessage {
    readonly channelId: string;
    readonly platform: ChannelPlatform;
    readonly sender: string;
    readonly content: string;
    readonly timestamp: number;
    readonly metadata?: Record<string, unknown>;
}

export interface ChannelManagerConfig {
    readonly maxChannels?: number;
    readonly maxMessageLength?: number;
    readonly rateLimitPerMinute?: number;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_CM_CONFIG: Required<ChannelManagerConfig> = {
    maxChannels: 10,
    maxMessageLength: 4096,
    rateLimitPerMinute: 30,
};

// ── ChannelManager ─────────────────────────────────────────────────────

export class ChannelManager {
    private readonly config: Required<ChannelManagerConfig>;
    private readonly channels = new Map<string, Channel>();
    private readonly incomingMessages: ChannelMessage[] = [];
    private readonly outgoingMessages: ChannelMessage[] = [];
    private readonly rateCounts = new Map<string, { count: number; resetAt: number }>();

    constructor(config?: ChannelManagerConfig) {
        this.config = { ...DEFAULT_CM_CONFIG, ...config };
    }

    /** Add a new channel */
    add(channelConfig: ChannelConfig): Channel {
        if (this.channels.size >= this.config.maxChannels) {
            throw new Error(`Cannot add: max ${this.config.maxChannels} channels reached`);
        }

        // Duplicate platform+name check
        for (const ch of this.channels.values()) {
            if (ch.platform === channelConfig.platform && ch.name === channelConfig.name) {
                throw new Error(`Channel "${channelConfig.name}" on ${channelConfig.platform} already exists`);
            }
        }

        const id = randomBytes(8).toString('hex');
        const channel: Channel = {
            id,
            platform: channelConfig.platform,
            name: channelConfig.name,
            status: 'disconnected',
            createdAt: Date.now(),
            messageCount: 0,
        };

        this.channels.set(id, channel);
        return channel;
    }

    /** Connect a channel (simulate — real impl would establish connection) */
    connect(channelId: string): void {
        const channel = this.channels.get(channelId);
        if (!channel) throw new Error(`Unknown channel: ${channelId}`);
        channel.status = 'connected';
    }

    /** Disconnect a channel */
    disconnect(channelId: string): void {
        const channel = this.channels.get(channelId);
        if (!channel) throw new Error(`Unknown channel: ${channelId}`);
        channel.status = 'disconnected';
    }

    /** Remove a channel */
    remove(channelId: string): void {
        this.channels.delete(channelId);
    }

    /** Receive an incoming message from a channel */
    receiveMessage(message: ChannelMessage): boolean {
        const channel = this.channels.get(message.channelId);
        if (!channel) return false;

        if (message.content.length > this.config.maxMessageLength) {
            return false;
        }

        this.incomingMessages.push(message);
        channel.lastMessageAt = message.timestamp;
        channel.messageCount++;
        return true;
    }

    /** Queue an outgoing message to a channel */
    sendMessage(channelId: string, content: string, sender: string = 'agent'): ChannelMessage | null {
        const channel = this.channels.get(channelId);
        if (!channel) return null;
        if (channel.status !== 'connected') return null;

        // Rate limit
        if (!this.checkRateLimit(channelId)) {
            return null;
        }

        if (content.length > this.config.maxMessageLength) {
            return null;
        }

        const message: ChannelMessage = {
            channelId,
            platform: channel.platform,
            sender,
            content,
            timestamp: Date.now(),
        };

        this.outgoingMessages.push(message);
        return message;
    }

    /** Get pending incoming messages (for processing by agent) */
    drainIncoming(): ChannelMessage[] {
        const messages = [...this.incomingMessages];
        this.incomingMessages.length = 0;
        return messages;
    }

    /** Get pending outgoing messages (for delivery) */
    drainOutgoing(): ChannelMessage[] {
        const messages = [...this.outgoingMessages];
        this.outgoingMessages.length = 0;
        return messages;
    }

    /** Find a channel by ID */
    find(channelId: string): Channel | undefined {
        return this.channels.get(channelId);
    }

    /** List all channels */
    list(): readonly Channel[] {
        return [...this.channels.values()];
    }

    /** List connected channels */
    listConnected(): readonly Channel[] {
        return [...this.channels.values()].filter(c => c.status === 'connected');
    }

    /** Number of channels */
    get size(): number {
        return this.channels.size;
    }

    // ── Private ────────────────────────────────────────────────────────

    private checkRateLimit(channelId: string): boolean {
        const now = Date.now();
        const entry = this.rateCounts.get(channelId);

        if (!entry || now >= entry.resetAt) {
            this.rateCounts.set(channelId, { count: 1, resetAt: now + 60_000 });
            return true;
        }

        if (entry.count >= this.config.rateLimitPerMinute) {
            return false;
        }

        entry.count++;
        return true;
    }
}
