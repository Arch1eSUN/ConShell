/**
 * Tests for web tools, paid tools, tool executor, and MCP x402 gating.
 */
import { describe, it, expect } from 'vitest';
import {
    stripHtml,
    webSearchDefinition,
    webBrowseDefinition,
    readRssDefinition,
    WEB_TOOL_DEFINITIONS,
    WEB_TOOL_HANDLERS,
} from './tools/web-tools.js';
import {
    PAID_TOOL_CONFIGS,
    PAID_TOOL_DEFINITIONS,
    createDocumentSummaryHandler,
    createCodeReviewHandler,
    createKnowledgeQueryHandler,
    createPaidToolHandlers,
} from './tools/paid-tools.js';

// ── HTML Stripping ──────────────────────────────────────────────────────

describe('stripHtml', () => {
    it('removes HTML tags', () => {
        expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
    });

    it('removes script tags and content', () => {
        expect(stripHtml('<script>alert("x")</script>text')).toBe('text');
    });

    it('removes style tags and content', () => {
        expect(stripHtml('<style>.x{}</style>content')).toBe('content');
    });

    it('decodes HTML entities', () => {
        expect(stripHtml('&amp; &lt; &gt; &quot; &#39;')).toBe('& < > " \'');
    });

    it('normalizes whitespace', () => {
        expect(stripHtml('hello   \n\n  world')).toBe('hello world');
    });

    it('handles empty string', () => {
        expect(stripHtml('')).toBe('');
    });
});

// ── Web Tool Definitions ────────────────────────────────────────────────

describe('Web Tool Definitions', () => {
    it('web_search has correct shape', () => {
        expect(webSearchDefinition.name).toBe('web_search');
        expect(webSearchDefinition.category).toBe('web');
        expect(webSearchDefinition.riskLevel).toBe('caution');
        expect(webSearchDefinition.mcpExposed).toBe(true);
    });

    it('web_browse has correct shape', () => {
        expect(webBrowseDefinition.name).toBe('web_browse');
        expect(webBrowseDefinition.category).toBe('web');
        expect(webBrowseDefinition.riskLevel).toBe('caution');
    });

    it('read_rss has correct shape', () => {
        expect(readRssDefinition.name).toBe('read_rss');
        expect(readRssDefinition.category).toBe('web');
        expect(readRssDefinition.riskLevel).toBe('safe');
    });

    it('WEB_TOOL_DEFINITIONS contains all 3 tools', () => {
        expect(WEB_TOOL_DEFINITIONS.length).toBe(3);
    });

    it('WEB_TOOL_HANDLERS has matching entries', () => {
        expect(WEB_TOOL_HANDLERS.size).toBe(3);
        expect(WEB_TOOL_HANDLERS.has('web_search')).toBe(true);
        expect(WEB_TOOL_HANDLERS.has('web_browse')).toBe(true);
        expect(WEB_TOOL_HANDLERS.has('read_rss')).toBe(true);
    });
});

// ── Web Tool Handlers (unit, no network) ────────────────────────────────

describe('Web Tool Handlers (validation)', () => {
    it('web_search rejects empty query', async () => {
        const handler = WEB_TOOL_HANDLERS.get('web_search')!;
        const result = JSON.parse(await handler({ query: '' }));
        expect(result.error).toContain('empty');
    });

    it('web_browse rejects invalid URL', async () => {
        const handler = WEB_TOOL_HANDLERS.get('web_browse')!;
        const result = JSON.parse(await handler({ url: 'not-a-url' }));
        expect(result.error).toContain('Invalid URL');
    });

    it('read_rss rejects invalid feed URL', async () => {
        const handler = WEB_TOOL_HANDLERS.get('read_rss')!;
        const result = JSON.parse(await handler({ feedUrl: '' }));
        expect(result.error).toContain('Invalid feed URL');
    });
});

// ── Paid Tool Definitions ───────────────────────────────────────────────

describe('Paid Tool Definitions', () => {
    it('has 3 paid tool configs', () => {
        expect(PAID_TOOL_CONFIGS.length).toBe(3);
    });

    it('knowledge_query has $0.01 price', () => {
        const kq = PAID_TOOL_CONFIGS.find(c => c.definition.name === 'knowledge_query');
        expect(kq).toBeDefined();
        expect(kq!.priceCents).toBe(1);
    });

    it('document_summary has $0.05 price', () => {
        const ds = PAID_TOOL_CONFIGS.find(c => c.definition.name === 'document_summary');
        expect(ds).toBeDefined();
        expect(ds!.priceCents).toBe(5);
    });

    it('code_review has $0.10 price', () => {
        const cr = PAID_TOOL_CONFIGS.find(c => c.definition.name === 'code_review');
        expect(cr).toBeDefined();
        expect(cr!.priceCents).toBe(10);
    });

    it('all paid tools are MCP-exposed', () => {
        for (const def of PAID_TOOL_DEFINITIONS) {
            expect(def.mcpExposed).toBe(true);
        }
    });

    it('all paid tools have external authority', () => {
        for (const def of PAID_TOOL_DEFINITIONS) {
            expect(def.requiredAuthority).toBe('external');
        }
    });
});

// ── Paid Tool Handlers ──────────────────────────────────────────────────

describe('Paid Tool Handlers', () => {
    it('document_summary extracts key sentences', async () => {
        const handler = createDocumentSummaryHandler();
        const result = JSON.parse(await handler({
            text: 'This is the first important sentence about AI agents. ' +
                'This is a second sentence that provides context. ' +
                'The third sentence offers additional detail about the topic.',
        }));
        expect(result.summary).toBeDefined();
        expect(result.method).toBe('extractive');
    });

    it('document_summary rejects empty text', async () => {
        const handler = createDocumentSummaryHandler();
        const result = JSON.parse(await handler({ text: '' }));
        expect(result.error).toContain('empty');
    });

    it('code_review detects console.log in typescript', async () => {
        const handler = createCodeReviewHandler();
        const result = JSON.parse(await handler({
            code: 'function test() {\n  console.log("debug");\n  return true;\n}',
            language: 'typescript',
        }));
        expect(result.issueCount).toBeGreaterThan(0);
        expect(result.issues.some((i: { type: string }) => i.type === 'warning')).toBe(true);
    });

    it('code_review detects potential secrets', async () => {
        const handler = createCodeReviewHandler();
        const result = JSON.parse(await handler({
            code: 'const apiKey = "sk-abc123def456";\n',
            language: 'typescript',
        }));
        expect(result.issues.some((i: { type: string }) => i.type === 'security')).toBe(true);
    });

    it('code_review reports no issues on clean code', async () => {
        const handler = createCodeReviewHandler();
        const result = JSON.parse(await handler({
            code: 'function add(a: number, b: number): number {\n  return a + b;\n}',
            language: 'typescript',
        }));
        expect(result.issueCount).toBe(0);
    });

    it('knowledge_query returns empty results when no memory', async () => {
        const handler = createKnowledgeQueryHandler({});
        const result = JSON.parse(await handler({ query: 'test' }));
        expect(result.message).toContain('not yet populated');
    });

    it('knowledge_query rejects empty query', async () => {
        const handler = createKnowledgeQueryHandler({});
        const result = JSON.parse(await handler({ query: '' }));
        expect(result.error).toContain('empty');
    });

    it('createPaidToolHandlers returns 3 handlers', () => {
        const handlers = createPaidToolHandlers({});
        expect(handlers.size).toBe(3);
        expect(handlers.has('knowledge_query')).toBe(true);
        expect(handlers.has('document_summary')).toBe(true);
        expect(handlers.has('code_review')).toBe(true);
    });
});

// ── Tool Executor ───────────────────────────────────────────────────────

describe('ToolExecutor', () => {
    // Import ToolExecutor with inline lazy import to avoid circular deps
    it('registers and executes handlers', async () => {
        const { ToolExecutor } = await import('./tool-executor.js');
        const { PolicyEngine, ToolRegistry } = await import('@web4-agent/policy');
        const { createTestLogger } = await import('@web4-agent/core');

        const { logger } = createTestLogger();
        const toolRegistry = new ToolRegistry(logger);
        toolRegistry.register({
            name: 'test_tool',
            category: 'web',
            description: 'Test tool',
            inputSchema: {},
            riskLevel: 'safe',
            requiredAuthority: 'self',
            mcpExposed: true,
            auditFields: [],
        });

        const engine = new PolicyEngine(
            [],
            { insert: () => 0 } as any,
            (name: string) => toolRegistry.getDefinition(name),
            logger,
        );

        const executor = new ToolExecutor({
            policyEngine: engine,
            logger,
            getAgentState: () => 'running',
            getSurvivalTier: () => 'normal',
        });

        executor.registerHandler('test_tool', async (args) => {
            return JSON.stringify({ echo: args['input'] });
        });

        expect(executor.hasHandler('test_tool')).toBe(true);
        expect(executor.handlerCount).toBe(1);

        const result = await executor.execute({
            name: 'test_tool',
            args: { input: 'hello' },
            source: 'agent',
        });

        const parsed = JSON.parse(result.result);
        expect(parsed.echo).toBe('hello');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.truncated).toBe(false);
    });

    it('returns error for unknown tool (denied by policy)', async () => {
        const { ToolExecutor } = await import('./tool-executor.js');
        const { PolicyEngine } = await import('@web4-agent/policy');
        const { createTestLogger } = await import('@web4-agent/core');

        const { logger } = createTestLogger();
        // getDefinition returns undefined → policy denies the call
        const engine = new PolicyEngine(
            [],
            { insert: () => 0 } as any,
            () => undefined,
            logger,
        );

        const executor = new ToolExecutor({
            policyEngine: engine,
            logger,
            getAgentState: () => 'running',
            getSurvivalTier: () => 'normal',
        });

        const result = await executor.execute({
            name: 'nonexistent',
            args: {},
            source: 'agent',
        });

        const parsed = JSON.parse(result.result);
        // Policy denies before handler lookup when tool definition unknown
        expect(parsed.error).toBeDefined();
    });
});

// ── MCP x402 Payment Gating ────────────────────────────────────────────

describe('MCP x402 Payment Gating', () => {
    it('returns payment-required for priced tool without signature', async () => {
        const { McpGateway } = await import('./mcp-gateway.js');
        const { ToolRegistry } = await import('@web4-agent/policy');
        const { createTestLogger } = await import('@web4-agent/core');

        const { logger } = createTestLogger();
        const toolRegistry = new ToolRegistry(logger);
        toolRegistry.register({
            name: 'paid_tool',
            category: 'web',
            description: 'A paid tool',
            inputSchema: {},
            riskLevel: 'safe',
            requiredAuthority: 'external',
            mcpExposed: true,
            auditFields: [],
        });

        const toolPrices = new Map([['paid_tool', 100]]); // $1.00
        const gw = new McpGateway({ toolRegistry, logger, toolPrices });

        const res = await gw.handleRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'paid_tool', arguments: {} },
        });

        expect(res.error).toBeDefined();
        expect(res.error!.code).toBe(-32402);
        const errorData = JSON.parse(res.error!.message);
        expect(errorData.type).toBe('x402-payment-required');
        expect(errorData.priceCents).toBe(100);
    });

    it('allows free tools without payment', async () => {
        const { McpGateway } = await import('./mcp-gateway.js');
        const { ToolRegistry } = await import('@web4-agent/policy');
        const { createTestLogger } = await import('@web4-agent/core');

        const { logger } = createTestLogger();
        const toolRegistry = new ToolRegistry(logger);
        toolRegistry.register({
            name: 'free_tool',
            category: 'web',
            description: 'A free tool',
            inputSchema: {},
            riskLevel: 'safe',
            requiredAuthority: 'self',
            mcpExposed: true,
            auditFields: [],
        });

        const toolPrices = new Map<string, number>(); // No prices = all free
        const gw = new McpGateway({ toolRegistry, logger, toolPrices });

        const res = await gw.handleRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'free_tool', arguments: {} },
        });

        expect(res.error).toBeUndefined();
        expect(res.result).toBeDefined();
    });

    it('allows paid tool with payment signature', async () => {
        const { McpGateway } = await import('./mcp-gateway.js');
        const { ToolRegistry } = await import('@web4-agent/policy');
        const { createTestLogger } = await import('@web4-agent/core');

        const { logger } = createTestLogger();
        const toolRegistry = new ToolRegistry(logger);
        toolRegistry.register({
            name: 'paid_tool',
            category: 'web',
            description: 'A paid tool',
            inputSchema: {},
            riskLevel: 'safe',
            requiredAuthority: 'external',
            mcpExposed: true,
            auditFields: [],
        });

        const toolPrices = new Map([['paid_tool', 50]]);
        const gw = new McpGateway({ toolRegistry, logger, toolPrices });

        const res = await gw.handleRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'paid_tool',
                arguments: {},
                'x402-payment-signature': '0xsigned...',
            },
        });

        // Should succeed (stub response since no executor wired)
        expect(res.error).toBeUndefined();
        expect(res.result).toBeDefined();
    });
});
