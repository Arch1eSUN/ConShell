/**
 * Channel Adapters — concrete platform integrations for ChannelManager.
 *
 * Each adapter connects an external messaging platform (Telegram, Discord,
 * Slack, Webhook) to the ConShell agent via the ChannelManager.
 *
 * Adapter lifecycle:
 *   1. construct(config) → validate creds
 *   2. start() → open long-poll / websocket / HTTP listener
 *   3. onMessage(handler) → forward incoming to agent
 *   4. send(target, content) → push agent reply back to platform
 *   5. stop() → clean shutdown
 *
 * Modelled after OpenClaw's multi-channel gateway (22+ platforms).
 */

import type { ChannelMessage, ChannelPlatform } from './channels.js';

// ── Adapter Interface ──────────────────────────────────────────────────

export type MessageHandler = (message: ChannelMessage) => void | Promise<void>;

export interface ChannelAdapter {
    readonly platform: ChannelPlatform;
    readonly name: string;
    /** Start receiving messages */
    start(): Promise<void>;
    /** Stop receiving, clean up resources */
    stop(): Promise<void>;
    /** Register a handler for incoming messages */
    onMessage(handler: MessageHandler): void;
    /** Send a message to a target (chat ID, channel ID, user ID, URL) */
    send(target: string, content: string): Promise<boolean>;
    /** Check if adapter is connected */
    isConnected(): boolean;
}

// ── Telegram Adapter ───────────────────────────────────────────────────

export interface TelegramAdapterConfig {
    readonly botToken: string;
    readonly pollingIntervalMs?: number;
    readonly allowedChatIds?: readonly string[];
}

export class TelegramAdapter implements ChannelAdapter {
    readonly platform: ChannelPlatform = 'telegram';
    readonly name = 'Telegram';
    private handlers: MessageHandler[] = [];
    private running = false;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private lastUpdateId = 0;
    private readonly config: Required<Omit<TelegramAdapterConfig, 'allowedChatIds'>> & { allowedChatIds: readonly string[] };

    constructor(config: TelegramAdapterConfig) {
        this.config = {
            botToken: config.botToken,
            pollingIntervalMs: config.pollingIntervalMs ?? 1000,
            allowedChatIds: config.allowedChatIds ?? [],
        };
    }

    async start(): Promise<void> {
        this.running = true;
        this.pollTimer = setInterval(() => void this.poll(), this.config.pollingIntervalMs);
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    onMessage(handler: MessageHandler): void {
        this.handlers.push(handler);
    }

    async send(chatId: string, content: string): Promise<boolean> {
        try {
            const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: content, parse_mode: 'Markdown' }),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    isConnected(): boolean {
        return this.running;
    }

    // ── Long-polling ────────────────────────────────────────────────

    private async poll(): Promise<void> {
        if (!this.running) return;
        try {
            const url = `https://api.telegram.org/bot${this.config.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=5`;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };
            if (!data.ok || !data.result) return;

            for (const update of data.result) {
                this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
                const msg = update.message;
                if (!msg?.text) continue;

                const chatId = String(msg.chat.id);
                if (this.config.allowedChatIds.length > 0 && !this.config.allowedChatIds.includes(chatId)) {
                    continue;
                }

                const channelMsg: ChannelMessage = {
                    channelId: chatId,
                    platform: 'telegram',
                    sender: msg.from?.username ?? String(msg.from?.id ?? 'unknown'),
                    content: msg.text,
                    timestamp: msg.date * 1000,
                    metadata: { messageId: msg.message_id, chatType: msg.chat.type },
                };
                for (const handler of this.handlers) {
                    void handler(channelMsg);
                }
            }
        } catch { /* polling errors are non-fatal */ }
    }
}

interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        from?: { id: number; username?: string };
        chat: { id: number; type: string };
        date: number;
        text?: string;
    };
}

// ── Discord Adapter ────────────────────────────────────────────────────

export interface DiscordAdapterConfig {
    readonly botToken: string;
    readonly allowedGuildIds?: readonly string[];
}

export class DiscordAdapter implements ChannelAdapter {
    readonly platform: ChannelPlatform = 'discord';
    readonly name = 'Discord';
    private handlers: MessageHandler[] = [];
    private ws: WebSocket | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private sequence: number | null = null;
    private connected = false;
    private readonly config: DiscordAdapterConfig;

    constructor(config: DiscordAdapterConfig) {
        this.config = config;
    }

    async start(): Promise<void> {
        // Get gateway URL
        const res = await fetch('https://discord.com/api/v10/gateway/bot', {
            headers: { Authorization: `Bot ${this.config.botToken}` },
        });
        if (!res.ok) throw new Error(`Discord gateway fetch failed: ${res.status}`);
        const data = await res.json() as { url: string };
        const gwUrl = `${data.url}?v=10&encoding=json`;

        this.ws = new WebSocket(gwUrl);
        this.ws.onmessage = (event) => void this.handleGateway(String(event.data));
        this.ws.onclose = () => { this.connected = false; };
        this.ws.onerror = () => { this.connected = false; };
    }

    async stop(): Promise<void> {
        this.connected = false;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    onMessage(handler: MessageHandler): void {
        this.handlers.push(handler);
    }

    async send(channelId: string, content: string): Promise<boolean> {
        try {
            const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bot ${this.config.botToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content }),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    // ── Gateway ─────────────────────────────────────────────────────

    private async handleGateway(raw: string): Promise<void> {
        const payload = JSON.parse(raw) as DiscordGatewayPayload;
        if (payload.s !== null) this.sequence = payload.s;

        switch (payload.op) {
            case 10: { // Hello — start heartbeat + identify
                const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
                this.heartbeatTimer = setInterval(() => {
                    this.ws?.send(JSON.stringify({ op: 1, d: this.sequence }));
                }, interval);
                // Identify
                this.ws?.send(JSON.stringify({
                    op: 2,
                    d: {
                        token: this.config.botToken,
                        intents: 513, // GUILDS + GUILD_MESSAGES
                        properties: { os: 'conshell', browser: 'conshell', device: 'conshell' },
                    },
                }));
                break;
            }
            case 0: { // Dispatch
                if (payload.t === 'READY') {
                    this.connected = true;
                } else if (payload.t === 'MESSAGE_CREATE') {
                    const d = payload.d as DiscordMessage;
                    if (d.author.bot) return;
                    if (this.config.allowedGuildIds?.length && d.guild_id && !this.config.allowedGuildIds.includes(d.guild_id)) {
                        return;
                    }
                    const channelMsg: ChannelMessage = {
                        channelId: d.channel_id,
                        platform: 'discord',
                        sender: `${d.author.username}#${d.author.discriminator}`,
                        content: d.content,
                        timestamp: new Date(d.timestamp).getTime(),
                        metadata: { messageId: d.id, guildId: d.guild_id },
                    };
                    for (const handler of this.handlers) {
                        void handler(channelMsg);
                    }
                }
                break;
            }
        }
    }
}

interface DiscordGatewayPayload {
    op: number;
    d: unknown;
    s: number | null;
    t: string | null;
}

interface DiscordMessage {
    id: string;
    channel_id: string;
    guild_id?: string;
    author: { username: string; discriminator: string; bot?: boolean };
    content: string;
    timestamp: string;
}

// ── Slack Adapter ──────────────────────────────────────────────────────

export interface SlackAdapterConfig {
    readonly botToken: string;           // xoxb-...
    readonly appToken: string;           // xapp-... (for Socket Mode)
    readonly allowedChannelIds?: readonly string[];
}

export class SlackAdapter implements ChannelAdapter {
    readonly platform: ChannelPlatform = 'slack';
    readonly name = 'Slack';
    private handlers: MessageHandler[] = [];
    private ws: WebSocket | null = null;
    private connected = false;
    private readonly config: SlackAdapterConfig;

    constructor(config: SlackAdapterConfig) {
        this.config = config;
    }

    async start(): Promise<void> {
        // Open Socket Mode connection
        const res = await fetch('https://slack.com/api/apps.connections.open', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.config.appToken}` },
        });
        const data = await res.json() as { ok: boolean; url?: string };
        if (!data.ok || !data.url) throw new Error('Slack Socket Mode connection failed');

        this.ws = new WebSocket(data.url);
        this.ws.onmessage = (event) => void this.handleEvent(String(event.data));
        this.ws.onopen = () => { this.connected = true; };
        this.ws.onclose = () => { this.connected = false; };
    }

    async stop(): Promise<void> {
        this.connected = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    onMessage(handler: MessageHandler): void {
        this.handlers.push(handler);
    }

    async send(channelId: string, content: string): Promise<boolean> {
        try {
            const res = await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.config.botToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ channel: channelId, text: content }),
            });
            const data = await res.json() as { ok: boolean };
            return data.ok;
        } catch {
            return false;
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    private async handleEvent(raw: string): Promise<void> {
        const envelope = JSON.parse(raw) as SlackEnvelope;

        // Acknowledge envelope
        if (envelope.envelope_id && this.ws) {
            this.ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
        }

        if (envelope.type !== 'events_api' || !envelope.payload) return;
        const event = envelope.payload.event;
        if (!event || event.type !== 'message' || event.subtype || event.bot_id) return;

        if (this.config.allowedChannelIds?.length && !this.config.allowedChannelIds.includes(event.channel)) {
            return;
        }

        const channelMsg: ChannelMessage = {
            channelId: event.channel,
            platform: 'slack',
            sender: event.user ?? 'unknown',
            content: event.text ?? '',
            timestamp: Math.floor(parseFloat(event.ts ?? '0') * 1000),
            metadata: { threadTs: event.thread_ts },
        };
        for (const handler of this.handlers) {
            void handler(channelMsg);
        }
    }
}

interface SlackEnvelope {
    envelope_id?: string;
    type: string;
    payload?: {
        event?: {
            type: string;
            subtype?: string;
            bot_id?: string;
            channel: string;
            user?: string;
            text?: string;
            ts?: string;
            thread_ts?: string;
        };
    };
}

// ── Webhook Adapter ────────────────────────────────────────────────────

export interface WebhookAdapterConfig {
    readonly secret?: string;            // HMAC secret for verification
    readonly targetUrl?: string;         // URL to POST outgoing messages to
}

export class WebhookAdapter implements ChannelAdapter {
    readonly platform: ChannelPlatform = 'webhook';
    readonly name = 'Webhook';
    private handlers: MessageHandler[] = [];
    private connected = false;
    private readonly config: WebhookAdapterConfig;

    constructor(config: WebhookAdapterConfig) {
        this.config = config;
    }

    async start(): Promise<void> {
        this.connected = true;
    }

    async stop(): Promise<void> {
        this.connected = false;
    }

    onMessage(handler: MessageHandler): void {
        this.handlers.push(handler);
    }

    /** Deliver outgoing messages to configured webhook URL */
    async send(target: string, content: string): Promise<boolean> {
        const url = target || this.config.targetUrl;
        if (!url) return false;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, timestamp: Date.now() }),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    /** Inject an inbound webhook payload (called from HTTP route) */
    injectMessage(message: ChannelMessage): void {
        for (const handler of this.handlers) {
            void handler(message);
        }
    }
}

// ── Adapter Factory ────────────────────────────────────────────────────

export type AdapterConfig = TelegramAdapterConfig | DiscordAdapterConfig | SlackAdapterConfig | WebhookAdapterConfig;

export function createAdapter(platform: ChannelPlatform, config: AdapterConfig): ChannelAdapter {
    switch (platform) {
        case 'telegram': return new TelegramAdapter(config as TelegramAdapterConfig);
        case 'discord': return new DiscordAdapter(config as DiscordAdapterConfig);
        case 'slack': return new SlackAdapter(config as SlackAdapterConfig);
        case 'webhook': return new WebhookAdapter(config as WebhookAdapterConfig);
        default: throw new Error(`Unknown platform: ${platform as string}`);
    }
}
