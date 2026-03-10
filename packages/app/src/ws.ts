/**
 * WebSocket manager — broadcasts real-time state changes to connected clients.
 *
 * Events:
 *   status_update  — agent state snapshot
 *   new_turn       — new chat turn completed
 *   balance_change — credit balance changed
 *   heartbeat_tick — heartbeat task executed
 *   state_change   — agent state transition
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import type { Logger } from '@web4-agent/core';

// ── Event Types ─────────────────────────────────────────────────────────

export interface WsEvent {
    readonly type: string;
    readonly data: unknown;
    readonly timestamp: string;
}

// ── Manager ─────────────────────────────────────────────────────────────

export class WsManager {
    private wss: WebSocketServer | null = null;
    private readonly clients: Set<WebSocket> = new Set();

    constructor(private readonly logger: Logger) { }

    /**
     * Attach to an HTTP server on the /ws path.
     */
    attach(server: HttpServer): void {
        this.wss = new WebSocketServer({ server, path: '/ws' });

        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            this.logger.info('WebSocket client connected', { total: this.clients.size });

            ws.on('close', () => {
                this.clients.delete(ws);
                this.logger.debug('WebSocket client disconnected', { total: this.clients.size });
            });

            ws.on('error', (err) => {
                this.logger.warn('WebSocket client error', { error: err.message });
                this.clients.delete(ws);
            });

            // Send initial welcome
            this.send(ws, {
                type: 'connected',
                data: { message: 'Conway Automaton WebSocket connected' },
                timestamp: new Date().toISOString(),
            });
        });

        this.logger.info('WebSocket server attached on /ws');
    }

    /**
     * Broadcast an event to all connected clients.
     */
    broadcast(type: string, data: unknown): void {
        const event: WsEvent = {
            type,
            data,
            timestamp: new Date().toISOString(),
        };

        const payload = JSON.stringify(event);

        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }

    /**
     * Send to a single client.
     */
    private send(ws: WebSocket, event: WsEvent): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(event));
        }
    }

    /**
     * Close all connections and shut down.
     */
    close(): void {
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();
        this.wss?.close();
        this.logger.info('WebSocket server closed');
    }

    get clientCount(): number {
        return this.clients.size;
    }
}
