/**
 * Tests for @web4-agent/runtime
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestLogger } from '@web4-agent/core';
import type { InferenceRouter, InferenceRequest, InferenceResponse, Cents, SurvivalTier } from '@web4-agent/core';
import { openTestDatabase, TurnsRepository, HeartbeatRepository } from '@web4-agent/state';
import { ToolRegistry } from '@web4-agent/policy';
import { AgentStateMachine } from './state-machine.js';
import { AgentLoop } from './agent-loop.js';
import { HeartbeatDaemon } from './heartbeat.js';
import { McpGateway } from './mcp-gateway.js';
import type { JsonRpcRequest } from './mcp-gateway.js';
import type Database from 'better-sqlite3';

const { logger } = createTestLogger();

// ── State Machine ───────────────────────────────────────────────────────

describe('AgentStateMachine', () => {
    it('starts in setup state', () => {
        const sm = new AgentStateMachine();
        expect(sm.state).toBe('setup');
    });

    it('allows valid transitions: setup → waking → running → sleeping', () => {
        const sm = new AgentStateMachine();
        sm.transition('waking');
        expect(sm.state).toBe('waking');
        sm.transition('running');
        expect(sm.state).toBe('running');
        sm.transition('sleeping');
        expect(sm.state).toBe('sleeping');
    });

    it('rejects invalid transition: setup → running', () => {
        const sm = new AgentStateMachine();
        expect(() => sm.transition('running')).toThrow('Invalid state transition');
    });

    it('dead is terminal (no transitions out)', () => {
        const sm = new AgentStateMachine('dead');
        expect(() => sm.transition('waking')).toThrow('Invalid state transition');
        expect(() => sm.transition('setup')).toThrow('Invalid state transition');
    });

    it('sleeping → waking (wake cycle)', () => {
        const sm = new AgentStateMachine('sleeping');
        sm.transition('waking');
        expect(sm.state).toBe('waking');
    });

    it('any state can transition to dead', () => {
        for (const state of ['setup', 'waking', 'running', 'sleeping'] as const) {
            const sm = new AgentStateMachine(state);
            sm.transition('dead');
            expect(sm.state).toBe('dead');
        }
    });

    it('fires transition listeners', () => {
        const sm = new AgentStateMachine();
        const transitions: string[] = [];
        sm.onTransition((from, to) => transitions.push(`${from}→${to}`));
        sm.transition('waking');
        sm.transition('running');
        expect(transitions).toEqual(['setup→waking', 'waking→running']);
    });

    it('canTransition returns correct boolean', () => {
        const sm = new AgentStateMachine('running');
        expect(sm.canTransition('sleeping')).toBe(true);
        expect(sm.canTransition('setup')).toBe(false);
        expect(sm.canTransition('dead')).toBe(true);
    });
});

// ── Agent Loop ──────────────────────────────────────────────────────────

describe('AgentLoop', () => {
    let db: Database.Database;
    let turnsRepo: TurnsRepository;

    function makeMockRouter(): InferenceRouter {
        return {
            async route(request: InferenceRequest, tier: SurvivalTier): Promise<InferenceResponse> {
                return {
                    content: `Response to: ${request.messages[request.messages.length - 1]!.content}`,
                    usage: { inputTokens: 100, outputTokens: 50 },
                    costCents: 5 as unknown as Cents,
                    model: 'test-model',
                };
            },
        };
    }

    beforeEach(() => {
        db = openTestDatabase(logger);
        turnsRepo = new TurnsRepository(db);
    });

    it('executes a turn and returns response', async () => {
        const loop = new AgentLoop({
            inferenceRouter: makeMockRouter(),
            turnsRepo,
            logger,
            getTier: () => 'normal',
        });

        const result = await loop.executeTurn({
            role: 'user',
            content: 'Hello agent',
            sessionId: 'test-session-1',
        });

        expect(result.response).toContain('Hello agent');
        expect(result.model).toBe('test-model');
        expect(result.usage.inputTokens).toBe(100);
        expect(result.usage.outputTokens).toBe(50);
    });

    it('persists turn to database', async () => {
        const loop = new AgentLoop({
            inferenceRouter: makeMockRouter(),
            turnsRepo,
            logger,
            getTier: () => 'high',
        });

        await loop.executeTurn({
            role: 'user',
            content: 'Persist me',
            sessionId: 'persist-session',
        });

        const turns = turnsRepo.findBySession('persist-session');
        expect(turns.length).toBe(1);
        expect(turns[0]!.model).toBe('test-model');
        expect(turns[0]!.cost_cents).toBe(5);
    });

    it('propagates inference errors', async () => {
        const failRouter: InferenceRouter = {
            async route(): Promise<InferenceResponse> {
                throw new Error('inference failure');
            },
        };

        const loop = new AgentLoop({
            inferenceRouter: failRouter,
            turnsRepo,
            logger,
            getTier: () => 'normal',
        });

        await expect(loop.executeTurn({
            role: 'user',
            content: 'fail',
            sessionId: 'fail-session',
        })).rejects.toThrow('inference failure');
    });
});

// ── Heartbeat Daemon ────────────────────────────────────────────────────

describe('HeartbeatDaemon', () => {
    let db: Database.Database;
    let heartbeatRepo: HeartbeatRepository;

    beforeEach(() => {
        db = openTestDatabase(logger);
        heartbeatRepo = new HeartbeatRepository(db);
    });

    it('registers task and creates schedule row', () => {
        const daemon = new HeartbeatDaemon({
            heartbeatRepo,
            logger,
            getTier: () => 'normal',
            instanceId: 'test-instance',
        });

        daemon.registerTask({
            name: 'health-check',
            cronExpression: '*/5 * * * *',
            minTier: 'critical',
            handler: async () => 'success',
        });

        const schedule = heartbeatRepo.findSchedule('health-check');
        expect(schedule).toBeDefined();
        expect(schedule!.cron).toBe('*/5 * * * *');
        expect(schedule!.enabled).toBe(1);
    });

    it('tick executes registered tasks', async () => {
        let executed = false;
        const daemon = new HeartbeatDaemon({
            heartbeatRepo,
            logger,
            getTier: () => 'normal',
            instanceId: 'test-instance',
        });

        daemon.registerTask({
            name: 'test-task',
            cronExpression: '* * * * *',
            minTier: 'critical',
            handler: async () => {
                executed = true;
                return 'success';
            },
        });

        await daemon.tick();
        expect(executed).toBe(true);
    });

    it('tick records history', async () => {
        const daemon = new HeartbeatDaemon({
            heartbeatRepo,
            logger,
            getTier: () => 'normal',
            instanceId: 'test-instance',
        });

        daemon.registerTask({
            name: 'history-task',
            cronExpression: '* * * * *',
            minTier: 'critical',
            handler: async () => 'success',
        });

        await daemon.tick();
        const history = heartbeatRepo.findHistory('history-task', 10);
        expect(history.length).toBe(1);
        expect(history[0]!.result).toBe('success');
    });

    it('skips tasks when tier is too low', async () => {
        let executed = false;
        const daemon = new HeartbeatDaemon({
            heartbeatRepo,
            logger,
            getTier: () => 'critical', // lowest tier
            instanceId: 'test-instance',
        });

        daemon.registerTask({
            name: 'high-tier-only',
            cronExpression: '* * * * *',
            minTier: 'high', // requires high tier
            handler: async () => {
                executed = true;
                return 'success';
            },
        });

        await daemon.tick();
        expect(executed).toBe(false);
    });

    it('handles task errors gracefully', async () => {
        const daemon = new HeartbeatDaemon({
            heartbeatRepo,
            logger,
            getTier: () => 'normal',
            instanceId: 'test-instance',
        });

        daemon.registerTask({
            name: 'failing-task',
            cronExpression: '* * * * *',
            minTier: 'critical',
            handler: async () => {
                throw new Error('task crashed');
            },
        });

        // Should not throw
        await daemon.tick();

        // Error recorded in history
        const history = heartbeatRepo.findHistory('failing-task', 10);
        expect(history.length).toBe(1);
        expect(history[0]!.error).toBe('task crashed');
    });

    it('start/stop lifecycle', () => {
        const daemon = new HeartbeatDaemon({
            heartbeatRepo,
            logger,
            getTier: () => 'normal',
            instanceId: 'test-instance',
        });

        expect(daemon.isRunning).toBe(false);
        daemon.start();
        expect(daemon.isRunning).toBe(true);
        daemon.stop();
        expect(daemon.isRunning).toBe(false);
    });

    it('start is idempotent', () => {
        const daemon = new HeartbeatDaemon({
            heartbeatRepo,
            logger,
            getTier: () => 'normal',
            instanceId: 'test-instance',
        });

        daemon.start();
        daemon.start(); // no-op
        expect(daemon.isRunning).toBe(true);
        daemon.stop();
    });
});

// ── MCP Gateway ─────────────────────────────────────────────────────────

describe('McpGateway', () => {
    let toolRegistry: ToolRegistry;

    beforeEach(() => {
        toolRegistry = new ToolRegistry(logger);
        toolRegistry.register({
            name: 'test-tool',
            description: 'A test tool',
            category: 'diagnostics',
            riskLevel: 'safe',
            requiredAuthority: 'self',
            mcpExposed: true,
            auditFields: [],
            inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
        });
    });

    function makeGateway(readResource?: (uri: string) => Promise<string>) {
        return new McpGateway({ toolRegistry, logger, readResource });
    }

    function rpc(method: string, params?: Record<string, unknown>): JsonRpcRequest {
        return { jsonrpc: '2.0', id: 1, method, params };
    }

    it('initialize returns protocol version and capabilities', async () => {
        const gw = makeGateway();
        const res = await gw.handleRequest(rpc('initialize'));
        expect(res.error).toBeUndefined();
        const result = res.result as Record<string, unknown>;
        expect(result['protocolVersion']).toBe('2025-06-18');
        expect(result['serverInfo']).toEqual({ name: 'web4-agent', version: '0.1.0' });
    });

    it('tools/list returns MCP-exposed tools', async () => {
        const gw = makeGateway();
        const res = await gw.handleRequest(rpc('tools/list'));
        const result = res.result as { tools: Array<{ name: string }> };
        expect(result.tools.length).toBe(1);
        expect(result.tools[0]!.name).toBe('test-tool');
    });

    it('tools/list excludes non-MCP tools', async () => {
        toolRegistry.register({
            name: 'internal-tool',
            description: 'Not exposed',
            category: 'survival',
            riskLevel: 'dangerous',
            requiredAuthority: 'creator',
            mcpExposed: false,
            auditFields: [],
            inputSchema: {},
        });

        const gw = makeGateway();
        const res = await gw.handleRequest(rpc('tools/list'));
        const result = res.result as { tools: Array<{ name: string }> };
        expect(result.tools.length).toBe(1); // Only test-tool
    });

    it('tools/call returns stub response for known tool', async () => {
        const gw = makeGateway();
        const res = await gw.handleRequest(rpc('tools/call', { name: 'test-tool', arguments: { input: 'hello' } }));
        expect(res.error).toBeUndefined();
        const result = res.result as { content: Array<{ type: string; text: string }> };
        expect(result.content[0]!.text).toContain('test-tool');
    });

    it('tools/call returns error for unknown tool', async () => {
        const gw = makeGateway();
        const res = await gw.handleRequest(rpc('tools/call', { name: 'unknown' }));
        expect(res.error).toBeDefined();
        expect(res.error!.code).toBe(-32601);
    });

    it('resources/list includes default resources', async () => {
        const gw = makeGateway();
        const res = await gw.handleRequest(rpc('resources/list'));
        const result = res.result as { resources: Array<{ uri: string }> };
        const uris = result.resources.map((r) => r.uri);
        expect(uris).toContain('agent://status');
        expect(uris).toContain('agent://tools');
    });

    it('resources/read returns content for known resource', async () => {
        const gw = makeGateway(async (uri) => JSON.stringify({ status: 'ok' }));
        const res = await gw.handleRequest(rpc('resources/read', { uri: 'agent://status' }));
        expect(res.error).toBeUndefined();
        const result = res.result as { contents: Array<{ text: string }> };
        expect(result.contents[0]!.text).toContain('ok');
    });

    it('resources/read returns error for unknown resource', async () => {
        const gw = makeGateway();
        const res = await gw.handleRequest(rpc('resources/read', { uri: 'agent://unknown' }));
        expect(res.error).toBeDefined();
        expect(res.error!.code).toBe(-32601);
    });

    it('unknown method returns METHOD_NOT_FOUND', async () => {
        const gw = makeGateway();
        const res = await gw.handleRequest(rpc('unknown/method'));
        expect(res.error).toBeDefined();
        expect(res.error!.code).toBe(-32601);
    });

    it('invalid jsonrpc version returns INVALID_REQUEST', async () => {
        const gw = makeGateway();
        const res = await gw.handleRequest({ jsonrpc: '1.0' as '2.0', id: 1, method: 'initialize' });
        expect(res.error).toBeDefined();
        expect(res.error!.code).toBe(-32600);
    });

    it('addResource makes new resource available', async () => {
        const gw = makeGateway(async () => '{"soul":"test"}');
        gw.addResource({
            uri: 'agent://soul',
            name: 'Soul',
            description: 'Agent soul data',
            mimeType: 'application/json',
        });
        const res = await gw.handleRequest(rpc('resources/read', { uri: 'agent://soul' }));
        expect(res.error).toBeUndefined();
    });
});
