import { useState, useEffect } from 'react';

interface VoiceState {
    state: string;
    sttProvider: string;
    ttsProvider: string;
    wakeWord: string;
}

interface VoiceSession {
    id: string;
    createdAt: string;
    turnCount: number;
}

export function VoicePage() {
    const [voiceState, setVoiceState] = useState<VoiceState | null>(null);
    const [sessions, setSessions] = useState<VoiceSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [ttsText, setTtsText] = useState('');
    const [ttsResult, setTtsResult] = useState<string | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [stateRes, sessRes] = await Promise.all([
                fetch('/api/voice/state'),
                fetch('/api/voice/sessions'),
            ]);
            if (stateRes.ok) setVoiceState(await stateRes.json());
            if (sessRes.ok) {
                const data = await sessRes.json();
                setSessions(data.sessions ?? data);
            }
        } catch { /* silent */ }
        setLoading(false);
    };

    useEffect(() => { fetchData(); }, []);

    const createSession = async () => {
        try {
            const res = await fetch('/api/voice/sessions', { method: 'POST' });
            if (res.ok) fetchData();
        } catch { /* silent */ }
    };

    const endSession = async (id: string) => {
        try {
            await fetch(`/api/voice/sessions/${id}`, { method: 'DELETE' });
            fetchData();
        } catch { /* silent */ }
    };

    const synthesize = async () => {
        if (!ttsText.trim()) return;
        try {
            const res = await fetch('/api/voice/synthesize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: ttsText }),
            });
            if (res.ok) {
                const data = await res.json();
                setTtsResult(data.message ?? 'Synthesized successfully');
            }
        } catch {
            setTtsResult('Synthesis failed');
        }
    };

    const stateColor = voiceState?.state === 'idle' ? '#22c55e'
        : voiceState?.state === 'listening' ? '#eab308'
        : voiceState?.state === 'speaking' ? '#6366f1'
        : '#ef4444';

    return (
        <div className="page-voice">
            <header className="page-header">
                <h2 className="page-title">Voice</h2>
                <p className="page-subtitle">Speech-to-text and text-to-speech pipeline</p>
            </header>

            {/* Voice state panel */}
            <section className="glass-panel" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Pipeline State</h3>
                {loading ? (
                    <p style={{ opacity: 0.5 }}>Loading...</p>
                ) : voiceState ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
                        <div>
                            <span className="label">State</span>
                            <div style={{ fontWeight: 600, color: stateColor }}>{voiceState.state.toUpperCase()}</div>
                        </div>
                        <div>
                            <span className="label">STT Provider</span>
                            <div style={{ fontWeight: 500 }}>{voiceState.sttProvider}</div>
                        </div>
                        <div>
                            <span className="label">TTS Provider</span>
                            <div style={{ fontWeight: 500 }}>{voiceState.ttsProvider}</div>
                        </div>
                        <div>
                            <span className="label">Wake Word</span>
                            <div style={{ fontWeight: 500 }}>{voiceState.wakeWord || 'Not set'}</div>
                        </div>
                    </div>
                ) : (
                    <p style={{ opacity: 0.5 }}>Voice pipeline not available</p>
                )}
            </section>

            {/* TTS panel */}
            <section className="glass-panel" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Text-to-Speech</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                        type="text"
                        placeholder="Enter text to synthesize..."
                        value={ttsText}
                        onChange={e => setTtsText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && synthesize()}
                        style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.2)', color: 'inherit', fontSize: '0.9rem' }}
                    />
                    <button onClick={synthesize} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', background: 'var(--accent, #6366f1)', color: '#fff', border: 'none', cursor: 'pointer' }}>Speak</button>
                </div>
                {ttsResult && <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', opacity: 0.7 }}>{ttsResult}</p>}
            </section>

            {/* Sessions */}
            <section className="glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Sessions</h3>
                    <button onClick={createSession} style={{ padding: '0.3rem 0.8rem', borderRadius: '0.3rem', background: 'var(--accent, #6366f1)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>New Session</button>
                </div>
                {sessions.length === 0 ? (
                    <p style={{ opacity: 0.5 }}>No active sessions</p>
                ) : (
                    sessions.map(s => (
                        <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <div>
                                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{s.id}</div>
                                <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>{s.turnCount} turns</div>
                            </div>
                            <button onClick={() => endSession(s.id)} style={{ padding: '0.3rem 0.6rem', borderRadius: '0.3rem', background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontSize: '0.8rem' }}>End</button>
                        </div>
                    ))
                )}
            </section>
        </div>
    );
}
