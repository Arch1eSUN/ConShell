import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestLogger } from '@conshell/core';
import { openTestDatabase } from '@conshell/state';
import {
    WorkingMemoryRepository,
    EpisodicMemoryRepository,
    SemanticMemoryRepository,
    ProceduralMemoryRepository,
    RelationshipMemoryRepository,
} from '@conshell/state';
import { MemoryTierManager } from './tier-manager.js';
import type Database from 'better-sqlite3';

const noopLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
} as any;

let db: Database.Database;

beforeEach(() => {
    const { logger } = createTestLogger();
    db = openTestDatabase(logger);
});

afterEach(() => {
    db.close();
});

function makeManager() {
    return new MemoryTierManager({
        working: new WorkingMemoryRepository(db),
        episodic: new EpisodicMemoryRepository(db),
        semantic: new SemanticMemoryRepository(db),
        procedural: new ProceduralMemoryRepository(db),
        relationship: new RelationshipMemoryRepository(db),
    }, noopLogger);
}

describe('MemoryTierManager', () => {
    it('retrieve returns empty blocks when no data', () => {
        const mgr = makeManager();
        const blocks = mgr.retrieve('s1', { totalTokens: 4000 });
        expect(blocks.length).toBe(0);
    });

    it('retrieve returns working memory for target session', () => {
        const wm = new WorkingMemoryRepository(db);
        wm.insert({ sessionId: 's1', type: 'goal', content: 'Learn TypeScript deeply' });
        wm.insert({ sessionId: 's2', type: 'goal', content: 'Other session' });

        const mgr = makeManager();
        const blocks = mgr.retrieve('s1', { totalTokens: 4000 });

        const workingBlock = blocks.find(b => b.tier === 'working');
        expect(workingBlock).toBeDefined();
        expect(workingBlock!.entries.length).toBe(1);
        expect(workingBlock!.entries[0]!.content).toBe('Learn TypeScript deeply');
    });

    it('retrieve respects token budget', () => {
        const sm = new SemanticMemoryRepository(db);
        // Each entry ~250 tokens (1000 chars / 4)
        for (let i = 0; i < 20; i++) {
            sm.upsert({ category: 'data', key: `k${i}`, value: 'x'.repeat(1000) });
        }

        const mgr = makeManager();
        // semantic gets 20% of 2000 = 400 tokens → fits ~1-2 long entries
        const blocks = mgr.retrieve('s1', { totalTokens: 2000 });
        const semBlock = blocks.find(b => b.tier === 'semantic');
        expect(semBlock).toBeDefined();
        expect(semBlock!.entries.length).toBeLessThan(20);
    });

    it('retrieve includes all tiers with data', () => {
        new WorkingMemoryRepository(db).insert({ sessionId: 's1', type: 'goal', content: 'test' });
        new EpisodicMemoryRepository(db).insert({ eventType: 'test', content: 'event' });
        new SemanticMemoryRepository(db).upsert({ category: 'x', key: 'y', value: 'z' });
        new ProceduralMemoryRepository(db).upsert({ name: 'p', stepsJson: '["a"]' });
        new RelationshipMemoryRepository(db).upsert({ entityId: 'alice', entityType: 'peer' });

        const mgr = makeManager();
        const blocks = mgr.retrieve('s1', { totalTokens: 10000 });
        expect(blocks.length).toBe(5);
    });

    it('stats returns counts per tier', () => {
        new WorkingMemoryRepository(db).insert({ sessionId: 's1', type: 'a', content: 'b' });
        new WorkingMemoryRepository(db).insert({ sessionId: 's1', type: 'c', content: 'd' });
        new SemanticMemoryRepository(db).upsert({ category: 'x', key: 'y', value: 'z' });

        const mgr = makeManager();
        const stats = mgr.stats('s1');
        const working = stats.find(s => s.tier === 'working')!;
        expect(working.count).toBe(2);
        const semantic = stats.find(s => s.tier === 'semantic')!;
        expect(semantic.count).toBe(1);
    });

    it('formatContextBlock produces XML-tagged memory block', () => {
        new WorkingMemoryRepository(db).insert({ sessionId: 's1', type: 'goal', content: 'do stuff' });

        const mgr = makeManager();
        const blocks = mgr.retrieve('s1', { totalTokens: 5000 });
        const text = mgr.formatContextBlock(blocks);

        expect(text).toContain('<memory>');
        expect(text).toContain('</memory>');
        expect(text).toContain('WORKING MEMORY');
        expect(text).toContain('[goal] do stuff');
    });

    it('formatContextBlock returns empty string with no data', () => {
        const mgr = makeManager();
        expect(mgr.formatContextBlock([])).toBe('');
    });

    it('retrieve supports custom tier weights', () => {
        // Give 100% budget to semantic, 0% to everything else
        for (let i = 0; i < 5; i++) {
            new SemanticMemoryRepository(db).upsert({ category: 'd', key: `k${i}`, value: 'short' });
        }
        new WorkingMemoryRepository(db).insert({ sessionId: 's1', type: 'x', content: 'working data' });

        const mgr = makeManager();
        const blocks = mgr.retrieve('s1', {
            totalTokens: 4000,
            tierWeights: { working: 0, episodic: 0, semantic: 1.0, procedural: 0, relationship: 0 },
        });

        // Working should be excluded because weight = 0 (budget = 0)
        const workingBlock = blocks.find(b => b.tier === 'working');
        expect(workingBlock).toBeUndefined();

        const semBlock = blocks.find(b => b.tier === 'semantic');
        expect(semBlock).toBeDefined();
        expect(semBlock!.entries.length).toBe(5);
    });
});
