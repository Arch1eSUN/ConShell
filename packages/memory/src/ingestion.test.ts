/**
 * Tests for Memory Ingestion Engine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryIngestionEngine, type IngestionInput } from './ingestion.js';

// ── Mock repos ──────────────────────────────────────────────────────────

function createMockRepos() {
    return {
        working: { insert: vi.fn().mockReturnValue(1), findBySession: vi.fn().mockReturnValue([]), clearSession: vi.fn() },
        episodic: { insert: vi.fn().mockReturnValue(1), findTopByImportance: vi.fn().mockReturnValue([]), findBySession: vi.fn().mockReturnValue([]), delete: vi.fn() },
        semantic: { upsert: vi.fn().mockReturnValue(1), findByCategory: vi.fn().mockReturnValue([]), findByKey: vi.fn(), findAll: vi.fn().mockReturnValue([]), delete: vi.fn() },
        procedural: { upsert: vi.fn().mockReturnValue(1), findByName: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn(), findAll: vi.fn().mockReturnValue([]), delete: vi.fn() },
        relationship: { upsert: vi.fn().mockReturnValue(1), findByEntity: vi.fn(), findAll: vi.fn().mockReturnValue([]), delete: vi.fn() },
    };
}

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
} as any;

describe('MemoryIngestionEngine', () => {
    let repos: ReturnType<typeof createMockRepos>;
    let engine: MemoryIngestionEngine;

    beforeEach(() => {
        repos = createMockRepos();
        engine = new MemoryIngestionEngine(repos, mockLogger);
        vi.clearAllMocks();
    });

    const baseInput: IngestionInput = {
        sessionId: 'test-session',
        userMessage: 'How do I sort an array?',
        agentResponse: 'You can use Array.sort() in JavaScript.',
    };

    it('should always store in working memory', () => {
        const result = engine.ingest(baseInput);
        expect(repos.working.insert).toHaveBeenCalledOnce();
        expect(result.tiersUpdated).toContain('working');
        expect(result.entriesInserted).toBeGreaterThanOrEqual(1);
    });

    it('should store in episodic when importance is high enough', () => {
        const result = engine.ingest({
            ...baseInput,
            userMessage: 'There is a critical security bug in the authentication system',
            agentResponse: 'I see the vulnerability. Let me fix it immediately.',
        });
        expect(repos.episodic.insert).toHaveBeenCalled();
        expect(result.tiersUpdated).toContain('episodic');
    });

    it('should store in episodic when tool calls are present', () => {
        const result = engine.ingest({
            ...baseInput,
            toolCalls: ['search_web', 'read_file'],
        });
        expect(repos.episodic.insert).toHaveBeenCalled();
        expect(result.tiersUpdated).toContain('episodic');
    });

    it('should store procedural knowledge for how-to content', () => {
        const result = engine.ingest({
            ...baseInput,
            agentResponse: 'Step 1: Install Node.js\nStep 2: Run npm install\nStep 3: Start the server\nFinally, verify it works.',
        });
        expect(repos.procedural.upsert).toHaveBeenCalled();
        expect(result.tiersUpdated).toContain('procedural');
    });

    it('should store procedural knowledge for code blocks', () => {
        const result = engine.ingest({
            ...baseInput,
            agentResponse: 'Here is how:\n```javascript\nconst arr = [3,1,2];\narr.sort();\nconsole.log(arr);\n```',
        });
        expect(repos.procedural.upsert).toHaveBeenCalled();
    });

    it('should extract relationship info from name introduction', () => {
        const result = engine.ingest({
            ...baseInput,
            userMessage: 'My name is Archie and I like TypeScript',
            agentResponse: 'Nice to meet you, Archie!',
        });
        expect(repos.relationship.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                entityId: 'archie',
                entityType: 'user',
            }),
        );
        expect(result.tiersUpdated).toContain('relationship');
    });

    it('should extract relationship info from project mention', () => {
        const result = engine.ingest({
            ...baseInput,
            userMessage: "I'm working on ConShell right now",
            agentResponse: 'Great project!',
        });
        expect(repos.relationship.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                entityType: 'project',
            }),
        );
    });

    it('should return timing information', () => {
        const result = engine.ingest(baseInput);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty messages gracefully', () => {
        const result = engine.ingest({
            sessionId: 'empty-session',
            userMessage: '',
            agentResponse: '',
        });
        expect(result.entriesInserted).toBeGreaterThanOrEqual(1); // at least working memory
    });

    it('should classify topics correctly', () => {
        // coding topic
        engine.ingest({
            ...baseInput,
            userMessage: 'Fix this function error in my code',
            agentResponse: 'Here is the fix for the bug.',
            toolCalls: ['edit_file'],
        });
        const call = repos.episodic.insert.mock.calls[0]?.[0];
        expect(call?.classification).toBe('coding');
    });

    it('should use importanceHint when provided', () => {
        engine.ingest({
            ...baseInput,
            importanceHint: 9,
        });
        const call = repos.episodic.insert.mock.calls[0]?.[0];
        expect(call?.importance).toBe(9);
    });
});
