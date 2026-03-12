/**
 * ChannelRouter — Multi-instance channel management for ConShell.
 *
 * Manages multiple messaging channels (Telegram, Discord, Slack, WhatsApp, Webhook)
 * with optional workspace isolation per channel. Each isolated channel gets its
 * own agent workspace directory, preventing cross-channel state contamination.
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { platform } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import type {
    ChannelRouter as IChannelRouter,
    ChannelConfig,
    ChannelMessage,
    ChannelInfo,
    IsolatedInstance,
} from './types.js';

export class ChannelRouterImpl implements IChannelRouter {
    private readonly channels = new Map<string, ManagedChannel>();
    private readonly baseWorkspaceDir: string;
    private readonly logger?: {
        info: (msg: string, data?: Record<string, unknown>) => void;
        warn: (msg: string, data?: Record<string, unknown>) => void;
    };

    constructor(options: {
        baseWorkspaceDir: string;
        logger?: ChannelRouterImpl['logger'];
    }) {
        this.baseWorkspaceDir = options.baseWorkspaceDir;
        this.logger = options.logger;
    }

    async addChannel(config: ChannelConfig): Promise<string> {
        const channelId = randomUUID();

        const channel: ManagedChannel = {
            channelId,
            config,
            status: 'disconnected',
            connectedAt: undefined,
            messageCount: 0,
            isolatedInstance: undefined,
        };

        this.channels.set(channelId, channel);

        this.logger?.info('Channel added', {
            channelId,
            type: config.type,
            label: config.label,
            isolated: config.isolated ?? false,
        });

        // Auto-create isolation if requested
        if (config.isolated) {
            await this.isolate(channelId);
        }

        return channelId;
    }

    async removeChannel(channelId: string): Promise<void> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            throw new Error(`Channel not found: ${channelId}`);
        }

        this.channels.delete(channelId);

        this.logger?.info('Channel removed', {
            channelId,
            type: channel.config.type,
            label: channel.config.label,
        });
    }

    async send(channelId: string, message: ChannelMessage): Promise<void> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            throw new Error(`Channel not found: ${channelId}`);
        }

        // Route to appropriate channel adapter
        const adapter = this.getAdapter(channel.config.type);
        await adapter.send(channel.config.credentials, message);

        channel.messageCount++;
        channel.status = 'connected';
        channel.connectedAt ??= Date.now();

        this.logger?.info('Message sent', {
            channelId,
            type: channel.config.type,
            contentLength: message.content.length,
        });
    }

    listChannels(): ChannelInfo[] {
        return [...this.channels.values()].map(ch => ({
            channelId: ch.channelId,
            type: ch.config.type,
            label: ch.config.label,
            status: ch.status,
            connectedAt: ch.connectedAt,
            messageCount: ch.messageCount,
            isolated: ch.isolatedInstance !== undefined,
        }));
    }

    async isolate(channelId: string): Promise<IsolatedInstance> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            throw new Error(`Channel not found: ${channelId}`);
        }

        if (channel.isolatedInstance) {
            return channel.isolatedInstance;
        }

        const instanceId = randomUUID();
        const workspaceDir = join(this.baseWorkspaceDir, 'isolated', instanceId);
        await mkdir(workspaceDir, { recursive: true });

        const instance: IsolatedInstance = {
            instanceId,
            channelId,
            workspaceDir,
            createdAt: Date.now(),
        };

        channel.isolatedInstance = instance;

        this.logger?.info('Channel isolated', {
            channelId,
            instanceId,
            workspaceDir,
        });

        return instance;
    }

    // ── Internal ─────────────────────────────────────────────────────────

    private getAdapter(type: string): ChannelAdapter {
        switch (type) {
            case 'webhook':
                return new WebhookAdapter();
            case 'whatsapp':
                return new WhatsAppAdapter();
            case 'imessage':
                return new IMessageAdapter();
            case 'telegram':
            case 'discord':
            case 'slack':
                return new PlatformAdapter(type);
            default:
                throw new Error(`Unsupported channel type: ${type}`);
        }
    }
}

// ── Channel Adapters ────────────────────────────────────────────────────

interface ChannelAdapter {
    send(credentials: Readonly<Record<string, string>>, message: ChannelMessage): Promise<void>;
}

class WebhookAdapter implements ChannelAdapter {
    async send(credentials: Readonly<Record<string, string>>, message: ChannelMessage): Promise<void> {
        const url = credentials['url'];
        if (!url) throw new Error('Webhook URL not configured');

        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: message.content,
                metadata: message.metadata,
                timestamp: Date.now(),
            }),
        });
    }
}

class PlatformAdapter implements ChannelAdapter {
    constructor(private readonly platform: string) {}

    async send(credentials: Readonly<Record<string, string>>, message: ChannelMessage): Promise<void> {
        const token = credentials['token'] ?? credentials['api_key'];
        if (!token) throw new Error(`${this.platform} token not configured`);
        const chatId = credentials['chat_id'] ?? credentials['channel_id'];

        switch (this.platform) {
            case 'telegram': {
                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text: message.content }),
                });
                break;
            }
            case 'discord': {
                await fetch(`https://discord.com/api/v10/channels/${chatId}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bot ${token}` },
                    body: JSON.stringify({ content: message.content }),
                });
                break;
            }
            case 'slack': {
                await fetch('https://slack.com/api/chat.postMessage', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ channel: chatId, text: message.content }),
                });
                break;
            }
            default:
                throw new Error(`${this.platform} send not yet implemented`);
        }
    }
}

/**
 * WhatsAppAdapter — sends messages via the wacli CLI tool.
 * wacli is the OpenClaw WhatsApp CLI (uses WhatsApp Web bridge).
 * Usage: wacli send --to <phone> --message <text>
 */
class WhatsAppAdapter implements ChannelAdapter {
    async send(credentials: Readonly<Record<string, string>>, message: ChannelMessage): Promise<void> {
        const phone = credentials['phone'] ?? credentials['chat_id'];
        if (!phone) throw new Error('WhatsApp phone number not configured');

        try {
            await execFileAsync('wacli', [
                'send',
                '--to', phone,
                '--message', message.content,
            ], { timeout: 15_000 });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) {
                throw new Error('wacli CLI not found. Install: npm install -g wacli');
            }
            throw new Error(`WhatsApp send failed: ${msg}`);
        }
    }
}

/**
 * IMessageAdapter — sends messages via the imsg CLI tool (macOS only).
 * imsg is the OpenClaw iMessage CLI that interfaces with Messages.app.
 * Usage: imsg send --to <handle> --text <message>
 */
class IMessageAdapter implements ChannelAdapter {
    async send(credentials: Readonly<Record<string, string>>, message: ChannelMessage): Promise<void> {
        if (platform() !== 'darwin') {
            throw new Error('iMessage is only available on macOS');
        }

        const handle = credentials['phone'] ?? credentials['email'] ?? credentials['chat_id'];
        if (!handle) throw new Error('iMessage handle (phone or email) not configured');

        try {
            await execFileAsync('imsg', [
                'send',
                '--to', handle,
                '--text', message.content,
            ], { timeout: 10_000 });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT')) {
                throw new Error('imsg CLI not found. Install: npm install -g imsg');
            }
            throw new Error(`iMessage send failed: ${msg}`);
        }
    }
}

// ── Internal State ──────────────────────────────────────────────────────

interface ManagedChannel {
    readonly channelId: string;
    readonly config: ChannelConfig;
    status: ChannelInfo['status'];
    connectedAt: number | undefined;
    messageCount: number;
    isolatedInstance: IsolatedInstance | undefined;
}
