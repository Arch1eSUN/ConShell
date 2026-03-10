import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestLogger, cents, nowISO } from '@web4-agent/core';
import type { Cents } from '@web4-agent/core';
import { runMigrations, migrations } from './migrations/index.js';
import { TurnsRepository } from './repositories/turns.js';
import { PolicyDecisionsRepository } from './repositories/policy-decisions.js';
import { TransactionsRepository } from './repositories/transactions.js';
import { HeartbeatRepository } from './repositories/heartbeat.js';
import { ModificationsRepository } from './repositories/modifications.js';
import { ChildrenRepository } from './repositories/children.js';
import { SpendRepository } from './repositories/spend.js';

/**
 * Helper: open an in-memory DB with all migrations applied.
 */
function openTestDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const { logger } = createTestLogger();
    runMigrations(db, logger);
    return db;
}

describe('migrations', () => {
    let db: Database.Database;

    beforeEach(() => {
        db = openTestDb();
    });
    afterEach(() => {
        db.close();
    });

    it('applies all migrations to final version', () => {
        const row = db
            .prepare('SELECT MAX(version) as version FROM schema_version')
            .get() as { version: number };
        expect(row.version).toBe(migrations.length);
    });

    it('creates all expected tables', () => {
        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all() as Array<{ name: string }>;
        const tableNames = tables.map((t) => t.name);

        const expected = [
            'children',
            'child_lifecycle_events',
            'discovered_agents_cache',
            'episodic_memory',
            'heartbeat_dedup',
            'heartbeat_history',
            'heartbeat_schedule',
            'identity',
            'inbox_messages',
            'inference_costs',
            'installed_tools',
            'kv',
            'metric_snapshots',
            'model_registry',
            'modifications',
            'onchain_transactions',
            'policy_decisions',
            'procedural_memory',
            'relationship_memory',
            'schema_version',
            'semantic_memory',
            'session_summaries',
            'skills',
            'soul_history',
            'spend_tracking',
            'tool_calls',
            'transactions',
            'turns',
            'wake_events',
            'working_memory',
        ];

        for (const table of expected) {
            expect(tableNames).toContain(table);
        }
    });

    it('is idempotent — running again has no effect', () => {
        const { logger } = createTestLogger();
        // Run again — should be a no-op
        runMigrations(db, logger);

        const row = db
            .prepare('SELECT MAX(version) as version FROM schema_version')
            .get() as { version: number };
        expect(row.version).toBe(migrations.length);
    });
});

describe('TurnsRepository', () => {
    let db: Database.Database;
    let repo: TurnsRepository;

    beforeEach(() => {
        db = openTestDb();
        repo = new TurnsRepository(db);
    });
    afterEach(() => db.close());

    it('inserts and retrieves turns', () => {
        const id = repo.insert({
            sessionId: 'session-1',
            thinking: 'I should do X',
            inputTokens: 100,
            outputTokens: 50,
            costCents: cents(5),
            model: 'claude-3',
        });

        expect(id).toBeGreaterThan(0);

        const turn = repo.findById(id);
        expect(turn).toBeDefined();
        expect(turn!.session_id).toBe('session-1');
        expect(turn!.cost_cents).toBe(5);
        expect(turn!.model).toBe('claude-3');
    });

    it('finds turns by session', () => {
        repo.insert({ sessionId: 's1', inputTokens: 10, outputTokens: 5, costCents: cents(1) });
        repo.insert({ sessionId: 's1', inputTokens: 20, outputTokens: 10, costCents: cents(2) });
        repo.insert({ sessionId: 's2', inputTokens: 30, outputTokens: 15, costCents: cents(3) });

        expect(repo.findBySession('s1')).toHaveLength(2);
        expect(repo.findBySession('s2')).toHaveLength(1);
    });

    it('counts turns by session', () => {
        repo.insert({ sessionId: 's1', inputTokens: 10, outputTokens: 5, costCents: cents(1) });
        repo.insert({ sessionId: 's1', inputTokens: 20, outputTokens: 10, costCents: cents(2) });

        expect(repo.countBySession('s1')).toBe(2);
        expect(repo.countBySession('nonexistent')).toBe(0);
    });
});

describe('PolicyDecisionsRepository', () => {
    let db: Database.Database;
    let repo: PolicyDecisionsRepository;

    beforeEach(() => {
        db = openTestDb();
        repo = new PolicyDecisionsRepository(db);
    });
    afterEach(() => db.close());

    it('records allowed and denied decisions', () => {
        repo.insert({
            toolName: 'exec',
            source: 'self',
            allowed: true,
            ruleCategory: 'authority',
            ruleName: 'allow_self',
        });
        repo.insert({
            toolName: 'exec',
            source: 'external',
            allowed: false,
            ruleCategory: 'authority',
            ruleName: 'deny_external',
            reason: 'not allowed',
        });

        expect(repo.findByTool('exec')).toHaveLength(2);
        expect(repo.findDenied()).toHaveLength(1);
    });

    it('counts decisions since a timestamp', () => {
        const before = nowISO();
        repo.insert({ toolName: 'exec', source: 'self', allowed: true });

        expect(repo.countSince('exec', before)).toBe(1);
        expect(repo.countSince('other', before)).toBe(0);
    });
});

describe('TransactionsRepository', () => {
    let db: Database.Database;
    let repo: TransactionsRepository;

    beforeEach(() => {
        db = openTestDb();
        repo = new TransactionsRepository(db);
    });
    afterEach(() => db.close());

    it('inserts and queries transactions', () => {
        const id = repo.insert({
            type: 'topup',
            amountCents: cents(10_000),
            status: 'confirmed',
        });

        const rows = repo.findByType('topup');
        expect(rows).toHaveLength(1);
        expect(rows[0]!.amount_cents).toBe(10_000);
        expect(rows[0]!.id).toBe(id);
    });

    it('updates transaction status', () => {
        const id = repo.insert({
            type: 'transfer',
            amountCents: cents(500),
        });
        repo.updateStatus(id, 'confirmed', '0xabc123');

        const rows = repo.findByType('transfer');
        expect(rows[0]!.status).toBe('confirmed');
        expect(rows[0]!.tx_hash).toBe('0xabc123');
    });

    it('sums confirmed transactions by type', () => {
        repo.insert({ type: 'topup', amountCents: cents(1000), status: 'confirmed' });
        repo.insert({ type: 'topup', amountCents: cents(2000), status: 'confirmed' });
        repo.insert({ type: 'topup', amountCents: cents(500), status: 'pending' });

        expect(repo.sumConfirmedByType('topup')).toBe(3000);
    });
});

describe('HeartbeatRepository', () => {
    let db: Database.Database;
    let repo: HeartbeatRepository;

    beforeEach(() => {
        db = openTestDb();
        repo = new HeartbeatRepository(db);
    });
    afterEach(() => db.close());

    it('upserts and retrieves schedule', () => {
        repo.upsertSchedule({ name: 'check_balance', cron: '*/5 * * * *' });

        const schedule = repo.findSchedule('check_balance');
        expect(schedule).toBeDefined();
        expect(schedule!.cron).toBe('*/5 * * * *');
        expect(schedule!.enabled).toBe(1);
    });

    it('lists enabled schedules', () => {
        repo.upsertSchedule({ name: 'task1', cron: '* * * * *' });
        repo.upsertSchedule({ name: 'task2', cron: '* * * * *', enabled: false });

        expect(repo.listEnabled()).toHaveLength(1);
    });

    it('acquires and releases leases', () => {
        repo.upsertSchedule({ name: 'task1', cron: '* * * * *' });

        const future = new Date(Date.now() + 60_000).toISOString();
        expect(repo.acquireLease('task1', 'holder-a', future)).toBe(true);

        // Another holder can't acquire while lease is active
        const otherFuture = new Date(Date.now() + 120_000).toISOString();
        expect(repo.acquireLease('task1', 'holder-b', otherFuture)).toBe(false);

        // Release
        repo.releaseLease('task1', 'holder-a');

        // Now another holder can acquire
        expect(repo.acquireLease('task1', 'holder-b', otherFuture)).toBe(true);
    });

    it('records and retrieves history', () => {
        repo.insertHistory('task1', 'success', 150);
        repo.insertHistory('task1', 'failure', 200, 'timeout');

        const history = repo.findHistory('task1');
        expect(history).toHaveLength(2);
        // Both results should be present (order may vary when timestamps are identical)
        const results = history.map((h) => h.result);
        expect(results).toContain('success');
        expect(results).toContain('failure');
        const failEntry = history.find((h) => h.result === 'failure');
        expect(failEntry!.error).toBe('timeout');
        expect(failEntry!.duration_ms).toBe(200);
    });

    it('manages wake events', () => {
        repo.insertWakeEvent('balance_check', 'Balance below threshold');

        const events = repo.findUnconsumedWakeEvents();
        expect(events).toHaveLength(1);

        repo.consumeWakeEvent(events[0]!.id);
        expect(repo.findUnconsumedWakeEvents()).toHaveLength(0);
    });

    it('handles dedup keys', () => {
        const future = new Date(Date.now() + 60_000).toISOString();
        repo.setDedup('balance-low', future);

        expect(repo.isDuplicate('balance-low')).toBe(true);
        expect(repo.isDuplicate('other-key')).toBe(false);
    });
});

describe('ModificationsRepository', () => {
    let db: Database.Database;
    let repo: ModificationsRepository;

    beforeEach(() => {
        db = openTestDb();
        repo = new ModificationsRepository(db);
    });
    afterEach(() => db.close());

    it('inserts and queries modifications', () => {
        repo.insert({
            type: 'file_edit',
            target: '/path/to/file.ts',
            diff: '+new line',
        });

        const mods = repo.findByType('file_edit');
        expect(mods).toHaveLength(1);
        expect(mods[0]!.target).toBe('/path/to/file.ts');
    });

    it('counts modifications in a time window', () => {
        const before = nowISO();
        repo.insert({ type: 'file_edit', target: 'a.ts' });
        repo.insert({ type: 'config_change', target: 'config' });

        expect(repo.countSince(before)).toBe(2);
    });
});

describe('ChildrenRepository', () => {
    let db: Database.Database;
    let repo: ChildrenRepository;

    beforeEach(() => {
        db = openTestDb();
        repo = new ChildrenRepository(db);
    });
    afterEach(() => db.close());

    it('inserts and retrieves children', () => {
        repo.insert({
            id: 'child-1',
            genesisPrompt: 'You are a worker agent.',
            fundedCents: cents(5000),
        });

        const child = repo.findById('child-1');
        expect(child).toBeDefined();
        expect(child!.state).toBe('spawning');
        expect(child!.funded_cents).toBe(5000);
    });

    it('transitions state and records lifecycle events', () => {
        repo.insert({ id: 'child-1' });
        repo.transitionState('child-1', 'spawning', 'provisioning', 'Resources allocated');

        const child = repo.findById('child-1');
        expect(child!.state).toBe('provisioning');

        const events = repo.findLifecycleEvents('child-1');
        expect(events).toHaveLength(1);
        expect(events[0]!.from_state).toBe('spawning');
        expect(events[0]!.to_state).toBe('provisioning');
        expect(events[0]!.reason).toBe('Resources allocated');
    });

    it('counts alive children', () => {
        repo.insert({ id: 'child-1' });
        repo.insert({ id: 'child-2' });
        repo.transitionState('child-2', 'spawning', 'dead', 'terminated');

        expect(repo.countAlive()).toBe(1);
    });

    it('adds funding', () => {
        repo.insert({ id: 'child-1', fundedCents: cents(1000) });
        repo.addFunding('child-1', cents(500));

        const child = repo.findById('child-1');
        expect(child!.funded_cents).toBe(1500);
    });
});

describe('SpendRepository', () => {
    let db: Database.Database;
    let repo: SpendRepository;

    beforeEach(() => {
        db = openTestDb();
        repo = new SpendRepository(db);
    });
    afterEach(() => db.close());

    it('records and sums spend entries', () => {
        repo.record({ type: 'inference', amountCents: cents(100) });
        repo.record({ type: 'inference', amountCents: cents(200) });
        repo.record({ type: 'transfer', amountCents: cents(50) });

        const hourTotal = repo.totalCurrentHour();
        expect(hourTotal).toBe(350);

        const inferenceHour = repo.totalByTypeCurrentHour('inference');
        expect(inferenceHour).toBe(300);
    });
});
