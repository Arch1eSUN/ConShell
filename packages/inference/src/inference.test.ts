/**
 * Tests for @web4-agent/inference
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestLogger } from '@web4-agent/core';
import type { InferenceProviderAdapter, InferenceRequest, InferenceResponse, Cents, InferenceProvider as InferenceProviderName } from '@web4-agent/core';
import { openTestDatabase, ModelRegistryRepository, InferenceCostsRepository } from '@web4-agent/state';
import type { UpsertModel } from '@web4-agent/state';
import { DEFAULT_MODEL_SEED } from './seed.js';
import { getModelPreferences } from './routing.js';
import { DefaultInferenceRouter } from './router.js';
import type Database from 'better-sqlite3';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeTestResponse(model: string): InferenceResponse {
    return {
        content: 'test response',
        usage: { inputTokens: 100, outputTokens: 50 },
        costCents: 0 as unknown as Cents,
        model,
    };
}

function makeProvider(name: InferenceProviderName, available = true): InferenceProviderAdapter {
    return {
        name,
        available,
        async complete(request: InferenceRequest): Promise<InferenceResponse> {
            return makeTestResponse(request.model ?? name);
        },
    };
}

function makeRequest(taskType: string = 'conversation'): InferenceRequest {
    return {
        messages: [{ role: 'user', content: 'test' }],
        taskType: taskType as InferenceRequest['taskType'],
    };
}

const { logger: testLogger } = createTestLogger();
let db: Database.Database;
let modelRepo: ModelRegistryRepository;
let costRepo: InferenceCostsRepository;

beforeEach(() => {
    db = openTestDatabase(testLogger);
    modelRepo = new ModelRegistryRepository(db);
    costRepo = new InferenceCostsRepository(db);
});

// ── Seed Tests ──────────────────────────────────────────────────────────

describe('Model Seed', () => {
    it('seeding populates all models', () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const all = modelRepo.listAll();
        expect(all.length).toBe(DEFAULT_MODEL_SEED.length);
    });

    it('seeding is idempotent (upsert, no duplicates)', () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const all = modelRepo.listAll();
        expect(all.length).toBe(DEFAULT_MODEL_SEED.length);
    });

    it('Gemini models seeded as unavailable (ADR-003)', () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const gemini = modelRepo.listByProvider('gemini');
        expect(gemini.length).toBeGreaterThan(0);
        for (const m of gemini) {
            expect(m.available).toBe(0);
        }
    });

    it('available models exclude Gemini', () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const available = modelRepo.listAvailable();
        for (const m of available) {
            expect(m.provider).not.toBe('gemini');
        }
    });

    it('pricing is integer microcents', () => {
        for (const m of DEFAULT_MODEL_SEED) {
            expect(Number.isInteger(m.inputCostMicro)).toBe(true);
            expect(Number.isInteger(m.outputCostMicro)).toBe(true);
        }
    });

    it('upsert updates existing model', () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const updated: UpsertModel = {
            ...DEFAULT_MODEL_SEED[0],
            maxTokens: 999_999,
        };
        modelRepo.upsert(updated);
        const row = modelRepo.getById(updated.id);
        expect(row?.max_tokens).toBe(999_999);
    });
});

// ── Routing Matrix Tests ────────────────────────────────────────────────

describe('Routing Matrix', () => {
    it('high tier reasoning prefers Sonnet 4 first', () => {
        const prefs = getModelPreferences('high', 'reasoning');
        expect(prefs[0].modelId).toBe('anthropic:claude-sonnet-4-20250514');
    });

    it('critical tier routes to Ollama only', () => {
        const taskTypes = ['reasoning', 'coding', 'analysis', 'conversation', 'planning'] as const;
        for (const tt of taskTypes) {
            const prefs = getModelPreferences('critical', tt);
            expect(prefs.length).toBe(1);
            expect(prefs[0].modelId).toContain('ollama');
        }
    });

    it('normal conversation prefers cheap models', () => {
        const prefs = getModelPreferences('normal', 'conversation');
        expect(prefs[0].modelId).toBe('openai:gpt-4o-mini');
    });

    it('all tasks have at least one model preference', () => {
        const tiers = ['high', 'normal', 'low', 'critical'] as const;
        const tasks = ['reasoning', 'coding', 'analysis', 'conversation', 'planning'] as const;
        for (const tier of tiers) {
            for (const task of tasks) {
                const prefs = getModelPreferences(tier, task);
                expect(prefs.length).toBeGreaterThan(0);
            }
        }
    });
});

// ── Inference Router Tests ──────────────────────────────────────────────

describe('DefaultInferenceRouter', () => {
    const { logger } = createTestLogger();

    it('routes to first viable model', async () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const router = new DefaultInferenceRouter(
            [makeProvider('anthropic'), makeProvider('openai'), makeProvider('ollama')],
            modelRepo, costRepo,
            { dailyBudgetCents: 10000 },
            logger,
        );

        const result = await router.route(makeRequest('reasoning'), 'high');
        expect(result.model).toBe('anthropic:claude-sonnet-4-20250514');
    });

    it('falls back when provider unavailable', async () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const router = new DefaultInferenceRouter(
            [makeProvider('anthropic', false), makeProvider('openai'), makeProvider('ollama')],
            modelRepo, costRepo,
            { dailyBudgetCents: 10000 },
            logger,
        );

        const result = await router.route(makeRequest('reasoning'), 'high');
        expect(result.model).toBe('openai:gpt-4o');
    });

    it('skips unavailable models (Gemini)', async () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const router = new DefaultInferenceRouter(
            [makeProvider('gemini'), makeProvider('ollama')],
            modelRepo, costRepo,
            { dailyBudgetCents: 10000 },
            logger,
        );

        // Critical tier — even though Gemini provider exists, Gemini models are unavailable
        const result = await router.route(makeRequest('conversation'), 'critical');
        expect(result.model).toContain('ollama');
    });

    it('throws when daily budget exceeded', async () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        // Pre-fill cost table to exceed budget
        costRepo.insert({
            model: 'test', provider: 'test',
            inputTokens: 1000, outputTokens: 1000,
            costCents: 100, latencyMs: 100,
        });

        const router = new DefaultInferenceRouter(
            [makeProvider('anthropic'), makeProvider('openai'), makeProvider('ollama')],
            modelRepo, costRepo,
            { dailyBudgetCents: 100 }, // budget = 100, already spent 100
            logger,
        );

        await expect(router.route(makeRequest('reasoning'), 'high'))
            .rejects.toThrow('budget exceeded');
    });

    it('records cost after successful inference', async () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const router = new DefaultInferenceRouter(
            [makeProvider('ollama')],
            modelRepo, costRepo,
            { dailyBudgetCents: 10000 },
            logger,
        );

        await router.route(makeRequest('conversation'), 'critical');
        const recent = costRepo.listRecent(1);
        expect(recent.length).toBe(1);
        expect(recent[0].model).toContain('ollama');
    });

    it('throws NoViableModel when no model found', async () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        // No providers registered
        const router = new DefaultInferenceRouter(
            [],
            modelRepo, costRepo,
            { dailyBudgetCents: 10000 },
            logger,
        );

        await expect(router.route(makeRequest('reasoning'), 'high'))
            .rejects.toThrow('No viable model');
    });

    it('falls back on provider error', async () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const failingAnthropicProvider: InferenceProviderAdapter = {
            name: 'anthropic',
            available: true,
            async complete(): Promise<InferenceResponse> {
                throw new Error('API down');
            },
        };

        const router = new DefaultInferenceRouter(
            [failingAnthropicProvider, makeProvider('openai'), makeProvider('ollama')],
            modelRepo, costRepo,
            { dailyBudgetCents: 10000 },
            logger,
        );

        const result = await router.route(makeRequest('reasoning'), 'high');
        // Should have fallen back to openai
        expect(result.model).toBe('openai:gpt-4o');
    });
});

// ── InferenceCostsRepository Tests ──────────────────────────────────────

describe('InferenceCostsRepository', () => {
    it('inserts and retrieves recent costs', () => {
        costRepo.insert({
            model: 'test-model', provider: 'test',
            inputTokens: 500, outputTokens: 200,
            costCents: 5, latencyMs: 150,
            taskType: 'reasoning',
        });

        const recent = costRepo.listRecent(10);
        expect(recent.length).toBe(1);
        expect(recent[0].model).toBe('test-model');
        expect(recent[0].cost_cents).toBe(5);
    });

    it('aggregates daily cost', () => {
        const today = new Date().toISOString().slice(0, 10);
        costRepo.insert({
            model: 'm1', provider: 'p1',
            inputTokens: 100, outputTokens: 50,
            costCents: 10, latencyMs: 100,
        });
        costRepo.insert({
            model: 'm2', provider: 'p2',
            inputTokens: 200, outputTokens: 100,
            costCents: 20, latencyMs: 200,
        });

        const total = costRepo.getDailyCost(
            `${today}T00:00:00.000Z`,
            `${today}T23:59:59.999Z`,
        );
        expect(total).toBe(30);
    });
});
