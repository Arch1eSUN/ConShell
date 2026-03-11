/**
 * WebSocket Gateway — bidirectional real-time communication hub.
 *
 * Enhanced capabilities:
 *   - Broadcast events to all connected clients
 *   - Bidirectional client→server commands (subscribe/unsubscribe/ping)
 *   - Session/channel management (join/leave named rooms)
 *   - Typed event system with per-channel targeting
 *   - Auth-gated connections (token via query string or header)
 *
 * Events (server → client):
 *   connected       — welcome on connect
 *   status_update   — periodic agent state snapshot
 *   new_turn        — chat turn completed
 *   balance_change  — credit balance changed
 *   heartbeat_tick  — heartbeat task executed
 *   state_change    — agent state transition
 *   tool_event      — tool execution lifecycle (start/progress/done/error)
 *   config-updated  — configuration was changed
 *   pong            — response to client ping
 *
 * Commands (client → server):
 *   subscribe       — join a channel  { command: 'subscribe', channel: 'turns' }
 *   unsubscribe     — leave a channel { command: 'unsubscribe', channel: 'turns' }
 *   ping            — heartbeat       { command: 'ping' }
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import type { Logger } from '@conshell/core';
import { verifyAuth, type AuthConfig } from '@conshell/security';

// ── Event Types ─────────────────────────────────────────────────────────

export interface WsEvent {
    readonly type: string;
    readonly data: unknown;
    readonly timestamp: string;
    readonly channel?: string;
}

export interface WsCommand {
    readonly command: 'subscribe' | 'unsubscribe' | 'ping';
    readonly channel?: string;
}

// ── Client Wrapper ──────────────────────────────────────────────────────

interface ConnectedClient {
    readonly ws: WebSocket;
    readonly channels: Set<string>;
    readonly connectedAt: number;
    lastPing: number;
}

// ── Manager ─────────────────────────────────────────────────────────────

export class WsManager {
    private wss: WebSocketServer | null = null;
    private readonly clients: Map<WebSocket, ConnectedClient> = new Map();

    constructor(
        private readonly logger: Logger,
        private readonly authConfig?: AuthConfig,
    ) { }

    /**
     * Attach to an HTTP server on the /ws path.
     */
    attach(server: HttpServer): void {
        this.wss = new WebSocketServer({ server, path: '/ws' });

        this.wss.on('connection', (ws, req) => {
            // ── Authentication ───────────────────────────────────────
            if (this.authConfig && this.authConfig.mode !== 'none') {
                const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
                const token = url.searchParams.get('token')
                    ?? (req.headers['sec-websocket-protocol'] as string | undefined);

                const result = verifyAuth(this.authConfig, token ?? undefined);
                if (!result.authenticated) {
                    this.logger.warn('WebSocket auth rejected', { reason: result.reason });
                    ws.close(4401, result.reason ?? 'Unauthorized');
                    return;
                }
            }

            // ── Register Client ──────────────────────────────────────
            const client: ConnectedClient = {
                ws,
                channels: new Set(['*']),  // '*' = global broadcast channel
                connectedAt: Date.now(),
                lastPing: Date.now(),
            };
            this.clients.set(ws, client);
            this.logger.info('WebSocket client connected', { total: this.clients.size });

            // ── Client Message Handler (bidirectional) ───────────────
            ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(raw.toString()) as WsCommand;
                    this.handleCommand(client, msg);
                } catch {
                    // Silently ignore malformed messages
                }
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                this.logger.debug('WebSocket client disconnected', { total: this.clients.size });
            });

            ws.on('error', (err) => {
                this.logger.warn('WebSocket client error', { error: err.message });
                this.clients.delete(ws);
            });

            // Send welcome event
            this.send(ws, {
                type: 'connected',
                data: {
                    message: 'Conway Automaton WebSocket connected',
                    capabilities: ['subscribe', 'unsubscribe', 'ping'],
                    channels: ['turns', 'status', 'tools', 'config', 'balance'],
                },
                timestamp: new Date().toISOString(),
            });
        });

        this.logger.info('WebSocket gateway attached on /ws');
    }

    // ── Command Handler ─────────────────────────────────────────────────

    private handleCommand(client: ConnectedClient, cmd: WsCommand): void {
        switch (cmd.command) {
            case 'subscribe':
                if (cmd.channel) {
                    client.channels.add(cmd.channel);
                    this.send(client.ws, {
                        type: 'subscribed',
                        data: { channel: cmd.channel },
                        timestamp: new Date().toISOString(),
                    });
                }
                break;

            case 'unsubscribe':
                if (cmd.channel && cmd.channel !== '*') {
                    client.channels.delete(cmd.channel);
                    this.send(client.ws, {
                        type: 'unsubscribed',
                        data: { channel: cmd.channel },
                        timestamp: new Date().toISOString(),
                    });
                }
                break;

            case 'ping':
                client.lastPing = Date.now();
                this.send(client.ws, {
                    type: 'pong',
                    data: { serverTime: Date.now() },
                    timestamp: new Date().toISOString(),
                });
                break;
        }
    }

    // ── Broadcasting ────────────────────────────────────────────────────

    /**
     * Broadcast an event to all connected clients (global channel).
     */
    broadcast(type: string, data: unknown): void {
        this.broadcastToChannel('*', type, data);
    }

    /**
     * Broadcast an event to clients subscribed to a specific channel.
     * Clients subscribed to '*' (all clients) will also receive it.
     */
    broadcastToChannel(channel: string, type: string, data: unknown): void {
        const event: WsEvent = {
            type,
            data,
            timestamp: new Date().toISOString(),
            ...(channel !== '*' ? { channel } : {}),
        };

        const payload = JSON.stringify(event);

        for (const [, client] of this.clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                // Send if client is subscribed to this channel or to global '*'
                if (client.channels.has(channel) || client.channels.has('*')) {
                    client.ws.send(payload);
                }
            }
        }
    }

    /**
     * Emit a tool lifecycle event to the 'tools' channel.
     */
    emitToolEvent(
        phase: 'start' | 'progress' | 'done' | 'error',
        toolName: string,
        details: Record<string, unknown> = {},
    ): void {
        this.broadcastToChannel('tools', 'tool_event', {
            phase,
            tool: toolName,
            ...details,
        });
    }

    // ── Client Targeting ────────────────────────────────────────────────

    /**
     * Send an event to a single WebSocket client.
     */
    private send(ws: WebSocket, event: WsEvent): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(event));
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    /**
     * Close all connections and shut down.
     */
    close(): void {
        for (const [ws] of this.clients) {
            ws.close();
        }
        this.clients.clear();
        this.wss?.close();
        this.logger.info('WebSocket gateway closed');
    }

    /**
     * Number of connected clients.
     */
    get clientCount(): number {
        return this.clients.size;
    }

    /**
     * Get connection statistics for monitoring.
     */
    getStats(): {
        totalClients: number;
        channels: Record<string, number>;
    } {
        const channelCounts: Record<string, number> = {};
        for (const [, client] of this.clients) {
            for (const ch of client.channels) {
                channelCounts[ch] = (channelCounts[ch] ?? 0) + 1;
            }
        }
        return {
            totalClients: this.clients.size,
            channels: channelCounts,
        };
    }
}
