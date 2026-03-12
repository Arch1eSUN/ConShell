import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useWebSocket } from '../lib/useWebSocket';
import './ChatInterface.css';

interface Message {
    role: 'user' | 'agent';
    content: string;
    timestamp: Date;
}

interface SessionInfo {
    session_id: string;
    message_count: number;
    last_activity: string;
}

const SESSION_KEY = 'conshell_session_id';

function getPersistedSessionId(): string {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) return stored;
    const newId = `dash-${Date.now()}`;
    localStorage.setItem(SESSION_KEY, newId);
    return newId;
}

export function ChatInterface() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [sessionId, setSessionId] = useState(getPersistedSessionId);
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [showSessions, setShowSessions] = useState(false);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    const { on } = useWebSocket();

    // Listen for proactive agent messages via WebSocket
    useEffect(() => {
        const unsubs = [
            on('agent_message', (data) => {
                const content = String(data.message ?? data.content ?? '');
                if (!content) return;
                setMessages(prev => [...prev, {
                    role: 'agent' as const,
                    content,
                    timestamp: new Date(),
                }]);
            }),
            on('task_complete', (data) => {
                const result = String(data.result ?? data.message ?? 'Task completed');
                const goal = data.goal ? `[Task: ${data.goal}] ` : '';
                setMessages(prev => [...prev, {
                    role: 'agent' as const,
                    content: `${goal}${result}`,
                    timestamp: new Date(),
                }]);
            }),
            on('task_failed', (data) => {
                const error = String(data.error ?? 'Unknown error');
                const goal = data.goal ? `[Task: ${data.goal}] ` : '';
                setMessages(prev => [...prev, {
                    role: 'agent' as const,
                    content: `${goal}⚠ Task failed: ${error}`,
                    timestamp: new Date(),
                }]);
            }),
        ];
        return () => unsubs.forEach(u => u());
    }, [on]);

    const scrollToBottom = useCallback(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(scrollToBottom, [messages, scrollToBottom]);

    // Load history when sessionId changes
    useEffect(() => {
        setHistoryLoaded(false);
        api.chatHistory(sessionId).then(data => {
            if (data.messages && data.messages.length > 0) {
                setMessages(data.messages.map(m => ({
                    role: m.role === 'user' ? 'user' : 'agent',
                    content: m.content,
                    timestamp: new Date(m.timestamp),
                })));
            } else {
                setMessages([]);
            }
            setHistoryLoaded(true);
        }).catch(() => {
            setMessages([]);
            setHistoryLoaded(true);
        });
    }, [sessionId]);

    // Load session list
    const loadSessions = useCallback(async () => {
        try {
            const data = await api.chatSessions();
            setSessions(data.sessions || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { loadSessions(); }, [loadSessions]);

    const switchSession = (sid: string) => {
        setSessionId(sid);
        localStorage.setItem(SESSION_KEY, sid);
        setShowSessions(false);
    };

    const newSession = () => {
        const newId = `dash-${Date.now()}`;
        localStorage.setItem(SESSION_KEY, newId);
        setSessionId(newId);
        setMessages([]);
        setShowSessions(false);
        loadSessions();
    };

    const stopGeneration = async () => {
        abortRef.current?.abort();
        try { await api.chatAbort(sessionId); } catch { /* ignore */ }
        setStreaming(false);
    };

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || streaming) return;

        const userMsg: Message = { role: 'user', content: text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setStreaming(true);

        const agentMsg: Message = { role: 'agent', content: '', timestamp: new Date() };
        setMessages(prev => [...prev, agentMsg]);

        const controller = new AbortController();
        abortRef.current = controller;

        const MAX_RETRIES = 2;
        let lastError: unknown;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                for await (const chunk of api.chat(text, sessionId, controller.signal)) {
                    if (chunk.type === 'turn' && chunk.data) {
                        setMessages(prev => {
                            const updated = [...prev];
                            const last = updated[updated.length - 1];
                            if (last.role === 'agent') {
                                last.content = String(chunk.data?.response ?? last.content);
                            }
                            return updated;
                        });
                    }
                }
                lastError = null;
                break; // Success — exit retry loop
            } catch (err) {
                lastError = err;
                if (err instanceof DOMException && err.name === 'AbortError') {
                    break; // User cancelled — don't retry
                }
                // Network error — retry after delay
                if (attempt < MAX_RETRIES) {
                    setMessages(prev => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last.role === 'agent') {
                            last.content = `Retrying (${attempt + 1}/${MAX_RETRIES})...`;
                        }
                        return updated;
                    });
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }
            }
        }

        // Handle final error state
        if (lastError) {
            if (lastError instanceof DOMException && (lastError as DOMException).name === 'AbortError') {
                setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === 'agent' && !last.content) {
                        last.content = 'Generation stopped.';
                    }
                    return updated;
                });
            } else {
                setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === 'agent') {
                        last.content = 'Connection failed. Check if the backend is running.';
                    }
                    return updated;
                });
            }
        }

        setStreaming(false);
        abortRef.current = null;
        loadSessions();
    };

    return (
        <div className="chat-interface">
            <div className="chat-header">
                <h3 className="chat-title">Terminal</h3>
                <div className="chat-header-actions">
                    <button
                        className="chat-session-btn"
                        onClick={() => { setShowSessions(!showSessions); if (!showSessions) loadSessions(); }}
                        title="Chat sessions"
                    >
                        ◉ Sessions
                    </button>
                    <button className="chat-new-btn" onClick={newSession} title="New session">
                        + New
                    </button>
                </div>
            </div>

            {showSessions && (
                <div className="chat-sessions-panel">
                    {sessions.length === 0 && <div className="chat-empty-text">No sessions yet</div>}
                    {sessions.map(s => (
                        <button
                            key={s.session_id}
                            className={`chat-session-item ${s.session_id === sessionId ? 'active' : ''}`}
                            onClick={() => switchSession(s.session_id)}
                        >
                            <span className="session-id mono">{s.session_id.slice(0, 16)}…</span>
                            <span className="session-meta">{s.message_count} msgs · {new Date(s.last_activity).toLocaleTimeString()}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="chat-messages">
                {!historyLoaded && (
                    <div className="chat-empty">
                        <span className="chat-empty-text">Loading history…</span>
                    </div>
                )}

                {historyLoaded && messages.length === 0 && (
                    <div className="chat-empty">
                        <span className="chat-prompt">{'>'}</span>
                        <span className="chat-empty-text">Send a message to begin…</span>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} className={`chat-message ${msg.role}`}>
                        <span className="chat-prompt">
                            {msg.role === 'user' ? '$' : '>'}
                        </span>
                        <span className="chat-content">{msg.content}</span>
                    </div>
                ))}

                {streaming && (
                    <span className="chat-cursor" aria-label="Agent is thinking">█</span>
                )}

                <div ref={bottomRef} />
            </div>

            <div className="chat-input-bar">
                <span className="chat-input-prompt">$</span>
                <input
                    type="text"
                    className="chat-input"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMessage()}
                    placeholder="Type a message…"
                    disabled={streaming}
                    aria-label="Chat message input"
                    autoComplete="off"
                />
                {streaming ? (
                    <button
                        className="chat-stop"
                        onClick={stopGeneration}
                        aria-label="Stop generation"
                        title="Stop generation"
                    >
                        ■
                    </button>
                ) : (
                    <button
                        className="chat-send"
                        onClick={sendMessage}
                        disabled={!input.trim()}
                        aria-label="Send message"
                    >
                        ↵
                    </button>
                )}
            </div>
        </div>
    );
}
