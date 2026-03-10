/**
 * MCP Gateway — JSON-RPC 2.0 server exposing agent tools and resources.
 *
 * Supports:
 * - tools/list: Lists MCP-exposed tools from the registry
 * - tools/call: Executes a tool through the policy engine
 * - resources/list: Lists available resource URIs
 * - resources/read: Reads a resource by URI
 */
import type { Logger, ToolDefinition } from '@web4-agent/core';
import type { ToolRegistry } from '@web4-agent/policy';

// ── JSON-RPC Types ──────────────────────────────────────────────────────

export interface JsonRpcRequest {
    readonly jsonrpc: '2.0';
    readonly id: string | number;
    readonly method: string;
    readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
    readonly jsonrpc: '2.0';
    readonly id: string | number;
    readonly result?: unknown;
    readonly error?: JsonRpcError;
}

export interface JsonRpcError {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
}

// ── MCP-specific types ──────────────────────────────────────────────────

export interface McpToolDefinition {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
}

export interface McpResource {
    readonly uri: string;
    readonly name: string;
    readonly description: string;
    readonly mimeType: string;
}

export interface McpGatewayDeps {
    readonly toolRegistry: ToolRegistry;
    readonly logger: Logger;
    readonly readResource?: (uri: string) => Promise<string>;
}

// ── Error codes ─────────────────────────────────────────────────────────

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/**
 * MCP Gateway — processes JSON-RPC requests for MCP protocol compliance.
 */
export class McpGateway {
    private readonly deps: McpGatewayDeps;
    private readonly resources: Map<string, McpResource> = new Map();

    constructor(deps: McpGatewayDeps) {
        this.deps = deps;
        this.registerDefaultResources();
    }

    private registerDefaultResources(): void {
        this.resources.set('agent://status', {
            uri: 'agent://status',
            name: 'Agent Status',
            description: 'Current agent state and health',
            mimeType: 'application/json',
        });
        this.resources.set('agent://tools', {
            uri: 'agent://tools',
            name: 'Tool Catalog',
            description: 'List of all available tools',
            mimeType: 'application/json',
        });
    }

    addResource(resource: McpResource): void {
        this.resources.set(resource.uri, resource);
    }

    async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        const { logger } = this.deps;

        if (request.jsonrpc !== '2.0') {
            return this.error(request.id, INVALID_REQUEST, 'Invalid JSON-RPC version');
        }

        logger.debug('MCP request', { method: request.method, id: request.id });

        switch (request.method) {
            case 'initialize':
                return this.handleInitialize(request);
            case 'tools/list':
                return this.handleToolsList(request);
            case 'tools/call':
                return this.handleToolsCall(request);
            case 'resources/list':
                return this.handleResourcesList(request);
            case 'resources/read':
                return this.handleResourcesRead(request);
            default:
                return this.error(request.id, METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
        }
    }

    private handleInitialize(request: JsonRpcRequest): JsonRpcResponse {
        return this.success(request.id, {
            protocolVersion: '2025-06-18',
            capabilities: {
                tools: { listChanged: false },
                resources: { subscribe: false, listChanged: false },
            },
            serverInfo: {
                name: 'web4-agent',
                version: '0.1.0',
            },
        });
    }

    private handleToolsList(request: JsonRpcRequest): JsonRpcResponse {
        const tools = this.deps.toolRegistry.listMcpExposed();
        const mcpTools: McpToolDefinition[] = tools.map((t: ToolDefinition) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        }));

        return this.success(request.id, { tools: mcpTools });
    }

    private async handleToolsCall(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        const params = request.params ?? {};
        const toolName = params['name'] as string;
        const toolArgs = (params['arguments'] ?? {}) as Record<string, unknown>;

        if (!toolName) {
            return this.error(request.id, INVALID_REQUEST, 'Missing tool name');
        }

        const tool = this.deps.toolRegistry.getDefinition(toolName);
        if (!tool) {
            return this.error(request.id, METHOD_NOT_FOUND, `Tool not found: ${toolName}`);
        }

        // v1: Return a stub response. Actual execution will be wired via tool executor.
        this.deps.logger.info('MCP tools/call', { tool: toolName });

        return this.success(request.id, {
            content: [
                {
                    type: 'text',
                    text: `Tool ${toolName} called with args: ${JSON.stringify(toolArgs)}`,
                },
            ],
        });
    }

    private handleResourcesList(request: JsonRpcRequest): JsonRpcResponse {
        const resources = Array.from(this.resources.values());
        return this.success(request.id, { resources });
    }

    private async handleResourcesRead(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        const uri = (request.params ?? {})['uri'] as string;
        if (!uri) {
            return this.error(request.id, INVALID_REQUEST, 'Missing resource URI');
        }

        const resource = this.resources.get(uri);
        if (!resource) {
            return this.error(request.id, METHOD_NOT_FOUND, `Resource not found: ${uri}`);
        }

        let content = '{}';
        if (this.deps.readResource) {
            try {
                content = await this.deps.readResource(uri);
            } catch {
                return this.error(request.id, INTERNAL_ERROR, `Failed to read resource: ${uri}`);
            }
        }

        return this.success(request.id, {
            contents: [
                {
                    uri,
                    mimeType: resource.mimeType,
                    text: content,
                },
            ],
        });
    }

    private success(id: string | number, result: unknown): JsonRpcResponse {
        return { jsonrpc: '2.0', id, result };
    }

    private error(id: string | number, code: number, message: string): JsonRpcResponse {
        return { jsonrpc: '2.0', id, error: { code, message } };
    }
}
