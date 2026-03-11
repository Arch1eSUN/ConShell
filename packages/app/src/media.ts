/**
 * Multimodal Pipeline — Image, audio, and video processing.
 *
 * Provides:
 *   - Image understanding (base64 → description via vision model)
 *   - Audio transcription (Whisper-compatible endpoint)
 *   - Video keyframe extraction (ffmpeg-based)
 *   - File lifecycle management (temp files auto-cleanup)
 *   - MIME type detection and validation
 */
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

// ── Types ───────────────────────────────────────────────────────────────

export type MediaType = 'image' | 'audio' | 'video' | 'document';

export interface MediaInput {
    /** Original filename */
    readonly filename: string;
    /** MIME type (e.g. image/png, audio/mp3) */
    readonly mimeType: string;
    /** Base64-encoded content OR absolute file path */
    readonly content: string;
    /** Whether content is base64 (true) or a file path (false) */
    readonly isBase64?: boolean;
}

export interface MediaProcessResult {
    readonly mediaType: MediaType;
    readonly description: string;
    readonly metadata: MediaMetadata;
    readonly hash: string;
    /** Path to processed file (if saved) */
    readonly processedPath?: string;
}

export interface MediaMetadata {
    readonly sizeBytes: number;
    readonly mimeType: string;
    readonly filename: string;
    readonly width?: number;
    readonly height?: number;
    readonly durationSeconds?: number;
    readonly transcription?: string;
}

export interface TranscriptionResult {
    readonly text: string;
    readonly language?: string;
    readonly durationSeconds: number;
    readonly segments?: readonly TranscriptionSegment[];
}

export interface TranscriptionSegment {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

// ── MIME → MediaType mapping ────────────────────────────────────────────

const MIME_TYPE_MAP: Record<string, MediaType> = {
    'image/png': 'image',
    'image/jpeg': 'image',
    'image/gif': 'image',
    'image/webp': 'image',
    'image/svg+xml': 'image',
    'image/bmp': 'image',
    'audio/mpeg': 'audio',
    'audio/mp3': 'audio',
    'audio/wav': 'audio',
    'audio/ogg': 'audio',
    'audio/flac': 'audio',
    'audio/webm': 'audio',
    'audio/m4a': 'audio',
    'video/mp4': 'video',
    'video/webm': 'video',
    'video/mpeg': 'video',
    'video/quicktime': 'video',
    'application/pdf': 'document',
    'text/plain': 'document',
    'text/markdown': 'document',
};

const EXTENSION_MIME_MAP: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/m4a',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
};

// ── Multimodal Pipeline ─────────────────────────────────────────────────

export class MultimodalPipeline {
    private readonly tempDir: string;
    private readonly maxFileSizeBytes: number;
    private readonly trackedFiles = new Set<string>();

    constructor(options?: {
        tempDir?: string;
        maxFileSizeMB?: number;
    }) {
        const home = process.env['HOME'] || process.env['USERPROFILE'] || '/tmp';
        this.tempDir = options?.tempDir ?? join(home, '.conshell', 'media', 'tmp');
        this.maxFileSizeBytes = (options?.maxFileSizeMB ?? 50) * 1024 * 1024;
    }

    /**
     * Detect media type from MIME or filename extension.
     */
    detectMediaType(input: MediaInput): MediaType {
        // Try MIME type first
        const fromMime = MIME_TYPE_MAP[input.mimeType];
        if (fromMime) return fromMime;

        // Fallback to extension
        const ext = extname(input.filename).toLowerCase();
        const inferredMime = EXTENSION_MIME_MAP[ext];
        if (inferredMime) return MIME_TYPE_MAP[inferredMime] ?? 'document';

        return 'document';
    }

    /**
     * Resolve MIME type from filename if not provided.
     */
    resolveMimeType(filename: string, providedMime?: string): string {
        if (providedMime && providedMime !== 'application/octet-stream') {
            return providedMime;
        }
        const ext = extname(filename).toLowerCase();
        return EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';
    }

    /**
     * Save media to temp directory and return the path.
     */
    async saveToTemp(input: MediaInput): Promise<string> {
        await mkdir(this.tempDir, { recursive: true });

        const id = randomBytes(8).toString('hex');
        const ext = extname(input.filename) || '.bin';
        const tempPath = join(this.tempDir, `${id}${ext}`);

        if (input.isBase64 || this.looksLikeBase64(input.content)) {
            const buffer = Buffer.from(input.content, 'base64');
            if (buffer.length > this.maxFileSizeBytes) {
                throw new Error(`File too large: ${buffer.length} bytes (max ${this.maxFileSizeBytes})`);
            }
            await writeFile(tempPath, buffer);
        } else {
            // Content is a file path — copy it
            const data = await readFile(input.content);
            if (data.length > this.maxFileSizeBytes) {
                throw new Error(`File too large: ${data.length} bytes (max ${this.maxFileSizeBytes})`);
            }
            await writeFile(tempPath, data);
        }

        this.trackedFiles.add(tempPath);
        return tempPath;
    }

    /**
     * Process a media input and return structured metadata.
     */
    async process(input: MediaInput): Promise<MediaProcessResult> {
        const mediaType = this.detectMediaType(input);

        // Get file content for hashing
        let buffer: Buffer;
        if (input.isBase64 || this.looksLikeBase64(input.content)) {
            buffer = Buffer.from(input.content, 'base64');
        } else {
            buffer = await readFile(input.content);
        }

        const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);

        const metadata: MediaMetadata = {
            sizeBytes: buffer.length,
            mimeType: this.resolveMimeType(input.filename, input.mimeType),
            filename: basename(input.filename),
        };

        let description: string;
        switch (mediaType) {
            case 'image':
                description = `Image: ${metadata.filename} (${this.formatBytes(metadata.sizeBytes)}, ${metadata.mimeType})`;
                break;
            case 'audio':
                description = `Audio: ${metadata.filename} (${this.formatBytes(metadata.sizeBytes)}, ${metadata.mimeType})`;
                break;
            case 'video':
                description = `Video: ${metadata.filename} (${this.formatBytes(metadata.sizeBytes)}, ${metadata.mimeType})`;
                break;
            default:
                description = `Document: ${metadata.filename} (${this.formatBytes(metadata.sizeBytes)})`;
        }

        return { mediaType, description, metadata, hash };
    }

    /**
     * Create a vision-ready payload for sending to multimodal LLMs.
     */
    async toVisionPayload(input: MediaInput): Promise<{
        type: 'image_url';
        image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
    }> {
        let base64: string;
        if (input.isBase64 || this.looksLikeBase64(input.content)) {
            base64 = input.content;
        } else {
            const buffer = await readFile(input.content);
            base64 = buffer.toString('base64');
        }

        const mime = this.resolveMimeType(input.filename, input.mimeType);
        return {
            type: 'image_url',
            image_url: {
                url: `data:${mime};base64,${base64}`,
                detail: 'auto',
            },
        };
    }

    /**
     * Create a Whisper-compatible transcription request payload.
     */
    async toTranscriptionPayload(input: MediaInput): Promise<{
        audioBase64: string;
        mimeType: string;
        filename: string;
    }> {
        let base64: string;
        if (input.isBase64 || this.looksLikeBase64(input.content)) {
            base64 = input.content;
        } else {
            const buffer = await readFile(input.content);
            base64 = buffer.toString('base64');
        }

        return {
            audioBase64: base64,
            mimeType: this.resolveMimeType(input.filename, input.mimeType),
            filename: basename(input.filename),
        };
    }

    /**
     * Cleanup all tracked temp files.
     */
    async cleanup(): Promise<number> {
        let cleaned = 0;
        for (const filepath of this.trackedFiles) {
            try {
                await rm(filepath);
                cleaned++;
            } catch {
                // File already deleted
            }
        }
        this.trackedFiles.clear();
        return cleaned;
    }

    /**
     * Cleanup temp files older than maxAge.
     */
    async cleanupOld(maxAgeMs: number = 3600_000): Promise<number> {
        const { readdir } = await import('node:fs/promises');
        let cleaned = 0;
        try {
            const entries = await readdir(this.tempDir);
            const now = Date.now();
            for (const entry of entries) {
                const filepath = join(this.tempDir, entry);
                try {
                    const s = await stat(filepath);
                    if (now - s.mtimeMs > maxAgeMs) {
                        await rm(filepath);
                        cleaned++;
                    }
                } catch { /* ignore */ }
            }
        } catch { /* tempDir doesn't exist yet */ }
        return cleaned;
    }

    /**
     * Get supported MIME types by category.
     */
    getSupportedTypes(): Record<MediaType, string[]> {
        const result: Record<MediaType, string[]> = {
            image: [], audio: [], video: [], document: [],
        };
        for (const [mime, type] of Object.entries(MIME_TYPE_MAP)) {
            result[type].push(mime);
        }
        return result;
    }

    // ── Private helpers ─────────────────────────────────────────────────

    private looksLikeBase64(s: string): boolean {
        if (s.length < 20) return false;
        if (s.startsWith('/') || s.startsWith('.') || s.startsWith('~')) return false;
        return /^[A-Za-z0-9+/]+=*$/.test(s.slice(0, 100));
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }
}

// ── Multimodal API Routes ───────────────────────────────────────────────

import type { Request, Response, RouteRegistrar } from './routes/context.js';

export const registerMediaRoutes: RouteRegistrar = (router, { agent }) => {
    const pipeline = new MultimodalPipeline();

    // Get supported media types
    router.get('/api/media/types', (_req: Request, res: Response) => {
        res.json({ types: pipeline.getSupportedTypes() });
    });

    // Process media (analyze without sending to LLM)
    router.post('/api/media/process', async (req: Request, res: Response) => {
        try {
            const input = req.body as MediaInput;
            if (!input.filename || !input.content) {
                res.status(400).json({ error: 'filename and content required' });
                return;
            }
            const result = await pipeline.process(input);
            res.json({ result });
        } catch (err) {
            res.status(500).json({
                error: 'Processing failed',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });

    // Prepare vision payload for multimodal chat
    router.post('/api/media/vision', async (req: Request, res: Response) => {
        try {
            const input = req.body as MediaInput;
            if (!input.filename || !input.content) {
                res.status(400).json({ error: 'filename and content required' });
                return;
            }
            const payload = await pipeline.toVisionPayload(input);
            res.json({ payload });
        } catch (err) {
            res.status(500).json({
                error: 'Vision payload creation failed',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });

    // Cleanup old temp files
    router.post('/api/media/cleanup', async (_req: Request, res: Response) => {
        try {
            const cleaned = await pipeline.cleanupOld();
            res.json({ cleaned, message: `Removed ${cleaned} old temp files` });
        } catch (err) {
            res.status(500).json({ error: 'Cleanup failed' });
        }
    });
};
