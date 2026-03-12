/**
 * ToolFactory — Generates the three-layer tool matrix for the OpenClaw bridge.
 *
 * Produces:
 * 1. Agent tools (ToolDefinition + handler) — for ReAct loop
 * 2. CLI commands — metadata for conshell CLI subcommands
 * 3. MCP tools — exposed via McpGateway with x402 pricing
 *
 * Each tool is policy-gated via the existing ToolExecutor/PolicyEngine pipeline.
 */
import type { ToolDefinition, CapabilityId, ToolCategory } from '@conshell/core';
import type {
    BrowserProvider,
    BrowserSession,
    ClawHubAdapter,
    ChannelRouter,
} from './types.js';

/** Handler function type (same as runtime tools). */
export type BridgeToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface BridgeToolBundle {
    readonly definition: ToolDefinition;
    readonly handler: BridgeToolHandler;
}

// ── Browser Agent Tools ─────────────────────────────────────────────────

export function createBrowserAgentTools(provider: BrowserProvider): readonly BridgeToolBundle[] {
    return [
        {
            definition: {
                name: 'cdp_navigate',
                category: 'browser',
                description: 'Navigate to a URL using the active browser provider and return page text content.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: 'URL to navigate to' },
                        waitAfter: { type: 'number', description: 'Milliseconds to wait after load (default 2000)' },
                    },
                    required: ['url'],
                },
                riskLevel: 'caution',
                requiredAuthority: 'self',
                mcpExposed: true,
                auditFields: ['url'],
                requiredCapabilities: ['browser_control'],
            },
            handler: async (args) => {
                const session = await provider.launch();
                try {
                    const info = await session.navigate(
                        args['url'] as string,
                        { waitAfter: (args['waitAfter'] as number) ?? 2000 },
                    );
                    return JSON.stringify(info);
                } finally {
                    await session.close();
                }
            },
        },
        {
            definition: {
                name: 'cdp_evaluate',
                category: 'browser',
                description: 'Execute JavaScript in the browser page context and return the result.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: 'URL to navigate to first' },
                        expression: { type: 'string', description: 'JavaScript expression to evaluate' },
                    },
                    required: ['url', 'expression'],
                },
                riskLevel: 'dangerous',
                requiredAuthority: 'self',
                mcpExposed: false,
                auditFields: ['url', 'expression'],
                requiredCapabilities: ['browser_control'],
            },
            handler: async (args) => {
                const session = await provider.launch();
                try {
                    await session.navigate(args['url'] as string);
                    const result = await session.evaluate(args['expression'] as string);
                    return JSON.stringify({ result });
                } finally {
                    await session.close();
                }
            },
        },
        {
            definition: {
                name: 'cdp_screenshot',
                category: 'browser',
                description: 'Navigate to a URL and take a screenshot, returning base64 PNG data.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: 'URL to screenshot' },
                        fullPage: { type: 'boolean', description: 'Capture full scrollable page (default false)' },
                    },
                    required: ['url'],
                },
                riskLevel: 'safe',
                requiredAuthority: 'self',
                mcpExposed: true,
                auditFields: ['url'],
                requiredCapabilities: ['browser_control'],
            },
            handler: async (args) => {
                const session = await provider.launch();
                try {
                    await session.navigate(args['url'] as string);
                    const result = await session.screenshot({
                        fullPage: (args['fullPage'] as boolean) ?? false,
                    });
                    const base64 = result.data.toString('base64');
                    return JSON.stringify({
                        format: result.format,
                        base64Length: base64.length,
                        base64: base64.slice(0, 4000) + (base64.length > 4000 ? '...' : ''),
                    });
                } finally {
                    await session.close();
                }
            },
        },
        {
            definition: {
                name: 'cdp_dom_query',
                category: 'browser',
                description: 'Navigate to a URL and query the DOM for elements matching a CSS selector.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: 'URL to query' },
                        selector: { type: 'string', description: 'CSS selector' },
                    },
                    required: ['url', 'selector'],
                },
                riskLevel: 'safe',
                requiredAuthority: 'self',
                mcpExposed: true,
                auditFields: ['url', 'selector'],
                requiredCapabilities: ['browser_control'],
            },
            handler: async (args) => {
                const session = await provider.launch();
                try {
                    await session.navigate(args['url'] as string);
                    const elements = await session.querySelector(args['selector'] as string);
                    return JSON.stringify({ count: elements.length, elements });
                } finally {
                    await session.close();
                }
            },
        },
    ];
}

// ── ClawHub Agent Tools ─────────────────────────────────────────────────

export function createClawHubAgentTools(adapter: ClawHubAdapter): readonly BridgeToolBundle[] {
    return [
        {
            definition: {
                name: 'clawhub_search',
                category: 'skills',
                description: 'Search the ClawHub community skill registry for available skills.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Search query' },
                        limit: { type: 'number', description: 'Max results (default 10)' },
                        category: { type: 'string', description: 'Filter by category' },
                    },
                    required: ['query'],
                },
                riskLevel: 'safe',
                requiredAuthority: 'self',
                mcpExposed: true,
                auditFields: ['query'],
                requiredCapabilities: ['network' as CapabilityId],
            },
            handler: async (args) => {
                const results = await adapter.search(
                    args['query'] as string,
                    {
                        limit: (args['limit'] as number) ?? 10,
                        category: args['category'] as string | undefined,
                    },
                );
                return JSON.stringify({ count: results.length, results });
            },
        },
        {
            definition: {
                name: 'clawhub_install',
                category: 'skills',
                description: 'Install a skill from ClawHub to the local skill directory. Runs security audit first.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Skill name to install' },
                        targetDir: { type: 'string', description: 'Local directory to install into' },
                    },
                    required: ['name', 'targetDir'],
                },
                riskLevel: 'caution',
                requiredAuthority: 'self',
                mcpExposed: false,
                auditFields: ['name'],
                requiredCapabilities: ['file_write' as CapabilityId, 'network' as CapabilityId],
            },
            handler: async (args) => {
                const info = await adapter.install(
                    args['name'] as string,
                    args['targetDir'] as string,
                );
                return JSON.stringify(info);
            },
        },
        {
            definition: {
                name: 'clawhub_audit',
                category: 'skills',
                description: 'Run a security audit on a ClawHub skill before installation.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Skill name to audit' },
                    },
                    required: ['name'],
                },
                riskLevel: 'safe',
                requiredAuthority: 'self',
                mcpExposed: true,
                auditFields: ['name'],
                requiredCapabilities: ['network' as CapabilityId],
            },
            handler: async (args) => {
                const manifest = await adapter.getManifest(args['name'] as string);
                const report = await adapter.audit(manifest);
                return JSON.stringify(report);
            },
        },
    ];
}

// ── Channel Agent Tools ─────────────────────────────────────────────────

export function createChannelAgentTools(router: ChannelRouter): readonly BridgeToolBundle[] {
    return [
        {
            definition: {
                name: 'channel_list',
                category: 'communication' as ToolCategory,
                description: 'List all active messaging channels and their status.',
                inputSchema: { type: 'object', properties: {} },
                riskLevel: 'safe',
                requiredAuthority: 'self',
                mcpExposed: true,
                auditFields: [],
                requiredCapabilities: [],
            },
            handler: async () => {
                const channels = router.listChannels();
                return JSON.stringify({ count: channels.length, channels });
            },
        },
        {
            definition: {
                name: 'channel_broadcast',
                category: 'communication' as ToolCategory,
                description: 'Send a message through a specific channel by its ID.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        channelId: { type: 'string', description: 'Target channel ID' },
                        content: { type: 'string', description: 'Message content' },
                    },
                    required: ['channelId', 'content'],
                },
                riskLevel: 'caution',
                requiredAuthority: 'self',
                mcpExposed: true,
                auditFields: ['channelId'],
                requiredCapabilities: ['network' as CapabilityId],
            },
            handler: async (args) => {
                await router.send(
                    args['channelId'] as string,
                    { content: args['content'] as string },
                );
                return JSON.stringify({ success: true, channelId: args['channelId'] });
            },
        },
        {
            definition: {
                name: 'channel_create',
                category: 'communication' as ToolCategory,
                description: 'Register a new messaging channel (Telegram, Discord, Slack, Webhook).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', description: 'Channel type: telegram, discord, slack, whatsapp, webhook' },
                        label: { type: 'string', description: 'Human-readable label' },
                        token: { type: 'string', description: 'API token or bot secret' },
                        chatId: { type: 'string', description: 'Chat/channel ID' },
                        isolated: { type: 'boolean', description: 'Create isolated workspace (default false)' },
                    },
                    required: ['type', 'label', 'token'],
                },
                riskLevel: 'dangerous',
                requiredAuthority: 'self',
                mcpExposed: false,
                auditFields: ['type', 'label'],
                requiredCapabilities: ['network' as CapabilityId],
            },
            handler: async (args) => {
                const channelType = args['type'] as 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'webhook';
                const channelId = await router.addChannel({
                    type: channelType,
                    label: args['label'] as string,
                    credentials: {
                        token: args['token'] as string,
                        ...(args['chatId'] ? { chat_id: args['chatId'] as string } : {}),
                    },
                    isolated: (args['isolated'] as boolean) ?? false,
                });
                return JSON.stringify({ channelId, success: true });
            },
        },
        {
            definition: {
                name: 'channel_isolate',
                category: 'communication' as ToolCategory,
                description: 'Create an isolated agent workspace for a specific channel.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        channelId: { type: 'string', description: 'Channel to isolate' },
                    },
                    required: ['channelId'],
                },
                riskLevel: 'dangerous',
                requiredAuthority: 'self',
                mcpExposed: false,
                auditFields: ['channelId'],
                requiredCapabilities: ['file_write' as CapabilityId],
            },
            handler: async (args) => {
                const instance = await router.isolate(args['channelId'] as string);
                return JSON.stringify(instance);
            },
        },
    ];
}

// ── Aggregate ───────────────────────────────────────────────────────────

export interface BridgeToolFactoryOptions {
    readonly browserProvider: BrowserProvider;
    readonly clawHubAdapter: ClawHubAdapter;
    readonly channelRouter: ChannelRouter;
    /** Optional: Network interceptor for CDP network tools. */
    readonly networkInterceptor?: {
        evaluateRequest(url: string, method: string, headers: Record<string, string>, resourceType: string): {
            action: string; matchedRule?: unknown; modifiedHeaders?: Record<string, string>;
        };
        getLog(): readonly unknown[];
        clearLog(): void;
    };
    /** Optional: Anti-detection middleware for stealth browsing. */
    readonly antiDetect?: {
        apply(session: BrowserSession): Promise<void>;
        getConfig(): unknown;
    };
    /** Optional: Namespace manager for WsGateway isolation. */
    readonly namespaceManager?: {
        createNamespace(config: { id: string; label: string; isolated?: boolean }): string;
        removeNamespace(id: string): boolean;
        listNamespaces(): readonly { id: string; label: string; clientCount: number; isolated: boolean; createdAt: number }[];
        joinNamespace(clientId: string, namespaceId: string): boolean;
    };
}

// ── Wave 3: CDP Network & Anti-Detection Agent Tools ────────────────────

export function createCdpNetworkAgentTools(
    provider: BrowserProvider,
    interceptor?: BridgeToolFactoryOptions['networkInterceptor'],
    antiDetect?: BridgeToolFactoryOptions['antiDetect'],
): readonly BridgeToolBundle[] {
    const tools: BridgeToolBundle[] = [];

    if (interceptor) {
        tools.push({
            definition: {
                name: 'cdp_network_intercept',
                category: 'browser',
                description: 'Configure network request interception rules and view intercepted request log.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', description: 'Action: "get_log", "clear_log", or "check_url"' },
                        url: { type: 'string', description: 'URL to evaluate against rules (for check_url)' },
                        method: { type: 'string', description: 'HTTP method (for check_url, default GET)' },
                    },
                    required: ['action'],
                },
                riskLevel: 'dangerous',
                requiredAuthority: 'self',
                mcpExposed: false,
                auditFields: ['action', 'url'],
                requiredCapabilities: ['browser_control'],
            },
            handler: async (args) => {
                const action = args['action'] as string;
                switch (action) {
                    case 'get_log':
                        return JSON.stringify(interceptor.getLog().slice(-50));
                    case 'clear_log':
                        interceptor.clearLog();
                        return JSON.stringify({ cleared: true });
                    case 'check_url': {
                        const result = interceptor.evaluateRequest(
                            args['url'] as string,
                            (args['method'] as string) ?? 'GET',
                            {},
                            'document',
                        );
                        return JSON.stringify(result);
                    }
                    default:
                        return JSON.stringify({ error: `Unknown action: ${action}` });
                }
            },
        });
    }

    if (antiDetect) {
        tools.push({
            definition: {
                name: 'cdp_anti_detect',
                category: 'browser',
                description: 'Apply anti-detection middleware to the current browser session for stealth browsing.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: 'URL to navigate to after applying anti-detection' },
                    },
                    required: ['url'],
                },
                riskLevel: 'caution',
                requiredAuthority: 'self',
                mcpExposed: false,
                auditFields: ['url'],
                requiredCapabilities: ['browser_control'],
            },
            handler: async (args) => {
                const session = await provider.launch();
                try {
                    await antiDetect.apply(session);
                    const page = await session.navigate(args['url'] as string);
                    return JSON.stringify({
                        url: page.url,
                        title: page.title,
                        antiDetect: antiDetect.getConfig(),
                        textLength: page.textLength,
                    });
                } finally {
                    await session.close();
                }
            },
        });
    }

    return tools;
}

// ── Wave 4: Namespace Agent Tools ───────────────────────────────────────

export function createNamespaceAgentTools(
    manager?: BridgeToolFactoryOptions['namespaceManager'],
): readonly BridgeToolBundle[] {
    if (!manager) return [];

    return [
        {
            definition: {
                name: 'namespace_create',
                category: 'communication' as ToolDefinition['category'],
                description: 'Create a new WsGateway namespace for channel isolation.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'Namespace ID' },
                        label: { type: 'string', description: 'Human-readable label' },
                        isolated: { type: 'boolean', description: 'Whether namespace is isolated' },
                    },
                    required: ['id', 'label'],
                },
                riskLevel: 'caution',
                requiredAuthority: 'self',
                mcpExposed: true,
                auditFields: ['id', 'label'],
                requiredCapabilities: ['network' as ToolDefinition['requiredCapabilities'] extends readonly (infer U)[] ? U : never],
            },
            handler: async (args) => {
                const nsId = manager.createNamespace({
                    id: args['id'] as string,
                    label: args['label'] as string,
                    isolated: args['isolated'] as boolean | undefined,
                });
                return JSON.stringify({ created: true, namespaceId: nsId });
            },
        },
        {
            definition: {
                name: 'namespace_list',
                category: 'communication' as ToolDefinition['category'],
                description: 'List all WsGateway namespaces with their status.',
                inputSchema: { type: 'object', properties: {} },
                riskLevel: 'safe',
                requiredAuthority: 'self',
                mcpExposed: true,
                auditFields: [],
                requiredCapabilities: ['network' as ToolDefinition['requiredCapabilities'] extends readonly (infer U)[] ? U : never],
            },
            handler: async () => JSON.stringify(manager.listNamespaces()),
        },
        {
            definition: {
                name: 'namespace_join',
                category: 'communication' as ToolDefinition['category'],
                description: 'Join a client to a WsGateway namespace.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        clientId: { type: 'string', description: 'Client connection ID' },
                        namespaceId: { type: 'string', description: 'Namespace to join' },
                    },
                    required: ['clientId', 'namespaceId'],
                },
                riskLevel: 'caution',
                requiredAuthority: 'self',
                mcpExposed: false,
                auditFields: ['clientId', 'namespaceId'],
                requiredCapabilities: ['network' as ToolDefinition['requiredCapabilities'] extends readonly (infer U)[] ? U : never],
            },
            handler: async (args) => {
                const joined = manager.joinNamespace(args['clientId'] as string, args['namespaceId'] as string);
                return JSON.stringify({ joined });
            },
        },
    ];
}

/**
 * Create all bridge tools for registration with the ToolExecutor.
 * Returns definitions and handlers ready for `ToolExecutor.registerHandler()`.
 */
export function createAllBridgeTools(options: BridgeToolFactoryOptions): {
    definitions: readonly ToolDefinition[];
    handlers: ReadonlyMap<string, BridgeToolHandler>;
} {
    const bundles = [
        ...createBrowserAgentTools(options.browserProvider),
        ...createClawHubAgentTools(options.clawHubAdapter),
        ...createChannelAgentTools(options.channelRouter),
        ...createCdpNetworkAgentTools(options.browserProvider, options.networkInterceptor, options.antiDetect),
        ...createNamespaceAgentTools(options.namespaceManager),
    ];

    const definitions = bundles.map(b => b.definition);
    const handlers = new Map(bundles.map(b => [b.definition.name, b.handler]));

    return { definitions, handlers };
}

