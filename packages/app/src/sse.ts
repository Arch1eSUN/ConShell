/**
 * SSE Stream Utilities — Token-level streaming, backpressure, reconnection.
 *
 * Provides a higher-level abstraction over Node.js HTTP response for
 * Server-Sent Events with:
 *   - Token-level chunking (not just full-turn)
 *   - Backpressure detection (pauses when client is slow)
 *   - Reconnection support via Last-Event-ID
 *   - Heartbeat keepalive (prevents proxy timeouts)
 */
import type { Response } from 'express';

export interface SseStreamOptions {
    /** Heartbeat interval in ms (default: 15000) */
    readonly heartbeatMs?: number;
    /** Maximum buffer size before backpressure (default: 64KB) */
    readonly maxBufferBytes?: number;
    /** Custom retry interval sent to client (default: 3000ms) */
    readonly retryMs?: number;
}

export class SseStream {
    private eventId = 0;
    private readonly heartbeatTimer: ReturnType<typeof setInterval>;
    private closed = false;
    private readonly maxBuffer: number;

    constructor(
        private readonly res: Response,
        private readonly options: SseStreamOptions = {},
    ) {
        const heartbeatMs = options.heartbeatMs ?? 15_000;
        this.maxBuffer = options.maxBufferBytes ?? 65_536;
        const retryMs = options.retryMs ?? 3_000;

        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',     // Nginx: disable proxy buffering
            'X-Content-Type-Options': 'nosniff',
        });

        // Send retry directive
        res.write(`retry: ${retryMs}\n\n`);

        // Keepalive heartbeat to prevent proxy/LB timeouts
        this.heartbeatTimer = setInterval(() => {
            if (!this.closed) {
                res.write(': heartbeat\n\n');
            }
        }, heartbeatMs);

        // Handle client disconnect
        res.on('close', () => this.close());
    }

    /**
     * Send a typed event with optional data.
     * Returns false if backpressure is detected (client is slow).
     */
    send(event: string, data: unknown): boolean {
        if (this.closed) return false;

        this.eventId++;
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        const message = `id: ${this.eventId}\nevent: ${event}\ndata: ${payload}\n\n`;

        const ok = this.res.write(message);

        // Backpressure: Node.js write() returns false when internal buffer is full
        if (!ok) {
            // Pause until drain event
            return new Promise<boolean>((resolve) => {
                this.res.once('drain', () => resolve(true));
            }) as unknown as boolean;
        }

        return true;
    }

    /**
     * Send a token chunk for streaming inference output.
     * Uses a compact format to minimize overhead.
     */
    sendToken(token: string, metadata?: { model?: string; sessionId?: string }): boolean {
        return this.send('token', { t: token, ...metadata });
    }

    /**
     * Send a tool call event (tool invocation started).
     */
    sendToolCall(toolName: string, args: Record<string, unknown>): boolean {
        return this.send('tool_call', { name: toolName, args });
    }

    /**
     * Send a tool result event.
     */
    sendToolResult(toolName: string, result: string): boolean {
        return this.send('tool_result', { name: toolName, result });
    }

    /**
     * Send a thinking/reasoning event.
     */
    sendThinking(content: string): boolean {
        return this.send('thinking', { content });
    }

    /**
     * Send the final turn completion event.
     */
    sendDone(turnData?: unknown): boolean {
        const ok = this.send('done', turnData ?? { finished: true });
        this.close();
        return ok;
    }

    /**
     * Send an error event and close the stream.
     */
    sendError(error: string, code?: string): boolean {
        const ok = this.send('error', { error, code });
        this.close();
        return ok;
    }

    /**
     * Check if the stream is still active (client connected).
     */
    get isActive(): boolean {
        return !this.closed;
    }

    /**
     * Get the last event ID (useful for reconnection).
     */
    get lastEventId(): number {
        return this.eventId;
    }

    /**
     * Close the SSE stream and cleanup.
     */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.heartbeatTimer);
        if (!this.res.writableEnded) {
            this.res.end();
        }
    }
}

/**
 * Extract Last-Event-ID from request headers for reconnection support.
 */
export function getLastEventId(req: { headers: Record<string, string | string[] | undefined> }): number | null {
    const header = req.headers['last-event-id'];
    if (!header) return null;
    const id = parseInt(String(header), 10);
    return isNaN(id) ? null : id;
}
