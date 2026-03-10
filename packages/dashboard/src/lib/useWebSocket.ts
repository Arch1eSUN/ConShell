import { useEffect, useRef, useState, useCallback } from 'react';

export interface WsMessage {
    type: string;
    data: Record<string, unknown>;
    timestamp: string;
}

/**
 * WebSocket hook with auto-reconnect.
 */
export function useWebSocket(path = '/ws') {
    const [connected, setConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectRef = useRef<ReturnType<typeof setTimeout>>(null);
    const listenersRef = useRef<Map<string, Set<(data: Record<string, unknown>) => void>>>(new Map());

    const connect = useCallback(() => {
        // In dev mode (Vite), the WS connection should go through the proxy.
        // Use relative path so Vite's proxy config can intercept, or if served
        // directly by the backend, window.location works.
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const url = `${protocol}//${host}${path}`;

        const ws = new WebSocket(url);
        wsRef.current = ws;

        let pingInterval: ReturnType<typeof setInterval> | null = null;

        ws.onopen = () => {
            setConnected(true);
            console.log('[WS] Connected');
            // Keepalive ping every 30s to prevent firewalls/proxies from closing idle connections
            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30_000);
        };

        ws.onclose = (event) => {
            setConnected(false);
            if (pingInterval) clearInterval(pingInterval);
            // Only reconnect if not a clean close (1000 = normal closure)
            if (event.code !== 1000) {
                console.log(`[WS] Disconnected (code=${event.code}) — reconnecting in 3s`);
                reconnectRef.current = setTimeout(connect, 3000);
            } else {
                console.log('[WS] Closed cleanly');
            }
        };

        ws.onerror = () => {
            ws.close();
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data) as WsMessage;
                setLastMessage(msg);

                // Dispatch to type-specific listeners
                const handlers = listenersRef.current.get(msg.type);
                if (handlers) {
                    handlers.forEach(fn => fn(msg.data));
                }
            } catch { /* ignore bad messages */ }
        };
    }, [path]);

    useEffect(() => {
        connect();
        return () => {
            if (reconnectRef.current) clearTimeout(reconnectRef.current);
            wsRef.current?.close();
        };
    }, [connect]);

    const on = useCallback((type: string, handler: (data: Record<string, unknown>) => void) => {
        if (!listenersRef.current.has(type)) {
            listenersRef.current.set(type, new Set());
        }
        listenersRef.current.get(type)!.add(handler);

        return () => {
            listenersRef.current.get(type)?.delete(handler);
        };
    }, []);

    return { connected, lastMessage, on };
}
