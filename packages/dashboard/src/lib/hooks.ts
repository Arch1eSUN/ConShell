import { useState, useEffect, useCallback } from 'react';
import { api, type AgentStatus, type TurnEntry, type SoulDocument } from './api';

/**
 * Poll-based data hook with configurable interval.
 */
export function usePolling<T>(
    fetcher: () => Promise<T>,
    intervalMs = 5000,
) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const result = await fetcher();
            setData(result);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [fetcher]);

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, intervalMs);
        return () => clearInterval(id);
    }, [refresh, intervalMs]);

    return { data, error, loading, refresh };
}

/** Agent status with 5s polling */
export function useAgentStatus() {
    return usePolling<AgentStatus>(() => api.status(), 5000);
}

/** Logs with 10s polling */
export function useLogs(sessionId?: string) {
    const fetcher = useCallback(
        () => api.logs({ sessionId, limit: 50 }),
        [sessionId],
    );
    return usePolling<{ turns: TurnEntry[]; count: number }>(fetcher, 10000);
}

/** Soul with 30s polling */
export function useSoul() {
    return usePolling<SoulDocument>(() => api.soul(), 30000);
}
