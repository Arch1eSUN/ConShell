import { describe, it, expect, beforeEach } from 'vitest';
import { createTestLogger, type Cents } from '@web4-agent/core';
import {
    openTestDatabase,
    TurnsRepository,
    TransactionsRepository,
    HeartbeatRepository,
    ChildrenRepository,
    SpendRepository,
} from '@web4-agent/state';
import { CliAdmin } from './admin.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let admin: CliAdmin;
let turnsRepo: TurnsRepository;
let transactionsRepo: TransactionsRepository;
let heartbeatRepo: HeartbeatRepository;
let childrenRepo: ChildrenRepository;
let spendRepo: SpendRepository;

beforeEach(() => {
    const { logger } = createTestLogger();
    db = openTestDatabase(logger);
    turnsRepo = new TurnsRepository(db);
    transactionsRepo = new TransactionsRepository(db);
    heartbeatRepo = new HeartbeatRepository(db);
    childrenRepo = new ChildrenRepository(db);
    spendRepo = new SpendRepository(db);
    admin = new CliAdmin({
        turnsRepo,
        transactionsRepo,
        heartbeatRepo,
        childrenRepo,
        spendRepo,
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        getState: () => 'running',
        getTier: () => 'normal',
    });
});

// ═════════════════════════════════════════════════════════════════════════
// status()
// ═════════════════════════════════════════════════════════════════════════

describe('status', () => {
    it('returns correct structure with defaults', () => {
        const report = admin.status();
        expect(report.agentState).toBe('running');
        expect(report.survivalTier).toBe('normal');
        expect(report.walletAddress).toBe('0x1234567890abcdef1234567890abcdef12345678');
        expect(report.financial.totalTopupCents).toBe(0);
        expect(report.financial.totalSpendCents).toBe(0);
        expect(report.financial.netBalanceCents).toBe(0);
        expect(report.aliveChildren).toBe(0);
    });

    it('returns unknown when no getState/getTier provided', () => {
        const minimal = new CliAdmin({
            turnsRepo,
            transactionsRepo,
            heartbeatRepo,
            childrenRepo,
            spendRepo,
        });
        const report = minimal.status();
        expect(report.agentState).toBe('unknown');
        expect(report.survivalTier).toBe('unknown');
        expect(report.walletAddress).toBeUndefined();
    });

    it('computes financial aggregates from transactions', () => {
        transactionsRepo.insert({
            type: 'topup',
            amountCents: 5000 as Cents,
            status: 'confirmed',
        });
        transactionsRepo.insert({
            type: 'topup',
            amountCents: 3000 as Cents,
            status: 'confirmed',
        });
        transactionsRepo.insert({
            type: 'x402_payment',
            amountCents: 1200 as Cents,
            status: 'confirmed',
        });

        const report = admin.status();
        expect(report.financial.totalTopupCents).toBe(8000);
        expect(report.financial.totalSpendCents).toBe(1200);
        expect(report.financial.netBalanceCents).toBe(6800);
    });

    it('ignores pending transactions in aggregates', () => {
        transactionsRepo.insert({
            type: 'topup',
            amountCents: 5000 as Cents,
            status: 'pending',
        });
        const report = admin.status();
        expect(report.financial.totalTopupCents).toBe(0);
    });

    it('shows heartbeat schedule', () => {
        heartbeatRepo.upsertSchedule({
            name: 'check_credits',
            cron: '*/5 * * * *',
            enabled: true,
        });
        heartbeatRepo.upsertSchedule({
            name: 'health_check',
            cron: '*/10 * * * *',
            enabled: true,
        });

        const report = admin.status();
        expect(report.heartbeatTasks.length).toBe(2);
        expect(report.heartbeatTasks.map(t => t.name)).toContain('check_credits');
    });

    it('shows alive children count', () => {
        childrenRepo.insert({ id: 'child-1' });
        childrenRepo.insert({ id: 'child-2' });
        // Transition one to dead
        childrenRepo.transitionState('child-2', 'spawning', 'dead', 'test');

        const report = admin.status();
        expect(report.aliveChildren).toBe(1);
    });

    it('includes spend tracking data', () => {
        spendRepo.record({ type: 'inference', amountCents: 42 as Cents });
        spendRepo.record({ type: 'x402', amountCents: 100 as Cents });

        const report = admin.status();
        expect(report.financial.currentHourSpendCents).toBe(142);
        expect(report.financial.currentDaySpendCents).toBe(142);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// logs()
// ═════════════════════════════════════════════════════════════════════════

describe('logs', () => {
    it('returns empty array when no turns exist', () => {
        expect(admin.logs({ sessionId: 'sess-1' })).toEqual([]);
    });

    it('returns inserted turns for a session', () => {
        turnsRepo.insert({
            sessionId: 'sess-1',
            thinking: 'thinking about life',
            inputTokens: 100,
            outputTokens: 50,
            costCents: 1 as Cents,
            model: 'claude-3.5-sonnet',
        });
        turnsRepo.insert({
            sessionId: 'sess-1',
            thinking: 'more thoughts',
            inputTokens: 200,
            outputTokens: 80,
            costCents: 2 as Cents,
            model: 'claude-3.5-sonnet',
        });

        const turns = admin.logs({ sessionId: 'sess-1' });
        expect(turns.length).toBe(2);
        expect(turns[0]!.thinking).toBe('thinking about life');
    });

    it('respects limit option', () => {
        for (let i = 0; i < 5; i++) {
            turnsRepo.insert({
                sessionId: 'sess-2',
                inputTokens: 10,
                outputTokens: 5,
                costCents: 1 as Cents,
            });
        }

        const turns = admin.logs({ sessionId: 'sess-2', limit: 3 });
        expect(turns.length).toBe(3);
    });

    it('filters by sessionId', () => {
        turnsRepo.insert({
            sessionId: 'sess-a',
            inputTokens: 10,
            outputTokens: 5,
            costCents: 1 as Cents,
        });
        turnsRepo.insert({
            sessionId: 'sess-b',
            inputTokens: 20,
            outputTokens: 10,
            costCents: 2 as Cents,
        });

        expect(admin.logs({ sessionId: 'sess-a' }).length).toBe(1);
        expect(admin.logs({ sessionId: 'sess-b' }).length).toBe(1);
    });

    it('returns empty when no sessionId given', () => {
        turnsRepo.insert({
            sessionId: 'sess-1',
            inputTokens: 10,
            outputTokens: 5,
            costCents: 1 as Cents,
        });
        expect(admin.logs()).toEqual([]);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// fund()
// ═════════════════════════════════════════════════════════════════════════

describe('fund', () => {
    it('inserts a confirmed topup transaction', () => {
        const result = admin.fund(5000 as Cents);
        expect(result.success).toBe(true);
        expect(result.transactionId).toBeDefined();

        const txns = transactionsRepo.findByType('topup');
        expect(txns.length).toBe(1);
        expect(txns[0]!.amount_cents).toBe(5000);
        expect(txns[0]!.status).toBe('confirmed');
    });

    it('rejects zero amount', () => {
        const result = admin.fund(0 as Cents);
        expect(result.success).toBe(false);
        expect(result.error).toContain('positive');
    });

    it('rejects negative amount', () => {
        const result = admin.fund(-100 as Cents);
        expect(result.success).toBe(false);
        expect(result.error).toContain('positive');
    });

    it('fund amount appears in status financial summary', () => {
        admin.fund(10000 as Cents);
        const report = admin.status();
        expect(report.financial.totalTopupCents).toBe(10000);
        expect(report.financial.netBalanceCents).toBe(10000);
    });

    it('multiple funds accumulate', () => {
        admin.fund(3000 as Cents);
        admin.fund(2000 as Cents);
        admin.fund(1000 as Cents);

        const report = admin.status();
        expect(report.financial.totalTopupCents).toBe(6000);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// Integration: cross-command
// ═════════════════════════════════════════════════════════════════════════

describe('integration', () => {
    it('fund → spend → status shows net balance', () => {
        admin.fund(10000 as Cents);

        transactionsRepo.insert({
            type: 'x402_payment',
            amountCents: 2500 as Cents,
            status: 'confirmed',
        });
        transactionsRepo.insert({
            type: 'transfer',
            amountCents: 500 as Cents,
            status: 'confirmed',
        });

        const report = admin.status();
        expect(report.financial.totalTopupCents).toBe(10000);
        expect(report.financial.totalSpendCents).toBe(3000);
        expect(report.financial.netBalanceCents).toBe(7000);
    });

    it('full turn flow: insert turn → retrieve via logs', () => {
        const turnId = turnsRepo.insert({
            sessionId: 'integration-sess',
            thinking: 'I must survive',
            inputTokens: 500,
            outputTokens: 250,
            costCents: 5 as Cents,
            model: 'gpt-4o',
        });

        const logs = admin.logs({ sessionId: 'integration-sess' });
        expect(logs.length).toBe(1);
        expect(logs[0]!.id).toBe(turnId);
        expect(logs[0]!.thinking).toBe('I must survive');
        expect(logs[0]!.model).toBe('gpt-4o');
    });

    it('heartbeat schedule appears in status', () => {
        heartbeatRepo.upsertSchedule({
            name: 'check_usdc_balance',
            cron: '*/15 * * * *',
            enabled: true,
            minTier: 'critical',
        });

        const report = admin.status();
        const task = report.heartbeatTasks.find(t => t.name === 'check_usdc_balance');
        expect(task).toBeDefined();
        expect(task!.cron).toBe('*/15 * * * *');
    });

    it('children lifecycle reflected in status', () => {
        childrenRepo.insert({ id: 'child-a', genesisPrompt: 'be useful' });
        childrenRepo.insert({ id: 'child-b', genesisPrompt: 'be creative' });
        childrenRepo.insert({ id: 'child-c', genesisPrompt: 'be safe' });

        expect(admin.status().aliveChildren).toBe(3);

        // Kill one child
        childrenRepo.transitionState('child-c', 'spawning', 'dead', 'no funds');
        expect(admin.status().aliveChildren).toBe(2);
    });
});
