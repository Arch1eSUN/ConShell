/**
 * Canvas Workspace — A2UI visual workspace for agent artifact management.
 *
 * Modelled after OpenClaw's Canvas capability:
 *   - Artifact creation (code, markdown, diagrams, images)
 *   - Version history with diff tracking
 *   - Real-time collaborative editing (via WebSocket)
 *   - Export to multiple formats
 *   - Workspace sessions with persistence
 *
 * A2UI = Agent-to-UI: the agent can create visual artifacts that
 * render in the dashboard workspace panel.
 */

// ── Types ──────────────────────────────────────────────────────────────

export type ArtifactType = 'code' | 'markdown' | 'diagram' | 'image' | 'table' | 'chart' | 'html';
export type WorkspaceState = 'active' | 'archived' | 'deleted';

export interface Artifact {
    readonly id: string;
    readonly workspaceId: string;
    type: ArtifactType;
    title: string;
    content: string;
    /** Language hint for code artifacts */
    language?: string;
    /** Version counter */
    version: number;
    readonly createdAt: string;
    updatedAt: string;
    /** Source — who created this artifact */
    source: 'agent' | 'user' | 'system';
    metadata?: Record<string, unknown>;
}

export interface ArtifactVersion {
    readonly artifactId: string;
    readonly version: number;
    readonly content: string;
    readonly diff?: string;
    readonly timestamp: string;
    readonly author: 'agent' | 'user';
}

export interface Workspace {
    readonly id: string;
    name: string;
    description?: string;
    state: WorkspaceState;
    readonly createdAt: string;
    updatedAt: string;
    artifactCount: number;
}

export interface CanvasConfig {
    readonly maxArtifactsPerWorkspace?: number;
    readonly maxVersionHistory?: number;
    readonly maxContentSizeBytes?: number;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<CanvasConfig> = {
    maxArtifactsPerWorkspace: 50,
    maxVersionHistory: 20,
    maxContentSizeBytes: 1_000_000, // 1MB
};

// ── CanvasWorkspace ────────────────────────────────────────────────────

export class CanvasWorkspace {
    private readonly config: Required<CanvasConfig>;
    private readonly workspaces = new Map<string, Workspace>();
    private readonly artifacts = new Map<string, Artifact>();
    private readonly versions = new Map<string, ArtifactVersion[]>();

    constructor(config?: CanvasConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ── Workspace Management ────────────────────────────────────────

    createWorkspace(name: string, description?: string): Workspace {
        const ws: Workspace = {
            id: `ws-${Date.now().toString(36)}`,
            name,
            description,
            state: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            artifactCount: 0,
        };
        this.workspaces.set(ws.id, ws);
        return ws;
    }

    getWorkspace(id: string): Workspace | undefined {
        return this.workspaces.get(id);
    }

    listWorkspaces(): readonly Workspace[] {
        return [...this.workspaces.values()].filter(w => w.state !== 'deleted');
    }

    archiveWorkspace(id: string): boolean {
        const ws = this.workspaces.get(id);
        if (!ws) return false;
        ws.state = 'archived';
        ws.updatedAt = new Date().toISOString();
        return true;
    }

    deleteWorkspace(id: string): boolean {
        const ws = this.workspaces.get(id);
        if (!ws) return false;
        ws.state = 'deleted';
        // Cascade-delete artifacts
        for (const [artId, art] of this.artifacts) {
            if (art.workspaceId === id) {
                this.artifacts.delete(artId);
                this.versions.delete(artId);
            }
        }
        return true;
    }

    // ── Artifact Management ─────────────────────────────────────────

    createArtifact(
        workspaceId: string,
        type: ArtifactType,
        title: string,
        content: string,
        options?: { language?: string; source?: Artifact['source']; metadata?: Record<string, unknown> },
    ): Artifact {
        const ws = this.workspaces.get(workspaceId);
        if (!ws || ws.state !== 'active') throw new Error(`Workspace not found or not active: ${workspaceId}`);

        const wsArtifacts = this.listArtifacts(workspaceId);
        if (wsArtifacts.length >= this.config.maxArtifactsPerWorkspace) {
            throw new Error(`Max ${this.config.maxArtifactsPerWorkspace} artifacts per workspace`);
        }

        if (Buffer.byteLength(content) > this.config.maxContentSizeBytes) {
            throw new Error(`Content exceeds max size of ${this.config.maxContentSizeBytes} bytes`);
        }

        const now = new Date().toISOString();
        const artifact: Artifact = {
            id: `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            workspaceId,
            type,
            title,
            content,
            language: options?.language,
            version: 1,
            createdAt: now,
            updatedAt: now,
            source: options?.source ?? 'agent',
            metadata: options?.metadata,
        };

        this.artifacts.set(artifact.id, artifact);
        this.versions.set(artifact.id, [{
            artifactId: artifact.id,
            version: 1,
            content,
            timestamp: now,
            author: artifact.source === 'user' ? 'user' : 'agent',
        }]);

        ws.artifactCount++;
        ws.updatedAt = now;
        return artifact;
    }

    updateArtifact(id: string, content: string, author: 'agent' | 'user' = 'agent'): Artifact {
        const artifact = this.artifacts.get(id);
        if (!artifact) throw new Error(`Artifact not found: ${id}`);

        if (Buffer.byteLength(content) > this.config.maxContentSizeBytes) {
            throw new Error(`Content exceeds max size`);
        }

        // Create diff (simple line-based)
        const diff = this.computeDiff(artifact.content, content);

        artifact.version++;
        artifact.content = content;
        artifact.updatedAt = new Date().toISOString();

        // Store version
        const history = this.versions.get(id) ?? [];
        history.push({
            artifactId: id,
            version: artifact.version,
            content,
            diff,
            timestamp: artifact.updatedAt,
            author,
        });

        // Trim history
        if (history.length > this.config.maxVersionHistory) {
            history.splice(0, history.length - this.config.maxVersionHistory);
        }
        this.versions.set(id, history);

        return artifact;
    }

    getArtifact(id: string): Artifact | undefined {
        return this.artifacts.get(id);
    }

    listArtifacts(workspaceId: string): readonly Artifact[] {
        return [...this.artifacts.values()].filter(a => a.workspaceId === workspaceId);
    }

    getVersionHistory(artifactId: string): readonly ArtifactVersion[] {
        return this.versions.get(artifactId) ?? [];
    }

    deleteArtifact(id: string): boolean {
        const artifact = this.artifacts.get(id);
        if (!artifact) return false;
        const ws = this.workspaces.get(artifact.workspaceId);
        if (ws) {
            ws.artifactCount = Math.max(0, ws.artifactCount - 1);
        }
        this.artifacts.delete(id);
        this.versions.delete(id);
        return true;
    }

    // ── Search ──────────────────────────────────────────────────────

    searchArtifacts(query: string): readonly Artifact[] {
        const lower = query.toLowerCase();
        return [...this.artifacts.values()].filter(a =>
            a.title.toLowerCase().includes(lower) ||
            a.content.toLowerCase().includes(lower)
        );
    }

    // ── Export ───────────────────────────────────────────────────────

    exportArtifact(id: string, format: 'raw' | 'html' | 'json'): string {
        const artifact = this.artifacts.get(id);
        if (!artifact) throw new Error(`Artifact not found: ${id}`);

        switch (format) {
            case 'raw':
                return artifact.content;
            case 'json':
                return JSON.stringify(artifact, null, 2);
            case 'html':
                return this.toHtml(artifact);
        }
    }

    private toHtml(artifact: Artifact): string {
        const escaped = artifact.content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        if (artifact.type === 'code') {
            return `<pre><code class="language-${artifact.language ?? 'text'}">${escaped}</code></pre>`;
        }
        if (artifact.type === 'html') {
            return artifact.content; // Already HTML
        }
        return `<div class="artifact artifact-${artifact.type}"><h3>${artifact.title}</h3><div>${escaped}</div></div>`;
    }

    // ── Stats ───────────────────────────────────────────────────────

    getStats(): { workspaces: number; artifacts: number; totalVersions: number } {
        let totalVersions = 0;
        for (const v of this.versions.values()) totalVersions += v.length;
        return {
            workspaces: [...this.workspaces.values()].filter(w => w.state !== 'deleted').length,
            artifacts: this.artifacts.size,
            totalVersions,
        };
    }

    // ── Private ─────────────────────────────────────────────────────

    private computeDiff(oldContent: string, newContent: string): string {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        const result: string[] = [];

        const maxLen = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < maxLen; i++) {
            const oldLine = oldLines[i];
            const newLine = newLines[i];
            if (oldLine === newLine) continue;
            if (oldLine !== undefined && newLine === undefined) {
                result.push(`-${i + 1}: ${oldLine}`);
            } else if (oldLine === undefined && newLine !== undefined) {
                result.push(`+${i + 1}: ${newLine}`);
            } else {
                result.push(`-${i + 1}: ${oldLine}`);
                result.push(`+${i + 1}: ${newLine}`);
            }
        }
        return result.join('\n');
    }
}

// ── Canvas API Routes ──────────────────────────────────────────────────

import type { Router, Request, Response } from './routes/context.js';
import type { RouteContext } from './routes/context.js';

export function registerCanvasRoutes(router: Router, ctx: RouteContext): void {
    const canvas = new CanvasWorkspace();

    /** GET /api/canvas/stats */
    router.get('/api/canvas/stats', (_req: Request, res: Response) => {
        res.json(canvas.getStats());
    });

    /** POST /api/canvas/workspaces — create workspace */
    router.post('/api/canvas/workspaces', (req: Request, res: Response) => {
        const { name, description } = req.body as { name: string; description?: string };
        if (!name) { res.status(400).json({ error: 'name required' }); return; }
        const ws = canvas.createWorkspace(name, description);
        res.json({ ok: true, workspace: ws });
    });

    /** GET /api/canvas/workspaces — list workspaces */
    router.get('/api/canvas/workspaces', (_req: Request, res: Response) => {
        res.json({ workspaces: canvas.listWorkspaces() });
    });

    /** GET /api/canvas/workspaces/:id — get workspace */
    router.get('/api/canvas/workspaces/:id', (req: Request, res: Response) => {
        const ws = canvas.getWorkspace(req.params['id']!);
        if (!ws) { res.status(404).json({ error: 'not found' }); return; }
        res.json({ workspace: ws, artifacts: canvas.listArtifacts(ws.id) });
    });

    /** DELETE /api/canvas/workspaces/:id — delete workspace */
    router.delete('/api/canvas/workspaces/:id', (req: Request, res: Response) => {
        res.json({ ok: canvas.deleteWorkspace(req.params['id']!) });
    });

    /** POST /api/canvas/artifacts — create artifact */
    router.post('/api/canvas/artifacts', (req: Request, res: Response) => {
        try {
            const { workspaceId, type, title, content, language, source } = req.body as {
                workspaceId: string; type: ArtifactType; title: string; content: string; language?: string; source?: Artifact['source'];
            };
            if (!workspaceId || !type || !title) {
                res.status(400).json({ error: 'workspaceId, type, title required' }); return;
            }
            const artifact = canvas.createArtifact(workspaceId, type, title, content || '', { language, source });
            res.json({ ok: true, artifact });
        } catch (err) {
            res.status(400).json({ error: String(err) });
        }
    });

    /** PUT /api/canvas/artifacts/:id — update artifact */
    router.put('/api/canvas/artifacts/:id', (req: Request, res: Response) => {
        try {
            const { content, author } = req.body as { content: string; author?: 'agent' | 'user' };
            const artifact = canvas.updateArtifact(req.params['id']!, content, author);
            res.json({ ok: true, artifact });
        } catch (err) {
            res.status(400).json({ error: String(err) });
        }
    });

    /** GET /api/canvas/artifacts/:id — get artifact */
    router.get('/api/canvas/artifacts/:id', (req: Request, res: Response) => {
        const artifact = canvas.getArtifact(req.params['id']!);
        if (!artifact) { res.status(404).json({ error: 'not found' }); return; }
        res.json({ artifact });
    });

    /** GET /api/canvas/artifacts/:id/history — version history */
    router.get('/api/canvas/artifacts/:id/history', (req: Request, res: Response) => {
        res.json({ versions: canvas.getVersionHistory(req.params['id']!) });
    });

    /** DELETE /api/canvas/artifacts/:id — delete artifact */
    router.delete('/api/canvas/artifacts/:id', (req: Request, res: Response) => {
        res.json({ ok: canvas.deleteArtifact(req.params['id']!) });
    });

    /** GET /api/canvas/search?q=... — search artifacts */
    router.get('/api/canvas/search', (req: Request, res: Response) => {
        const q = (req.query?.['q'] as string) || '';
        res.json({ results: canvas.searchArtifacts(q) });
    });

    /** GET /api/canvas/artifacts/:id/export?format=... — export */
    router.get('/api/canvas/artifacts/:id/export', (req: Request, res: Response) => {
        try {
            const format = (req.query?.['format'] as 'raw' | 'html' | 'json') || 'raw';
            const exported = canvas.exportArtifact(req.params['id']!, format);
            if (format === 'html') {
                res.setHeader('Content-Type', 'text/html');
            }
            res.send(exported);
        } catch (err) {
            res.status(404).json({ error: String(err) });
        }
    });

    ctx.agent.logger.info('🎨 Canvas workspace registered (A2UI visual artifacts)');
}
