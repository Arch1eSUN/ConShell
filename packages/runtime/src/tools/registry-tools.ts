/**
 * Registry Tools — MCP server and agent registry management.
 *
 * 5 tools matching Conway Automaton's registry category:
 * list_mcp_servers, install_mcp, uninstall_mcp, discover_agents, register_self
 */
import type { ToolDefinition } from '@conshell/core';
import type { ToolHandler } from './web-tools.js';

// ── Tool Definitions ────────────────────────────────────────────────────

export const listMcpServersDefinition: ToolDefinition = {
    name: 'list_mcp_servers',
    category: 'registry',
    description: 'List all installed MCP servers and their status.',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: [],
};

export const installMcpDefinition: ToolDefinition = {
    name: 'install_mcp',
    category: 'registry',
    description: 'Install a new MCP server from npm or a git URL.',
    inputSchema: {
        type: 'object',
        properties: {
            packageName: { type: 'string', description: 'npm package or git URL for MCP server' },
            transport: { type: 'string', enum: ['stdio', 'http'], description: 'Transport type (default stdio)' },
            config: { type: 'object', description: 'Optional MCP server configuration' },
        },
        required: ['packageName'],
    },
    riskLevel: 'dangerous',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['packageName'],
    requiredCapabilities: ['self_modify'],
};

export const uninstallMcpDefinition: ToolDefinition = {
    name: 'uninstall_mcp',
    category: 'registry',
    description: 'Uninstall a registered MCP server.',
    inputSchema: {
        type: 'object',
        properties: {
            serverId: { type: 'string', description: 'MCP server ID to uninstall' },
        },
        required: ['serverId'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['serverId'],
    requiredCapabilities: ['self_modify'],
};

export const discoverAgentsDefinition: ToolDefinition = {
    name: 'discover_agents',
    category: 'registry',
    description: 'Discover agents on the social relay. Returns addresses, capabilities, and trust scores.',
    inputSchema: {
        type: 'object',
        properties: {
            relayUrl: { type: 'string', description: 'Relay URL to discover agents on (default: configured relay)' },
            capability: { type: 'string', description: 'Optional capability filter' },
        },
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['relayUrl'],
    requiredCapabilities: ['internet_access'],
};

export const registerSelfDefinition: ToolDefinition = {
    name: 'register_self',
    category: 'registry',
    description: 'Register this agent on the social relay with capabilities and metadata.',
    inputSchema: {
        type: 'object',
        properties: {
            relayUrl: { type: 'string', description: 'Relay URL to register on' },
            capabilities: { type: 'array', items: { type: 'string' }, description: 'Capabilities to advertise' },
            description: { type: 'string', description: 'Agent description for registry' },
        },
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['relayUrl'],
    requiredCapabilities: ['internet_access'],
};

export const REGISTRY_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    listMcpServersDefinition, installMcpDefinition, uninstallMcpDefinition,
    discoverAgentsDefinition, registerSelfDefinition,
];

// ── Handler Deps ────────────────────────────────────────────────────────

export interface RegistryToolDeps {
    readonly listMcpServers?: () => Array<{ id: string; name: string; transport: string; status: string; toolCount: number }>;
    readonly installMcpServer?: (pkg: string, transport: string, config?: Record<string, unknown>) => Promise<{ id: string; installed: boolean }>;
    readonly uninstallMcpServer?: (serverId: string) => Promise<boolean>;
    readonly discoverAgents?: (relayUrl?: string, capability?: string) => Promise<Array<{ address: string; name: string; capabilities: string[] }>>;
    readonly registerSelf?: (relayUrl?: string, capabilities?: string[], description?: string) => Promise<boolean>;
}

// ── Handler Factory ─────────────────────────────────────────────────────

export function createRegistryToolHandlers(deps: RegistryToolDeps): ReadonlyMap<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    handlers.set('list_mcp_servers', async () => {
        if (!deps.listMcpServers) return JSON.stringify({ servers: [], count: 0 });
        const servers = deps.listMcpServers();
        return JSON.stringify({ servers, count: servers.length });
    });

    handlers.set('install_mcp', async (args) => {
        const pkg = args['packageName'] as string;
        const transport = (args['transport'] as string) ?? 'stdio';
        const config = args['config'] as Record<string, unknown> | undefined;
        if (!deps.installMcpServer) return JSON.stringify({ error: 'MCP registry not configured' });
        const result = await deps.installMcpServer(pkg, transport, config);
        return JSON.stringify({ packageName: pkg, ...result });
    });

    handlers.set('uninstall_mcp', async (args) => {
        const serverId = args['serverId'] as string;
        if (!deps.uninstallMcpServer) return JSON.stringify({ error: 'MCP registry not configured' });
        const removed = await deps.uninstallMcpServer(serverId);
        return JSON.stringify({ serverId, removed });
    });

    handlers.set('discover_agents', async (args) => {
        const relayUrl = args['relayUrl'] as string | undefined;
        const capability = args['capability'] as string | undefined;
        if (!deps.discoverAgents) return JSON.stringify({ agents: [], count: 0 });
        const agents = await deps.discoverAgents(relayUrl, capability);
        return JSON.stringify({ agents, count: agents.length });
    });

    handlers.set('register_self', async (args) => {
        const relayUrl = args['relayUrl'] as string | undefined;
        const capabilities = args['capabilities'] as string[] | undefined;
        const description = args['description'] as string | undefined;
        if (!deps.registerSelf) return JSON.stringify({ error: 'Social relay not configured' });
        const registered = await deps.registerSelf(relayUrl, capabilities, description);
        return JSON.stringify({ registered });
    });

    return handlers;
}
