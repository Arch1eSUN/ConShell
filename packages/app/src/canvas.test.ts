/**
 * CanvasWorkspace Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { CanvasWorkspace } from './canvas.js';

describe('CanvasWorkspace', () => {
    function mkCanvas() {
        return new CanvasWorkspace();
    }

    describe('workspace management', () => {
        it('creates a workspace with a unique id', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('test-ws');
            expect(ws.id).toBeTruthy();
            expect(ws.name).toBe('test-ws');
            expect(ws.state).toBe('active');
        });

        it('creates a workspace with description', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('test-ws', 'A test workspace');
            expect(ws.description).toBe('A test workspace');
        });

        it('lists created workspaces', async () => {
            const canvas = mkCanvas();
            canvas.createWorkspace('alpha');
            // IDs use Date.now().toString(36) — tiny delay avoids collision
            await new Promise(r => setTimeout(r, 2));
            canvas.createWorkspace('beta');
            const list = canvas.listWorkspaces();
            expect(list).toHaveLength(2);
            expect(list.map(w => w.name)).toContain('alpha');
            expect(list.map(w => w.name)).toContain('beta');
        });

        it('gets a workspace by id', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('lookup');
            const found = canvas.getWorkspace(ws.id);
            expect(found).toBeDefined();
            expect(found!.name).toBe('lookup');
        });

        it('returns undefined for unknown workspace', () => {
            const canvas = mkCanvas();
            expect(canvas.getWorkspace('nonexistent')).toBeUndefined();
        });

        it('deletes a workspace', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('to-delete');
            expect(canvas.deleteWorkspace(ws.id)).toBe(true);
            // deleted workspaces are filtered from listing
            expect(canvas.listWorkspaces().find(w => w.id === ws.id)).toBeUndefined();
        });

        it('archives a workspace', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('to-archive');
            expect(canvas.archiveWorkspace(ws.id)).toBe(true);
            const found = canvas.getWorkspace(ws.id);
            expect(found!.state).toBe('archived');
        });
    });

    describe('artifact management', () => {
        it('creates an artifact in a workspace', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('art-ws');
            const artifact = canvas.createArtifact(ws.id, 'code', 'test.ts', 'console.log("hi")', { language: 'typescript' });
            expect(artifact.id).toBeTruthy();
            expect(artifact.title).toBe('test.ts');
            expect(artifact.type).toBe('code');
            expect(artifact.version).toBe(1);
        });

        it('throws for unknown workspace', () => {
            const canvas = mkCanvas();
            expect(() => canvas.createArtifact('bad-id', 'markdown', 'test', '# hi'))
                .toThrow();
        });

        it('updates an artifact content', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('update-ws');
            const art = canvas.createArtifact(ws.id, 'code', 'v1', 'old');
            const updated = canvas.updateArtifact(art.id, 'new');
            expect(updated.content).toBe('new');
            expect(updated.version).toBe(2);
        });

        it('lists artifacts in a workspace', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('list-ws');
            canvas.createArtifact(ws.id, 'code', 'a', '1');
            canvas.createArtifact(ws.id, 'markdown', 'b', '2');
            const arts = canvas.listArtifacts(ws.id);
            expect(arts).toHaveLength(2);
        });

        it('deletes an artifact', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('del-ws');
            const art = canvas.createArtifact(ws.id, 'code', 'x', 'y');
            expect(canvas.deleteArtifact(art.id)).toBe(true);
            expect(canvas.listArtifacts(ws.id)).toHaveLength(0);
        });

        it('gets version history', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('hist-ws');
            const art = canvas.createArtifact(ws.id, 'code', 'h', 'v1');
            canvas.updateArtifact(art.id, 'v2');
            const history = canvas.getVersionHistory(art.id);
            expect(history).toHaveLength(2);
        });
    });

    describe('search', () => {
        it('searches artifacts by keyword', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('search-ws');
            canvas.createArtifact(ws.id, 'code', 'hello world', 'print');
            canvas.createArtifact(ws.id, 'code', 'goodbye', 'exit');
            const results = canvas.searchArtifacts('hello');
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0]!.title).toContain('hello');
        });
    });

    describe('export', () => {
        it('exports artifact as raw', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('export-ws');
            const art = canvas.createArtifact(ws.id, 'code', 'raw', 'data');
            const exported = canvas.exportArtifact(art.id, 'raw');
            expect(exported).toBe('data');
        });

        it('exports artifact as json', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('export-ws');
            const art = canvas.createArtifact(ws.id, 'code', 'json-test', 'code');
            const exported = canvas.exportArtifact(art.id, 'json');
            const parsed = JSON.parse(exported);
            expect(parsed.title).toBe('json-test');
        });
    });

    describe('stats', () => {
        it('returns correct counts', () => {
            const canvas = mkCanvas();
            const ws = canvas.createWorkspace('stats-ws');
            canvas.createArtifact(ws.id, 'code', 'a', 'b');
            const stats = canvas.getStats();
            expect(stats.workspaces).toBe(1);
            expect(stats.artifacts).toBe(1);
            expect(stats.totalVersions).toBe(1);
        });
    });
});
