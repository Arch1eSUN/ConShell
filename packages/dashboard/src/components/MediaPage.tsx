import { useState, useEffect } from 'react';

interface MediaTypeInfo {
    type: string;
    extensions: string[];
    maxSize: number;
}

export function MediaPage() {
    const [types, setTypes] = useState<MediaTypeInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [cleanupResult, setCleanupResult] = useState<string | null>(null);

    const fetchTypes = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/media/types');
            if (res.ok) {
                const data = await res.json();
                setTypes(data.types ?? data);
            }
        } catch { /* silent */ }
        setLoading(false);
    };

    useEffect(() => { fetchTypes(); }, []);

    const runCleanup = async () => {
        setCleanupResult('Cleaning up...');
        try {
            const res = await fetch('/api/media/cleanup', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                setCleanupResult(`Cleaned up ${data.removed ?? 0} files, freed ${data.freedMb ?? 0} MB`);
            } else {
                setCleanupResult('Cleanup failed');
            }
        } catch {
            setCleanupResult('Cleanup error');
        }
    };

    return (
        <div className="page-media">
            <header className="page-header">
                <h2 className="page-title">Media</h2>
                <p className="page-subtitle">Multimodal processing pipeline for images, audio, video, and documents</p>
            </header>

            {/* Supported types */}
            <section className="glass-panel" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Supported Types</h3>
                {loading ? (
                    <p style={{ opacity: 0.5 }}>Loading...</p>
                ) : types.length === 0 ? (
                    <p style={{ opacity: 0.5 }}>No media types configured</p>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                        {types.map(t => (
                            <div key={t.type} style={{ padding: '1rem', borderRadius: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                                <div style={{ fontWeight: 600, marginBottom: '0.25rem', textTransform: 'capitalize' }}>{t.type}</div>
                                <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>
                                    {t.extensions?.join(', ') || 'N/A'}
                                </div>
                                <div style={{ fontSize: '0.8rem', opacity: 0.5, marginTop: '0.25rem' }}>
                                    Max: {t.maxSize ? `${Math.round(t.maxSize / 1024 / 1024)} MB` : 'N/A'}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Pipeline features */}
            <section className="glass-panel" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Pipeline Features</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    {[
                        { name: 'Image Processing', desc: 'Resize, compress, format conversion' },
                        { name: 'Audio Transcription', desc: 'Whisper-powered speech-to-text' },
                        { name: 'Video Analysis', desc: 'Keyframe extraction and analysis' },
                        { name: 'Vision AI', desc: 'Multi-modal content understanding' },
                        { name: 'Document Parsing', desc: 'PDF, HTML, and Markdown extraction' },
                        { name: 'Auto Cleanup', desc: 'TTL-based cache cleanup' },
                    ].map(f => (
                        <div key={f.name} style={{ padding: '0.75rem', borderRadius: '0.5rem', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}>
                            <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{f.name}</div>
                            <div style={{ fontSize: '0.8rem', opacity: 0.5, marginTop: '0.15rem' }}>{f.desc}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Cleanup */}
            <section className="glass-panel">
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Cache Cleanup</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button onClick={runCleanup} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer' }}>
                        Run Cleanup
                    </button>
                    {cleanupResult && <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>{cleanupResult}</span>}
                </div>
            </section>
        </div>
    );
}
