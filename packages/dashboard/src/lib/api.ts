/**
 * API client — communicates with the Express backend.
 */

const BASE = '';

export interface AgentStatus {
    agentState: string;
    survivalTier: string;
    walletAddress?: string;
    financial: {
        totalTopupCents: number;
        totalSpendCents: number;
        netBalanceCents: number;
        currentHourSpendCents: number;
        currentDaySpendCents: number;
    };
    heartbeatTasks: Array<{
        task_name: string;
        cron_expression: string;
        enabled: number;
        last_run_at: string | null;
    }>;
    aliveChildren: number;
}

export interface TurnEntry {
    id: string;
    session_id: string;
    thinking: string | null;
    tool_calls_json: string | null;
    input_tokens: number;
    output_tokens: number;
    cost_cents: number;
    model: string;
    created_at: string;
}

export interface SoulDocument {
    version: string;
    identity: string;
    values: string[];
    capabilities: string[];
    currentGoals: string[];
    alignmentNotes: string;
    lastReflection?: string;
}

export interface ChatResponse {
    type: 'turn' | 'error' | 'done';
    data?: Record<string, unknown>;
}

export interface HealthResponse {
    status: string;
    agent: string;
    state: string;
    uptime: number;
}

export interface FundResult {
    success: boolean;
    transactionId?: string;
    error?: string;
}

// ── Fetchers ────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    return res.json();
}

// ── API Methods ─────────────────────────────────────────────────────

export const api = {
    health: () => get<HealthResponse>('/api/health'),
    status: () => get<AgentStatus>('/api/status'),
    logs: (opts?: { sessionId?: string; limit?: number }) => {
        const params = new URLSearchParams();
        if (opts?.sessionId) params.set('sessionId', opts.sessionId);
        if (opts?.limit) params.set('limit', String(opts.limit));
        const qs = params.toString();
        return get<{ turns: TurnEntry[]; count: number }>(
            `/api/logs${qs ? `?${qs}` : ''}`,
        );
    },
    fund: (amountCents: number) => post<FundResult>('/api/fund', { amountCents }),
    soul: () => get<SoulDocument>('/api/soul'),
    children: () => get<{ aliveCount: number }>('/api/children'),

    /** SSE-based chat — returns an EventSource-like reader */
    chat: async function* (message: string, sessionId?: string, signal?: AbortSignal): AsyncGenerator<ChatResponse> {
        const res = await fetch(`${BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sessionId }),
            signal: signal ?? AbortSignal.timeout(300_000),
        });

        if (!res.ok || !res.body) {
            throw new Error(`Chat failed: ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        yield JSON.parse(line.slice(6)) as ChatResponse;
                    } catch { /* skip bad lines */ }
                }
            }
        }
    },

    /** List all chat sessions */
    chatSessions: () => get<{ sessions: Array<{ session_id: string; message_count: number; first_activity: string; last_activity: string }> }>('/api/chat/sessions'),

    /** Get full message history for a session */
    chatHistory: (sessionId: string) => get<{ sessionId: string; messages: Array<{ role: string; content: string; timestamp: string; model: string | null }>; count: number }>(`/api/chat/sessions/${sessionId}`),

    /** Abort current generation for a session */
    chatAbort: (sessionId: string) => post<{ success: boolean; message: string }>('/api/chat/abort', { sessionId }),
};
