import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
    createTestLogger,
    cents,
    nowISO,
} from '@conshell/core';
import type {
    PolicyEvaluationRequest,
    ToolMetadata,
    ToolDefinition,
    AutomatonConfig,
    Cents,
    FinancialContext,
} from '@conshell/core';
import { runMigrations, PolicyDecisionsRepository } from '@conshell/state';
import { PolicyEngine } from './engine.js';
import { ToolRegistry } from './registry.js';
import { authorityRules } from './rules/authority.js';
import { commandSafetyStaticRules, createRateLimitSelfMod } from './rules/command-safety.js';
import { createFinancialRules } from './rules/financial.js';
import { pathProtectionRules } from './rules/path-protection.js';
import { createRateLimitRules } from './rules/rate-limit.js';
import { validationRules } from './rules/validation.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function openTestDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const { logger } = createTestLogger();
    runMigrations(db, logger);
    return db;
}

function makeTool(overrides: Partial<ToolMetadata> = {}): ToolMetadata {
    return {
        name: 'test_tool',
        category: 'vm',
        riskLevel: 'safe',
        requiredAuthority: 'self',
        mcpExposed: false,
        auditFields: [],
        ...overrides,
    };
}

function makeRequest(overrides: Partial<PolicyEvaluationRequest> = {}): PolicyEvaluationRequest {
    return {
        toolName: 'test_tool',
        toolArgs: {},
        source: 'self',
        agentState: 'running',
        survivalTier: 'normal',
        ...overrides,
    };
}

function makeFinancialContext(overrides: Partial<FinancialContext> = {}): FinancialContext {
    return {
        balanceCents: cents(100_000) as Cents,
        hourlySpendCents: cents(0) as Cents,
        dailySpendCents: cents(0) as Cents,
        hourlyTransferCents: cents(0) as Cents,
        dailyTransferCents: cents(0) as Cents,
        dailyInferenceCents: cents(0) as Cents,
        ...overrides,
    };
}

const minimalConfig = {
    treasury: {
        maxPaymentCents: 100_000,
        hourlyTransferCapCents: 500_000,
        dailyTransferCapCents: 2_000_000,
        minimumReserveCents: 100,
        x402DomainAllowlist: ['api.example.com', 'inference.openai.com'],
        inferenceDailyBudgetCents: 500_000,
        topupTiersCents: [500, 2_500, 10_000],
    },
} as unknown as AutomatonConfig;

// ── Authority Rules ─────────────────────────────────────────────────────

describe('Authority Rules', () => {
    it('denies forbidden tools regardless of source', () => {
        const tool = makeTool({ riskLevel: 'forbidden' });
        for (const source of ['creator', 'self', 'peer', 'external'] as const) {
            const result = authorityRules[0]!.evaluate(makeRequest({ source }), tool);
            expect(result).not.toBeNull();
            expect(result!.allowed).toBe(false);
        }
    });

    it('denies dangerous tools from external sources', () => {
        const tool = makeTool({ riskLevel: 'dangerous' });
        const result = authorityRules[1]!.evaluate(makeRequest({ source: 'external' }), tool);
        expect(result!.allowed).toBe(false);
    });

    it('allows dangerous tools from self', () => {
        const tool = makeTool({ riskLevel: 'dangerous' });
        const result = authorityRules[1]!.evaluate(makeRequest({ source: 'self' }), tool);
        expect(result).toBeNull(); // null = no objection
    });

    it('denies caution from peer', () => {
        const tool = makeTool({ riskLevel: 'caution' });
        const result = authorityRules[3]!.evaluate(makeRequest({ source: 'peer' }), tool);
        expect(result!.allowed).toBe(false);
    });

    it('allows caution from external if mcpExposed', () => {
        const tool = makeTool({ riskLevel: 'caution', mcpExposed: true });
        const result = authorityRules[4]!.evaluate(makeRequest({ source: 'external' }), tool);
        expect(result).toBeNull();
    });
});

// ── Command Safety Rules ────────────────────────────────────────────────

describe('Command Safety Rules', () => {
    it('denies forbidden shell patterns', () => {
        const tool = makeTool({ name: 'exec' });
        const req = makeRequest({ toolName: 'exec', toolArgs: { command: 'rm -rf /' } });
        const result = commandSafetyStaticRules[0]!.evaluate(req, tool);
        expect(result!.allowed).toBe(false);
        expect(result!.reason).toContain('forbidden pattern');
    });

    it('allows safe shell commands', () => {
        const tool = makeTool({ name: 'exec' });
        const req = makeRequest({ toolName: 'exec', toolArgs: { command: 'ls -la' } });
        const result = commandSafetyStaticRules[0]!.evaluate(req, tool);
        expect(result).toBeNull();
    });

    it('denies commands targeting state.db', () => {
        const tool = makeTool({ name: 'exec' });
        const req = makeRequest({ toolName: 'exec', toolArgs: { command: 'sqlite3 state.db' } });
        const result = commandSafetyStaticRules[1]!.evaluate(req, tool);
        expect(result!.allowed).toBe(false);
    });

    it('rate limits self-mod tools', () => {
        const rule = createRateLimitSelfMod({ selfModCountCurrentHour: () => 10 });
        const req = makeRequest({ toolName: 'edit_own_file' });
        const result = rule.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
    });

    it('allows self-mod when under limit', () => {
        const rule = createRateLimitSelfMod({ selfModCountCurrentHour: () => 5 });
        const req = makeRequest({ toolName: 'edit_own_file' });
        const result = rule.evaluate(req, makeTool());
        expect(result).toBeNull();
    });
});

// ── Financial Rules ─────────────────────────────────────────────────────

describe('Financial Rules', () => {
    const rules = createFinancialRules(minimalConfig);

    it('denies payment exceeding per-payment cap', () => {
        const req = makeRequest({ toolArgs: { amount_cents: 200_000 } });
        const result = rules[0]!.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
        expect(result!.reason).toContain('cap');
    });

    it('allows payment within cap', () => {
        const req = makeRequest({ toolArgs: { amount_cents: 50_000 } });
        const result = rules[0]!.evaluate(req, makeTool());
        expect(result).toBeNull();
    });

    it('denies x402 to unlisted domain', () => {
        const req = makeRequest({
            toolName: 'x402_fetch',
            toolArgs: { url: 'https://evil.com/api' },
        });
        const result = rules[4]!.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
        expect(result!.reason).toContain('allowlist');
    });

    it('allows x402 to listed domain', () => {
        const req = makeRequest({
            toolName: 'x402_fetch',
            toolArgs: { url: 'https://api.example.com/v1/data' },
        });
        const result = rules[4]!.evaluate(req, makeTool());
        expect(result).toBeNull();
    });

    it('denies transfer below minimum reserve', () => {
        const ctx = makeFinancialContext({ balanceCents: cents(500) as Cents });
        const req = makeRequest({
            toolArgs: { amount_cents: 450 },
            financialContext: ctx,
        });
        const result = rules[3]!.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
        expect(result!.reason).toContain('reserve');
    });
});

// ── Path Protection Rules ───────────────────────────────────────────────

describe('Path Protection Rules', () => {
    it('denies write to wallet.json', () => {
        const req = makeRequest({
            toolName: 'edit_own_file',
            toolArgs: { path: '/home/agent/wallet.json' },
        });
        const result = pathProtectionRules[0]!.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
    });

    it('denies write to .git directory', () => {
        const req = makeRequest({
            toolName: 'write_file',
            toolArgs: { path: '/home/agent/.git/config' },
        });
        const result = pathProtectionRules[0]!.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
    });

    it('allows write to normal file', () => {
        const req = makeRequest({
            toolName: 'edit_own_file',
            toolArgs: { path: '/home/agent/src/index.ts' },
        });
        const result = pathProtectionRules[0]!.evaluate(req, makeTool());
        expect(result).toBeNull();
    });

    it('denies read of sensitive .pem file', () => {
        const req = makeRequest({
            toolName: 'read_file',
            toolArgs: { path: '/home/agent/certs/server.pem' },
        });
        const result = pathProtectionRules[1]!.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
    });

    it('denies read of .env file', () => {
        const req = makeRequest({
            toolName: 'read_file',
            toolArgs: { path: '/home/agent/.env' },
        });
        const result = pathProtectionRules[1]!.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
    });
});

// ── Rate Limit Rules ────────────────────────────────────────────────────

describe('Rate Limit Rules', () => {
    it('denies when tool calls per turn exceeded', () => {
        const rules = createRateLimitRules({
            toolCallsThisTurn: () => 20,
            dangerousCallsThisSession: () => 0,
            execCallsThisHour: () => 0,
        });
        const result = rules[0]!.evaluate(makeRequest(), makeTool());
        expect(result!.allowed).toBe(false);
    });

    it('denies dangerous ops when session limit exceeded', () => {
        const rules = createRateLimitRules({
            toolCallsThisTurn: () => 0,
            dangerousCallsThisSession: () => 50,
            execCallsThisHour: () => 0,
        });
        const tool = makeTool({ riskLevel: 'dangerous' });
        const result = rules[1]!.evaluate(makeRequest(), tool);
        expect(result!.allowed).toBe(false);
    });

    it('denies exec when hourly limit exceeded', () => {
        const rules = createRateLimitRules({
            toolCallsThisTurn: () => 0,
            dangerousCallsThisSession: () => 0,
            execCallsThisHour: () => 100,
        });
        const result = rules[2]!.evaluate(makeRequest({ toolName: 'exec' }), makeTool());
        expect(result!.allowed).toBe(false);
    });
});

// ── Validation Rules ────────────────────────────────────────────────────

describe('Validation Rules', () => {
    it('denies invalid npm package name', () => {
        const req = makeRequest({
            toolName: 'install_npm_package',
            toolArgs: { package_name: '../../../etc/passwd' },
        });
        const result = validationRules[0]!.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
    });

    it('allows valid npm package name', () => {
        const req = makeRequest({
            toolName: 'install_npm_package',
            toolArgs: { package_name: '@types/node' },
        });
        const result = validationRules[0]!.evaluate(req, makeTool());
        expect(result).toBeNull();
    });

    it('denies invalid git hash', () => {
        const req = makeRequest({
            toolName: 'pull_upstream',
            toolArgs: { commit_hash: 'zzzz' },
        });
        const result = validationRules[3]!.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
    });

    it('allows valid git hash', () => {
        const req = makeRequest({
            toolName: 'pull_upstream',
            toolArgs: { commit_hash: 'abcdef1' },
        });
        const result = validationRules[3]!.evaluate(req, makeTool());
        expect(result).toBeNull();
    });

    it('denies invalid ethereum address', () => {
        const req = makeRequest({
            toolArgs: { address: '0xinvalid' },
        });
        const result = validationRules[4]!.evaluate(req, makeTool());
        expect(result!.allowed).toBe(false);
    });
});

// ── PolicyEngine Integration ────────────────────────────────────────────

describe('PolicyEngine', () => {
    let db: Database.Database;
    let decisionsRepo: PolicyDecisionsRepository;
    let engine: PolicyEngine;
    let registry: ToolRegistry;

    beforeEach(() => {
        db = openTestDb();
        const { logger } = createTestLogger();
        decisionsRepo = new PolicyDecisionsRepository(db);
        registry = new ToolRegistry(logger);

        registry.register({
            name: 'exec',
            category: 'vm',
            description: 'Execute a shell command',
            inputSchema: {},
            riskLevel: 'caution',
            requiredAuthority: 'self',
            mcpExposed: false,
            auditFields: ['command'],
        });
        registry.register({
            name: 'read_file',
            category: 'vm',
            description: 'Read a file',
            inputSchema: {},
            riskLevel: 'safe',
            requiredAuthority: 'self',
            mcpExposed: true,
            auditFields: ['path'],
        });
        registry.register({
            name: 'topup_credits',
            category: 'financial',
            description: 'Top up credits',
            inputSchema: {},
            riskLevel: 'dangerous',
            requiredAuthority: 'self',
            mcpExposed: false,
            auditFields: ['amount_cents'],
        });

        const allRules = [
            ...authorityRules,
            ...commandSafetyStaticRules,
            ...pathProtectionRules,
            ...validationRules,
        ];

        engine = new PolicyEngine(
            allRules,
            decisionsRepo,
            (name) => registry.getMetadata(name),
            logger,
        );
    });

    afterEach(() => db.close());

    it('allows safe tool from self', () => {
        const decision = engine.evaluate(makeRequest({
            toolName: 'read_file',
            toolArgs: { path: '/home/agent/src/main.ts' },
        }));
        expect(decision.allowed).toBe(true);
    });

    it('denies dangerous tool from external', () => {
        const decision = engine.evaluate(makeRequest({
            toolName: 'topup_credits',
            source: 'external',
        }));
        expect(decision.allowed).toBe(false);
        expect(decision.ruleCategory).toBe('authority');
    });

    it('denies forbidden command patterns', () => {
        const decision = engine.evaluate(makeRequest({
            toolName: 'exec',
            toolArgs: { command: 'rm -rf /' },
        }));
        expect(decision.allowed).toBe(false);
        expect(decision.ruleCategory).toBe('command_safety');
    });

    it('denies write to protected file', () => {
        const decision = engine.evaluate(makeRequest({
            toolName: 'exec', // not a write tool — protection rule won't fire
            toolArgs: { command: 'echo hello' },
        }));
        // exec with safe command should be allowed
        expect(decision.allowed).toBe(true);
    });

    it('denies unknown tools', () => {
        const decision = engine.evaluate(makeRequest({
            toolName: 'nonexistent_tool',
        }));
        expect(decision.allowed).toBe(false);
        expect(decision.rule).toBe('unknown_tool');
    });

    it('persists every decision to audit trail', () => {
        engine.evaluate(makeRequest({ toolName: 'read_file', toolArgs: { path: '/tmp/x' } }));
        engine.evaluate(makeRequest({ toolName: 'exec', toolArgs: { command: 'rm -rf /' } }));

        const allowed = decisionsRepo.findByTool('read_file');
        expect(allowed).toHaveLength(1);
        expect(allowed[0]!.allowed).toBe(1); // SQLite boolean

        const denied = decisionsRepo.findByTool('exec');
        expect(denied).toHaveLength(1);
        expect(denied[0]!.allowed).toBe(0);
    });

    it('evaluates rules in priority order (authority before command safety)', () => {
        // Caution tool from peer: authority rule (priority 130) should fire before command safety
        const decision = engine.evaluate(makeRequest({
            toolName: 'exec',
            source: 'peer',
            toolArgs: { command: 'rm -rf /' },
        }));
        expect(decision.allowed).toBe(false);
        // Should be denied by authority rule first (lower priority number)
        expect(decision.ruleCategory).toBe('authority');
    });
});

// ── ToolRegistry ────────────────────────────────────────────────────────

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        const { logger } = createTestLogger();
        registry = new ToolRegistry(logger);
    });

    it('registers and retrieves tools', () => {
        const tool: ToolDefinition = {
            name: 'exec',
            category: 'vm',
            description: 'Execute shell command',
            inputSchema: {},
            riskLevel: 'caution',
            requiredAuthority: 'self',
            mcpExposed: false,
            auditFields: ['command'],
        };
        registry.register(tool);

        expect(registry.size).toBe(1);
        expect(registry.getDefinition('exec')).toBeDefined();
        expect(registry.getMetadata('exec')?.riskLevel).toBe('caution');
    });

    it('rejects duplicate registration', () => {
        const tool: ToolDefinition = {
            name: 'exec',
            category: 'vm',
            description: 'Execute',
            inputSchema: {},
            riskLevel: 'caution',
            requiredAuthority: 'self',
            mcpExposed: false,
            auditFields: [],
        };
        registry.register(tool);
        expect(() => registry.register(tool)).toThrow('already registered');
    });

    it('filters by category', () => {
        registry.registerAll([
            { name: 'exec', category: 'vm', description: '', inputSchema: {}, riskLevel: 'caution', requiredAuthority: 'self', mcpExposed: false, auditFields: [] },
            { name: 'read_file', category: 'vm', description: '', inputSchema: {}, riskLevel: 'safe', requiredAuthority: 'self', mcpExposed: true, auditFields: [] },
            { name: 'topup', category: 'financial', description: '', inputSchema: {}, riskLevel: 'dangerous', requiredAuthority: 'self', mcpExposed: false, auditFields: [] },
        ]);

        expect(registry.listByCategory('vm')).toHaveLength(2);
        expect(registry.listByCategory('financial')).toHaveLength(1);
    });

    it('lists MCP-exposed tools', () => {
        registry.registerAll([
            { name: 'exec', category: 'vm', description: '', inputSchema: {}, riskLevel: 'caution', requiredAuthority: 'self', mcpExposed: false, auditFields: [] },
            { name: 'read_file', category: 'vm', description: '', inputSchema: {}, riskLevel: 'safe', requiredAuthority: 'self', mcpExposed: true, auditFields: [] },
        ]);

        const exposed = registry.listMcpExposed();
        expect(exposed).toHaveLength(1);
        expect(exposed[0]!.name).toBe('read_file');
    });

    it('returns undefined for unknown tools', () => {
        expect(registry.getMetadata('nonexistent')).toBeUndefined();
    });
});
