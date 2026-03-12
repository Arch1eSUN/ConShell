/**
 * VoicePipeline Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { VoicePipeline } from './voice.js';

describe('VoicePipeline', () => {
    function mkPipeline() {
        return new VoicePipeline({
            sttProvider: 'whisper-local',
            ttsProvider: 'piper-local',
            wakeWord: {
                keywords: ['hey conshell'],
                sensitivity: 0.7,
                silenceTimeoutMs: 1500,
            },
        });
    }

    describe('lifecycle', () => {
        it('starts in idle state', () => {
            const pipeline = mkPipeline();
            expect(pipeline.getState()).toBe('idle');
        });

        it('getStats returns pipeline statistics', () => {
            const pipeline = mkPipeline();
            const stats = pipeline.getStats();
            expect(stats.activeSessions).toBe(0);
            expect(stats.totalTurns).toBe(0);
            expect(stats.providers.stt).toBe('whisper-local');
            expect(stats.providers.tts).toBe('piper-local');
        });
    });

    describe('sessions', () => {
        it('creates a voice session', () => {
            const pipeline = mkPipeline();
            const session = pipeline.createSession();
            expect(session.id).toBeTruthy();
            expect(session.history).toHaveLength(0);
            expect(session.turnCount).toBe(0);
        });

        it('lists all sessions', async () => {
            const pipeline = mkPipeline();
            pipeline.createSession();
            // IDs use Date.now().toString(36) — tiny delay avoids collision
            await new Promise(r => setTimeout(r, 2));
            pipeline.createSession();
            const sessions = pipeline.listSessions();
            expect(sessions).toHaveLength(2);
        });

        it('gets a session by id', () => {
            const pipeline = mkPipeline();
            const session = pipeline.createSession();
            const found = pipeline.getSession(session.id);
            expect(found).toBeDefined();
            expect(found!.id).toBe(session.id);
        });

        it('ends a session', () => {
            const pipeline = mkPipeline();
            const session = pipeline.createSession();
            expect(pipeline.endSession(session.id)).toBe(true);
            expect(pipeline.listSessions().find(s => s.id === session.id)).toBeUndefined();
        });

        it('returns false for ending unknown session', () => {
            const pipeline = mkPipeline();
            expect(pipeline.endSession('nonexistent')).toBe(false);
        });

        it('completes a voice turn', () => {
            const pipeline = mkPipeline();
            const session = pipeline.createSession();
            const ok = pipeline.completeVoiceTurn(session.id, 'hello', 'hi there', 200, 300);
            expect(ok).toBe(true);
            const updated = pipeline.getSession(session.id)!;
            expect(updated.turnCount).toBe(1);
            expect(updated.history).toHaveLength(1);
            expect(updated.history[0]!.userText).toBe('hello');
        });
    });

    describe('wake word', () => {
        it('detects wake word in text', () => {
            const pipeline = mkPipeline();
            const result = pipeline.detectWakeWord('hey conshell, do something');
            expect(result).toBe(true);
        });

        it('does not detect absent wake word', () => {
            const pipeline = mkPipeline();
            const result = pipeline.detectWakeWord('random text here');
            expect(result).toBe(false);
        });

        it('uses default keywords', () => {
            const pipeline = new VoicePipeline(); // default config
            expect(pipeline.detectWakeWord('hey conway')).toBe(true);
            expect(pipeline.detectWakeWord('hey agent')).toBe(true);
        });
    });
});
