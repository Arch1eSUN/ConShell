/**
 * WebSocket Gateway — Real-time event push and session management.
 *
 * Provides:
 * - Real-time agent state broadcasting
 * - Client session management
 * - Event subscription channels
 * - Heartbeat keepalive
 * - Authenticated connections via JWT/API key
 *
 * Conway equivalent: WebSocket event bus for dashboard and inter-agent communication.
 */
// Use dynamic import for ws — types are declared inline to avoid hard dep
interface WebSocketLike {
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    ping(): void;
    terminate(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
}
interface WebSocketServerLike {
    on(event: string, listener: (...args: unknown[]) => void): void;
    close(cb?: () => void): void;
}
const WS_OPEN = 1;

let _WebSocketServer: (new (opts: { server: unknown }) => WebSocketServerLike) | undefined;
function getWsServer(): new (opts: { server: unknown }) => WebSocketServerLike {
    if (!_WebSocketServer) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const ws = require('ws');
            _WebSocketServer = ws.WebSocketServer ?? ws.Server;
        } catch {
            throw new Error('ws package is required for WebSocket gateway — install with: pnpm add ws');
        }
    }
    return _WebSocketServer!;
}

import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Logger } from '@conshell/core';

// ── Types ──────────────────────────────────────────────────────────────

export type WsEventType =
    | 'state_change'
    | 'heartbeat_tick'
    | 'tool_call'
    | 'memory_update'
    | 'inference_start'
    | 'inference_complete'
    | 'message_received'
    | 'child_event'
    | 'metrics_snapshot'
    | 'error'
    | 'pong';

export interface WsEvent {
    readonly type: WsEventType;
    readonly data: unknown;
    readonly timestamp: number;
    readonly sessionId?: string;
}

export interface WsClient {
    readonly id: string;
    readonly ws: WebSocketLike;
    readonly connectedAt: number;
    readonly subscriptions: Set<WsEventType>;
    lastPingAt: number;
}

export interface WsGatewayConfig {
    readonly port?: number;
    readonly host?: string;
    /** Ping interval in ms (default 30s). */
    readonly pingIntervalMs?: number;
    /** Client timeout in ms (default 60s). */
    readonly clientTimeoutMs?: number;
    /** Max clients (default 50). */
    readonly maxClients?: number;
    /** Auth token validator. If not provided, all connections accepted. */
    readonly validateToken?: (token: string) => boolean;
}

// ── WebSocket Gateway ──────────────────────────────────────────────────

export class WsGateway {
    private readonly wss: WebSocketServerLike;
    private readonly httpServer: HttpServer;
    private readonly clients = new Map<string, WsClient>();
    private readonly config: Required<Omit<WsGatewayConfig, 'validateToken'>> & { validateToken?: (token: string) => boolean };
    private readonly logger: Logger;
    private pingInterval: ReturnType<typeof setInterval> | null = null;

    constructor(logger: Logger, cfg?: WsGatewayConfig) {
        this.logger = logger;
        this.config = {
            port: cfg?.port ?? 8081,
            host: cfg?.host ?? '0.0.0.0',
            pingIntervalMs: cfg?.pingIntervalMs ?? 30_000,
            clientTimeoutMs: cfg?.clientTimeoutMs ?? 60_000,
            maxClients: cfg?.maxClients ?? 50,
            validateToken: cfg?.validateToken,
        };

        this.httpServer = createServer();
        this.wss = new (getWsServer())({ server: this.httpServer });
        this.wss.on('connection', (...args: unknown[]) => this.handleConnection(args[0] as WebSocketLike, args[1] as IncomingMessage));
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    async start(): Promise<void> {
        return new Promise((resolve) => {
            this.httpServer.listen(this.config.port, this.config.host, () => {
                this.logger.info('WebSocket gateway started', {
                    port: this.config.port,
                    host: this.config.host,
                });
                this.startPingLoop();
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        if (this.pingInterval) clearInterval(this.pingInterval);

        // Close all client connections
        for (const client of this.clients.values()) {
            client.ws.close(1001, 'Server shutting down');
        }
        this.clients.clear();

        return new Promise((resolve) => {
            this.wss.close(() => {
                this.httpServer.close(() => {
                    this.logger.info('WebSocket gateway stopped');
                    resolve();
                });
            });
        });
    }

    // ── Broadcasting ─────────────────────────────────────────────────────

    /**
     * Broadcast an event to all clients subscribed to its type.
     */
    broadcast(event: WsEvent): void {
        const json = JSON.stringify(event);
        let sentCount = 0;

        for (const client of this.clients.values()) {
            if (client.ws.readyState === WS_OPEN) {
                if (client.subscriptions.size === 0 || client.subscriptions.has(event.type)) {
                    client.ws.send(json);
                    sentCount++;
                }
            }
        }

        this.logger.debug('WS broadcast', { type: event.type, clients: sentCount });
    }

    /**
     * Send an event to a specific client by ID.
     */
    sendTo(clientId: string, event: WsEvent): boolean {
        const client = this.clients.get(clientId);
        if (!client || client.ws.readyState !== WS_OPEN) return false;
        client.ws.send(JSON.stringify(event));
        return true;
    }

    /**
     * Helper to broadcast common event types.
     */
    emitStateChange(data: unknown): void {
        this.broadcast({ type: 'state_change', data, timestamp: Date.now() });
    }

    emitToolCall(data: unknown): void {
        this.broadcast({ type: 'tool_call', data, timestamp: Date.now() });
    }

    emitInferenceStart(data: unknown): void {
        this.broadcast({ type: 'inference_start', data, timestamp: Date.now() });
    }

    emitInferenceComplete(data: unknown): void {
        this.broadcast({ type: 'inference_complete', data, timestamp: Date.now() });
    }

    emitMetrics(data: unknown): void {
        this.broadcast({ type: 'metrics_snapshot', data, timestamp: Date.now() });
    }

    // ── Stats ────────────────────────────────────────────────────────────

    get clientCount(): number {
        return this.clients.size;
    }

    getClients(): Array<{ id: string; connectedAt: number; subscriptions: string[] }> {
        return [...this.clients.values()].map(c => ({
            id: c.id,
            connectedAt: c.connectedAt,
            subscriptions: [...c.subscriptions],
        }));
    }

    // ── Connection handling ───────────────────────────────────────────────

    private handleConnection(ws: WebSocketLike, req: IncomingMessage): void {
        // Auth check
        if (this.config.validateToken) {
            const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
            const token = url.searchParams.get('token') ?? req.headers['authorization']?.replace('Bearer ', '');
            if (!token || !this.config.validateToken(token)) {
                ws.close(4001, 'Unauthorized');
                return;
            }
        }

        // Max client check
        if (this.clients.size >= this.config.maxClients) {
            ws.close(4002, 'Too many clients');
            return;
        }

        const clientId = randomUUID();
        const client: WsClient = {
            id: clientId,
            ws,
            connectedAt: Date.now(),
            subscriptions: new Set(),
            lastPingAt: Date.now(),
        };

        this.clients.set(clientId, client);
        this.logger.info('WS client connected', { clientId, total: this.clients.size });

        // Send welcome
        ws.send(JSON.stringify({
            type: 'connected',
            data: { clientId, serverTime: Date.now() },
            timestamp: Date.now(),
        }));

        ws.on('message', (raw: unknown) => {
            try {
                const msg = JSON.parse(String(raw));
                this.handleClientMessage(client, msg);
            } catch {
                ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid JSON' }, timestamp: Date.now() }));
            }
        });

        ws.on('close', () => {
            this.clients.delete(clientId);
            this.logger.info('WS client disconnected', { clientId, total: this.clients.size });
        });

        ws.on('pong', () => {
            client.lastPingAt = Date.now();
        });
    }

    private handleClientMessage(client: WsClient, msg: { action?: string; events?: string[] }): void {
        switch (msg.action) {
            case 'subscribe':
                if (Array.isArray(msg.events)) {
                    for (const e of msg.events) {
                        client.subscriptions.add(e as WsEventType);
                    }
                }
                client.ws.send(JSON.stringify({
                    type: 'subscribed',
                    data: { events: [...client.subscriptions] },
                    timestamp: Date.now(),
                }));
                break;

            case 'unsubscribe':
                if (Array.isArray(msg.events)) {
                    for (const e of msg.events) {
                        client.subscriptions.delete(e as WsEventType);
                    }
                }
                break;

            case 'ping':
                client.ws.send(JSON.stringify({ type: 'pong', data: {}, timestamp: Date.now() }));
                break;
        }
    }

    // ── Ping loop ────────────────────────────────────────────────────────

    private startPingLoop(): void {
        this.pingInterval = setInterval(() => {
            const now = Date.now();
            for (const [id, client] of this.clients) {
                if (now - client.lastPingAt > this.config.clientTimeoutMs) {
                    client.ws.terminate();
                    this.clients.delete(id);
                    this.logger.warn('WS client timed out', { clientId: id });
                } else if (client.ws.readyState === WS_OPEN) {
                    client.ws.ping();
                }
            }
        }, this.config.pingIntervalMs);
    }
}
