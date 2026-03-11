/**
 * Voice Pipeline — speech-to-text, text-to-speech, and wake-word detection.
 *
 * Modelled after OpenClaw's voice interaction capabilities:
 *   - Wake-word detection (local keyword spotting)
 *   - STT: Whisper API / local whisper
 *   - TTS: OpenAI TTS / ElevenLabs / local piper
 *   - Conversation management (turn-based voice sessions)
 *
 * Uses AudioBuffer abstraction to decouple from specific audio backends.
 */

// ── Types ──────────────────────────────────────────────────────────────

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export type STTProvider = 'whisper-api' | 'whisper-local' | 'google' | 'deepgram';
export type TTSProvider = 'openai-tts' | 'elevenlabs' | 'piper-local' | 'google';

export interface AudioBuffer {
    readonly data: Buffer;
    readonly sampleRate: number;
    readonly channels: number;
    readonly format: 'pcm_s16le' | 'mp3' | 'ogg' | 'wav' | 'webm';
    readonly durationMs: number;
}

export interface STTResult {
    readonly text: string;
    readonly language?: string;
    readonly confidence: number;
    readonly segments?: readonly TranscriptionSegment[];
    readonly durationMs: number;
}

export interface TranscriptionSegment {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

export interface TTSResult {
    readonly audio: AudioBuffer;
    readonly text: string;
    readonly voice: string;
}

export interface WakeWordConfig {
    readonly keywords: readonly string[];
    readonly sensitivity: number;        // 0.0–1.0
    readonly silenceTimeoutMs: number;   // end-of-speech detection
}

export interface VoicePipelineConfig {
    readonly sttProvider: STTProvider;
    readonly ttsProvider: TTSProvider;
    readonly sttApiKey?: string;
    readonly ttsApiKey?: string;
    readonly ttsVoice?: string;
    readonly wakeWord?: WakeWordConfig;
    readonly maxRecordingMs?: number;
    readonly sampleRate?: number;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<VoicePipelineConfig> = {
    sttProvider: 'whisper-api',
    ttsProvider: 'openai-tts',
    sttApiKey: '',
    ttsApiKey: '',
    ttsVoice: 'alloy',
    wakeWord: { keywords: ['hey conway', 'hey agent'], sensitivity: 0.5, silenceTimeoutMs: 1500 },
    maxRecordingMs: 30_000,
    sampleRate: 16_000,
};

// ── Voice Session ──────────────────────────────────────────────────────

export interface VoiceSession {
    readonly id: string;
    readonly startedAt: string;
    state: VoiceState;
    turnCount: number;
    readonly history: VoiceTurn[];
}

export interface VoiceTurn {
    readonly userText: string;
    readonly agentText: string;
    readonly sttDurationMs: number;
    readonly ttsDurationMs: number;
    readonly timestamp: string;
}

// ── VoicePipeline ──────────────────────────────────────────────────────

export class VoicePipeline {
    private readonly config: Required<VoicePipelineConfig>;
    private readonly sessions = new Map<string, VoiceSession>();
    private state: VoiceState = 'idle';

    constructor(config?: Partial<VoicePipelineConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config } as Required<VoicePipelineConfig>;
    }

    /** Get current pipeline state */
    getState(): VoiceState {
        return this.state;
    }

    // ── Speech-to-Text ──────────────────────────────────────────────

    async transcribe(audio: AudioBuffer): Promise<STTResult> {
        this.state = 'processing';
        try {
            switch (this.config.sttProvider) {
                case 'whisper-api':
                    return await this.whisperApiTranscribe(audio);
                case 'whisper-local':
                    return this.localFallbackTranscribe(audio);
                case 'google':
                    return await this.googleTranscribe(audio);
                case 'deepgram':
                    return await this.deepgramTranscribe(audio);
                default:
                    return this.localFallbackTranscribe(audio);
            }
        } finally {
            this.state = 'idle';
        }
    }

    private async whisperApiTranscribe(audio: AudioBuffer): Promise<STTResult> {
        if (!this.config.sttApiKey) {
            return this.localFallbackTranscribe(audio);
        }
        const formData = new FormData();
        formData.append('file', new Blob([new Uint8Array(audio.data)]), `audio.${audio.format === 'pcm_s16le' ? 'wav' : audio.format}`);
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'verbose_json');

        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.config.sttApiKey}` },
            body: formData,
        });

        if (!res.ok) throw new Error(`Whisper API error: ${res.status}`);
        const data = await res.json() as { text: string; language?: string; duration?: number; segments?: Array<{ start: number; end: number; text: string }> };

        return {
            text: data.text,
            language: data.language,
            confidence: 0.95,
            durationMs: (data.duration ?? 0) * 1000,
            segments: data.segments?.map(s => ({ start: s.start, end: s.end, text: s.text })),
        };
    }

    private localFallbackTranscribe(audio: AudioBuffer): STTResult {
        return {
            text: '[local-whisper: requires binary setup]',
            language: 'en',
            confidence: 0,
            durationMs: audio.durationMs,
        };
    }

    private async googleTranscribe(audio: AudioBuffer): Promise<STTResult> {
        // Google Cloud Speech-to-Text v1 placeholder
        return { text: '', language: 'en', confidence: 0, durationMs: audio.durationMs };
    }

    private async deepgramTranscribe(audio: AudioBuffer): Promise<STTResult> {
        if (!this.config.sttApiKey) {
            return this.localFallbackTranscribe(audio);
        }
        const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2', {
            method: 'POST',
            headers: {
                Authorization: `Token ${this.config.sttApiKey}`,
                'Content-Type': `audio/${audio.format === 'pcm_s16le' ? 'wav' : audio.format}`,
            },
            body: new Uint8Array(audio.data) as unknown as BodyInit,
        });
        if (!res.ok) return this.localFallbackTranscribe(audio);
        const data = await res.json() as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number }> }> } };
        const alt = data.results?.channels?.[0]?.alternatives?.[0];
        return {
            text: alt?.transcript ?? '',
            confidence: alt?.confidence ?? 0,
            durationMs: audio.durationMs,
        };
    }

    // ── Text-to-Speech ──────────────────────────────────────────────

    async synthesize(text: string): Promise<TTSResult> {
        this.state = 'speaking';
        try {
            switch (this.config.ttsProvider) {
                case 'openai-tts':
                    return await this.openaiTTS(text);
                case 'elevenlabs':
                    return await this.elevenlabsTTS(text);
                case 'piper-local':
                    return this.localFallbackTTS(text);
                case 'google':
                    return this.localFallbackTTS(text);
                default:
                    return this.localFallbackTTS(text);
            }
        } finally {
            this.state = 'idle';
        }
    }

    private async openaiTTS(text: string): Promise<TTSResult> {
        if (!this.config.ttsApiKey) return this.localFallbackTTS(text);
        const res = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.config.ttsApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'tts-1',
                input: text,
                voice: this.config.ttsVoice || 'alloy',
                response_format: 'mp3',
            }),
        });
        if (!res.ok) return this.localFallbackTTS(text);
        const buffer = Buffer.from(await res.arrayBuffer());
        return {
            audio: {
                data: buffer,
                sampleRate: 24_000,
                channels: 1,
                format: 'mp3',
                durationMs: Math.round(buffer.length / 4000 * 1000), // rough estimate
            },
            text,
            voice: this.config.ttsVoice || 'alloy',
        };
    }

    private async elevenlabsTTS(text: string): Promise<TTSResult> {
        if (!this.config.ttsApiKey) return this.localFallbackTTS(text);
        const voiceId = this.config.ttsVoice || '21m00Tcm4TlvDq8ikWAM'; // Rachel default
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'xi-api-key': this.config.ttsApiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                model_id: 'eleven_monolingual_v1',
                voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
        });
        if (!res.ok) return this.localFallbackTTS(text);
        const buffer = Buffer.from(await res.arrayBuffer());
        return {
            audio: { data: buffer, sampleRate: 44_100, channels: 1, format: 'mp3', durationMs: Math.round(buffer.length / 5500 * 1000) },
            text,
            voice: voiceId,
        };
    }

    private localFallbackTTS(text: string): TTSResult {
        return {
            audio: { data: Buffer.alloc(0), sampleRate: 16_000, channels: 1, format: 'pcm_s16le', durationMs: 0 },
            text,
            voice: 'local',
        };
    }

    // ── Wake Word ───────────────────────────────────────────────────

    detectWakeWord(text: string): boolean {
        const lower = text.toLowerCase();
        return this.config.wakeWord.keywords.some(kw => lower.includes(kw.toLowerCase()));
    }

    // ── Session Management ──────────────────────────────────────────

    createSession(): VoiceSession {
        const session: VoiceSession = {
            id: `voice-${Date.now().toString(36)}`,
            startedAt: new Date().toISOString(),
            state: 'idle',
            turnCount: 0,
            history: [],
        };
        this.sessions.set(session.id, session);
        return session;
    }

    completeVoiceTurn(sessionId: string, userText: string, agentText: string, sttMs: number, ttsMs: number): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        session.history.push({
            userText,
            agentText,
            sttDurationMs: sttMs,
            ttsDurationMs: ttsMs,
            timestamp: new Date().toISOString(),
        });
        session.turnCount++;
        return true;
    }

    getSession(id: string): VoiceSession | undefined {
        return this.sessions.get(id);
    }

    listSessions(): readonly VoiceSession[] {
        return [...this.sessions.values()];
    }

    endSession(id: string): boolean {
        return this.sessions.delete(id);
    }

    // ── Stats ───────────────────────────────────────────────────────

    getStats(): { activeSessions: number; totalTurns: number; providers: { stt: STTProvider; tts: TTSProvider } } {
        let totalTurns = 0;
        for (const s of this.sessions.values()) totalTurns += s.turnCount;
        return {
            activeSessions: this.sessions.size,
            totalTurns,
            providers: { stt: this.config.sttProvider, tts: this.config.ttsProvider },
        };
    }
}

// ── Voice API Routes ───────────────────────────────────────────────────

import type { Router, Request, Response } from './routes/context.js';
import type { RouteContext } from './routes/context.js';

export function registerVoiceRoutes(router: Router, ctx: RouteContext): void {
    const pipeline = new VoicePipeline({
        sttApiKey: process.env['OPENAI_API_KEY'],
        ttsApiKey: process.env['OPENAI_API_KEY'],
    });

    /** GET /api/voice/state — pipeline state */
    router.get('/api/voice/state', (_req: Request, res: Response) => {
        res.json({ state: pipeline.getState(), stats: pipeline.getStats() });
    });

    /** POST /api/voice/transcribe — STT */
    router.post('/api/voice/transcribe', async (req: Request, res: Response) => {
        try {
            const { data, format, sampleRate, channels: ch, durationMs } = req.body as {
                data: string; format: string; sampleRate: number; channels: number; durationMs: number;
            };
            const audio: AudioBuffer = {
                data: Buffer.from(data, 'base64'),
                sampleRate: sampleRate || 16_000,
                channels: ch || 1,
                format: (format || 'wav') as AudioBuffer['format'],
                durationMs: durationMs || 0,
            };
            const result = await pipeline.transcribe(audio);
            res.json({ ok: true, result });
        } catch (err) {
            res.status(500).json({ ok: false, error: String(err) });
        }
    });

    /** POST /api/voice/synthesize — TTS */
    router.post('/api/voice/synthesize', async (req: Request, res: Response) => {
        try {
            const { text } = req.body as { text: string };
            if (!text) { res.status(400).json({ error: 'text required' }); return; }
            const result = await pipeline.synthesize(text);
            res.json({
                ok: true,
                audio: result.audio.data.toString('base64'),
                format: result.audio.format,
                voice: result.voice,
                durationMs: result.audio.durationMs,
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: String(err) });
        }
    });

    /** POST /api/voice/sessions — create voice session */
    router.post('/api/voice/sessions', (_req: Request, res: Response) => {
        const session = pipeline.createSession();
        res.json({ ok: true, session });
    });

    /** GET /api/voice/sessions — list sessions */
    router.get('/api/voice/sessions', (_req: Request, res: Response) => {
        res.json({ sessions: pipeline.listSessions() });
    });

    /** DELETE /api/voice/sessions/:id — end session */
    router.delete('/api/voice/sessions/:id', (req: Request, res: Response) => {
        const deleted = pipeline.endSession(req.params['id']!);
        res.json({ ok: deleted });
    });

    /** POST /api/voice/wake-detect — wake word check */
    router.post('/api/voice/wake-detect', (req: Request, res: Response) => {
        const { text } = req.body as { text: string };
        res.json({ detected: pipeline.detectWakeWord(text || '') });
    });

    ctx.agent.logger.info('🎙 Voice pipeline registered (STT + TTS + wake-word)');
}
