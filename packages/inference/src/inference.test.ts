/**
 * Tests for @web4-agent/inference
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestLogger } from '@web4-agent/core';
import type { InferenceProviderAdapter, InferenceRequest, InferenceResponse, Cents, InferenceProvider as InferenceProviderName, InferenceAuthType } from '@web4-agent/core';
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

function makeProvider(name: InferenceProviderName, available = true, authType: InferenceAuthType = 'apiKey'): InferenceProviderAdapter {
    return {
        name,
        authType,
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

    it('all models seeded as available', () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const all = modelRepo.listAll();
        for (const m of all) {
            expect(m.available).toBe(1);
        }
    });

    it('all 6 providers are represented in seed', () => {
        const providers = new Set(DEFAULT_MODEL_SEED.map(m => m.provider));
        expect(providers.has('ollama')).toBe(true);
        expect(providers.has('openai')).toBe(true);
        expect(providers.has('anthropic')).toBe(true);
        expect(providers.has('gemini')).toBe(true);
        expect(providers.has('openclaw')).toBe(true);
        expect(providers.has('nvidia')).toBe(true);
    });

    it('pricing is integer microcents', () => {
        for (const m of DEFAULT_MODEL_SEED) {
            expect(Number.isInteger(m.inputCostMicro)).toBe(true);
            expect(Number.isInteger(m.outputCostMicro)).toBe(true);
        }
    });

    it('ollama and openclaw models have zero cost', () => {
        const freeModels = DEFAULT_MODEL_SEED.filter(
            m => m.provider === 'ollama' || m.provider === 'openclaw',
        );
        for (const m of freeModels) {
            expect(m.inputCostMicro).toBe(0);
            expect(m.outputCostMicro).toBe(0);
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
    it('high tier reasoning prefers cliproxyapi:claude-sonnet-4 first', () => {
        const prefs = getModelPreferences('high', 'reasoning');
        expect(prefs[0].modelId).toBe('cliproxyapi:claude-sonnet-4');
    });

    it('high tier coding prefers cliproxyapi:claude-sonnet-4 first', () => {
        const prefs = getModelPreferences('high', 'coding');
        expect(prefs[0].modelId).toBe('cliproxyapi:claude-sonnet-4');
    });

    it('critical tier routes to Ollama only', () => {
        const taskTypes = ['reasoning', 'coding', 'analysis', 'conversation', 'planning'] as const;
        for (const tt of taskTypes) {
            const prefs = getModelPreferences('critical', tt);
            for (const p of prefs) {
                expect(p.modelId).toContain('ollama');
            }
        }
    });

    it('normal conversation prefers cliproxyapi models', () => {
        const prefs = getModelPreferences('normal', 'conversation');
        expect(prefs[0].modelId).toBe('cliproxyapi:gemini-2.5-pro');
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

    it('high tier includes providers from all ecosystems', () => {
        const prefs = getModelPreferences('high', 'reasoning');
        const providers = new Set(prefs.map(p => p.modelId.split(':')[0]));
        expect(providers.has('openclaw')).toBe(true);
        expect(providers.has('anthropic')).toBe(true);
        expect(providers.has('openai')).toBe(true);
        expect(providers.has('nvidia')).toBe(true);
        expect(providers.has('gemini')).toBe(true);
        expect(providers.has('ollama')).toBe(true);
    });
});

// ── Inference Router Tests ──────────────────────────────────────────────

describe('DefaultInferenceRouter', () => {
    const { logger } = createTestLogger();

    it('routes to first viable model', async () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const router = new DefaultInferenceRouter(
            [
                makeProvider('openclaw', true, 'oauth'),
                makeProvider('anthropic'),
                makeProvider('openai'),
                makeProvider('ollama', true, 'local'),
            ],
            modelRepo, costRepo,
            { dailyBudgetCents: 10000 },
            logger,
        );

        const result = await router.route(makeRequest('reasoning'), 'high');
        expect(result.model).toBe('openclaw:antigravity');
    });

    it('falls back when provider unavailable', async () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const router = new DefaultInferenceRouter(
            [
                makeProvider('openclaw', false, 'oauth'),
                makeProvider('anthropic'),
                makeProvider('openai'),
                makeProvider('ollama', true, 'local'),
            ],
            modelRepo, costRepo,
            { dailyBudgetCents: 10000 },
            logger,
        );

        const result = await router.route(makeRequest('reasoning'), 'high');
        expect(result.model).toBe('anthropic:claude-sonnet-4-20250514');
    });

    it('critical tier uses Ollama models', async () => {
        modelRepo.upsertMany(DEFAULT_MODEL_SEED);
        const router = new DefaultInferenceRouter(
            [makeProvider('ollama', true, 'local')],
            modelRepo, costRepo,
            { dailyBudgetCents: 10000 },
            logger,
        );

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
            [makeProvider('anthropic'), makeProvider('openai'), makeProvider('ollama', true, 'local')],
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
            [makeProvider('ollama', true, 'local')],
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
        const failingOpenclawProvider: InferenceProviderAdapter = {
            name: 'openclaw',
            authType: 'oauth',
            available: true,
            async complete(): Promise<InferenceResponse> {
                throw new Error('API down');
            },
        };

        const router = new DefaultInferenceRouter(
            [failingOpenclawProvider, makeProvider('anthropic'), makeProvider('openai'), makeProvider('ollama', true, 'local')],
            modelRepo, costRepo,
            { dailyBudgetCents: 10000 },
            logger,
        );

        const result = await router.route(makeRequest('reasoning'), 'high');
        // Should have fallen back to anthropic
        expect(result.model).toBe('anthropic:claude-sonnet-4-20250514');
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
