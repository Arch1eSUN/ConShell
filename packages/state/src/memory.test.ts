import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestLogger } from '@web4-agent/core';
import { openTestDatabase } from '@web4-agent/state';
import {
    WorkingMemoryRepository,
    EpisodicMemoryRepository,
    SemanticMemoryRepository,
    ProceduralMemoryRepository,
    RelationshipMemoryRepository,
    SoulHistoryRepository,
    SessionSummariesRepository,
} from '@web4-agent/state';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
    const { logger } = createTestLogger();
    db = openTestDatabase(logger);
});

afterEach(() => {
    db.close();
});

// ═══════════════════════════════════════════════════════════════════════
// WorkingMemoryRepository
// ═══════════════════════════════════════════════════════════════════════

describe('WorkingMemoryRepository', () => {
    it('insert and findBySession', () => {
        const repo = new WorkingMemoryRepository(db);
        repo.insert({ sessionId: 's1', type: 'goal', content: 'learn TypeScript' });
        repo.insert({ sessionId: 's1', type: 'observation', content: 'project uses vitest' });
        repo.insert({ sessionId: 's2', type: 'goal', content: 'unrelated' });

        const s1 = repo.findBySession('s1');
        expect(s1.length).toBe(2);
        expect(s1[0]!.type).toBe('goal');
        expect(s1[1]!.content).toBe('project uses vitest');

        const s2 = repo.findBySession('s2');
        expect(s2.length).toBe(1);
    });

    it('clearSession removes only target session', () => {
        const repo = new WorkingMemoryRepository(db);
        repo.insert({ sessionId: 's1', type: 'x', content: 'data' });
        repo.insert({ sessionId: 's2', type: 'y', content: 'other' });

        const count = repo.clearSession('s1');
        expect(count).toBe(1);
        expect(repo.findBySession('s1').length).toBe(0);
        expect(repo.findBySession('s2').length).toBe(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// EpisodicMemoryRepository
// ═══════════════════════════════════════════════════════════════════════

describe('EpisodicMemoryRepository', () => {
    it('insert and findTopByImportance', () => {
        const repo = new EpisodicMemoryRepository(db);
        repo.insert({ eventType: 'task_complete', content: 'built module', importance: 8 });
        repo.insert({ eventType: 'error', content: 'build error', importance: 3 });
        repo.insert({ eventType: 'discovery', content: 'found bug', importance: 9 });

        const top = repo.findTopByImportance(2);
        expect(top.length).toBe(2);
        expect(top[0]!.importance).toBe(9);
        expect(top[1]!.importance).toBe(8);
    });

    it('delete removes entry', () => {
        const repo = new EpisodicMemoryRepository(db);
        const id = repo.insert({ eventType: 'test', content: 'data' });
        expect(repo.delete(id)).toBe(true);
        expect(repo.findTopByImportance(10).length).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SemanticMemoryRepository
// ═══════════════════════════════════════════════════════════════════════

describe('SemanticMemoryRepository', () => {
    it('upsert creates and updates', () => {
        const repo = new SemanticMemoryRepository(db);
        repo.upsert({ category: 'self', key: 'name', value: 'Agent-1' });
        expect(repo.findByKey('self', 'name')!.value).toBe('Agent-1');

        // Update existing
        repo.upsert({ category: 'self', key: 'name', value: 'Agent-2' });
        expect(repo.findByKey('self', 'name')!.value).toBe('Agent-2');
        expect(repo.findAll().length).toBe(1); // No duplicates
    });

    it('findByCategory filters correctly', () => {
        const repo = new SemanticMemoryRepository(db);
        repo.upsert({ category: 'env', key: 'os', value: 'linux' });
        repo.upsert({ category: 'env', key: 'arch', value: 'x64' });
        repo.upsert({ category: 'self', key: 'name', value: 'test' });

        expect(repo.findByCategory('env').length).toBe(2);
        expect(repo.findByCategory('self').length).toBe(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// ProceduralMemoryRepository
// ═══════════════════════════════════════════════════════════════════════

describe('ProceduralMemoryRepository', () => {
    it('upsert and recordSuccess/Failure', () => {
        const repo = new ProceduralMemoryRepository(db);
        repo.upsert({ name: 'deploy', stepsJson: '["build","push","run"]' });

        repo.recordSuccess('deploy');
        repo.recordSuccess('deploy');
        repo.recordFailure('deploy');

        const proc = repo.findByName('deploy')!;
        expect(proc.success_count).toBe(2);
        expect(proc.failure_count).toBe(1);
        expect(proc.last_used).toBeTruthy();
    });

    it('upsert updates steps', () => {
        const repo = new ProceduralMemoryRepository(db);
        repo.upsert({ name: 'test', stepsJson: '["a"]' });
        repo.upsert({ name: 'test', stepsJson: '["a","b"]' });
        expect(repo.findByName('test')!.steps_json).toBe('["a","b"]');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// RelationshipMemoryRepository
// ═══════════════════════════════════════════════════════════════════════

describe('RelationshipMemoryRepository', () => {
    it('upsert creates with default trust and increments interactions', () => {
        const repo = new RelationshipMemoryRepository(db);
        repo.upsert({ entityId: 'alice', entityType: 'peer' });
        const r = repo.findByEntity('alice')!;
        expect(r.trust_score).toBe(50);
        expect(r.interaction_count).toBe(1);

        // Second upsert increments interaction count
        repo.upsert({ entityId: 'alice', entityType: 'peer', trustDelta: 5 });
        const r2 = repo.findByEntity('alice')!;
        expect(r2.trust_score).toBe(55);
        expect(r2.interaction_count).toBe(2);
    });

    it('trust score clamped to 0-100', () => {
        const repo = new RelationshipMemoryRepository(db);
        repo.upsert({ entityId: 'bob', entityType: 'peer', trustDelta: 60 });
        const r = repo.findByEntity('bob')!;
        expect(r.trust_score).toBeGreaterThanOrEqual(0);
        expect(r.trust_score).toBeLessThanOrEqual(100);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SoulHistoryRepository
// ═══════════════════════════════════════════════════════════════════════

describe('SoulHistoryRepository', () => {
    it('insert and getLatest', () => {
        const repo = new SoulHistoryRepository(db);
        repo.insert({ content: 'v1 soul', contentHash: 'aaa' });
        repo.insert({ content: 'v2 soul', contentHash: 'bbb', alignmentScore: 85 });

        const latest = repo.getLatest()!;
        expect(latest.content).toBe('v2 soul');
        expect(latest.content_hash).toBe('bbb');
        expect(latest.alignment_score).toBe(85);
    });

    it('count returns correct number', () => {
        const repo = new SoulHistoryRepository(db);
        expect(repo.count()).toBe(0);
        repo.insert({ content: 'a', contentHash: 'x' });
        repo.insert({ content: 'b', contentHash: 'y' });
        expect(repo.count()).toBe(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SessionSummariesRepository
// ═══════════════════════════════════════════════════════════════════════

describe('SessionSummariesRepository', () => {
    it('upsert and findBySession', () => {
        const repo = new SessionSummariesRepository(db);
        repo.upsert('session-1', 'Completed initial setup', 'success');
        const s = repo.findBySession('session-1')!;
        expect(s.summary).toBe('Completed initial setup');
        expect(s.outcome).toBe('success');
    });

    it('upsert updates existing', () => {
        const repo = new SessionSummariesRepository(db);
        repo.upsert('s1', 'initial', 'pending');
        repo.upsert('s1', 'updated', 'done');
        expect(repo.findBySession('s1')!.summary).toBe('updated');
    });

    it('findRecent returns ordered results', () => {
        const repo = new SessionSummariesRepository(db);
        repo.upsert('old', 'old summary');
        repo.upsert('new', 'new summary');
        const recent = repo.findRecent(1);
        expect(recent.length).toBe(1);
    });
});
