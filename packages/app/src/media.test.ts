/**
 * MultimodalPipeline Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { MultimodalPipeline } from './media.js';

describe('MultimodalPipeline', () => {
    function mkPipeline() {
        return new MultimodalPipeline({ tempDir: '/tmp/conshell-media-test', maxFileSizeMB: 10 });
    }

    describe('media type detection', () => {
        it('detects image type from MIME', () => {
            const pipeline = mkPipeline();
            expect(pipeline.detectMediaType({ filename: 'photo.jpg', mimeType: 'image/jpeg', content: '' })).toBe('image');
            expect(pipeline.detectMediaType({ filename: 'photo.png', mimeType: 'image/png', content: '' })).toBe('image');
        });

        it('detects audio type from MIME', () => {
            const pipeline = mkPipeline();
            expect(pipeline.detectMediaType({ filename: 'song.mp3', mimeType: 'audio/mpeg', content: '' })).toBe('audio');
        });

        it('detects video type from MIME', () => {
            const pipeline = mkPipeline();
            expect(pipeline.detectMediaType({ filename: 'clip.mp4', mimeType: 'video/mp4', content: '' })).toBe('video');
        });

        it('detects document type from MIME', () => {
            const pipeline = mkPipeline();
            expect(pipeline.detectMediaType({ filename: 'doc.pdf', mimeType: 'application/pdf', content: '' })).toBe('document');
        });

        it('falls back to extension when MIME is unknown', () => {
            const pipeline = mkPipeline();
            expect(pipeline.detectMediaType({ filename: 'photo.jpg', mimeType: 'application/octet-stream', content: '' })).toBe('image');
        });

        it('defaults to document for unknown types', () => {
            const pipeline = mkPipeline();
            expect(pipeline.detectMediaType({ filename: 'file.xyz', mimeType: 'application/octet-stream', content: '' })).toBe('document');
        });
    });

    describe('MIME resolution', () => {
        it('resolves MIME from extension', () => {
            const pipeline = mkPipeline();
            expect(pipeline.resolveMimeType('test.png')).toBe('image/png');
            expect(pipeline.resolveMimeType('test.mp3')).toBe('audio/mpeg');
        });

        it('returns provided MIME if valid', () => {
            const pipeline = mkPipeline();
            expect(pipeline.resolveMimeType('test.bin', 'image/webp')).toBe('image/webp');
        });

        it('returns octet-stream for unknown extensions', () => {
            const pipeline = mkPipeline();
            expect(pipeline.resolveMimeType('test.xyz')).toBe('application/octet-stream');
        });
    });

    describe('supported types', () => {
        it('returns all four media type categories', () => {
            const pipeline = mkPipeline();
            const types = pipeline.getSupportedTypes();
            expect(types.image.length).toBeGreaterThan(0);
            expect(types.audio.length).toBeGreaterThan(0);
            expect(types.video.length).toBeGreaterThan(0);
            expect(types.document.length).toBeGreaterThan(0);
        });
    });

    describe('cleanup', () => {
        it('cleanup returns number of cleaned files', async () => {
            const pipeline = mkPipeline();
            const result = await pipeline.cleanup();
            expect(typeof result).toBe('number');
            expect(result).toBe(0); // no tracked files
        });
    });
});
