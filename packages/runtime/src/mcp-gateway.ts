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
    /** Optional tool executor for real tool execution (replaces v1 stub) */
    readonly toolExecutor?: import('./tool-executor.js').ToolExecutor;
    /** Tool price map: tool name → price in USDC cents. Tools without prices are free. */
    readonly toolPrices?: ReadonlyMap<string, number>;
}

// ── Error codes ─────────────────────────────────────────────────────────

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;
const PAYMENT_REQUIRED = -32402; // x402 payment required

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

        // x402 Payment Gating: Check if this tool has a price configured
        const toolPrices = this.deps.toolPrices;
        if (toolPrices) {
            const priceCents = toolPrices.get(toolName);
            if (priceCents !== undefined && priceCents > 0) {
                // Check for payment signature in params (x402 header simulation)
                const paymentSignature = params['x402-payment-signature'] as string | undefined;
                if (!paymentSignature) {
                    this.deps.logger.info('x402 payment required', { tool: toolName, priceCents });
                    return this.error(request.id, PAYMENT_REQUIRED, JSON.stringify({
                        type: 'x402-payment-required',
                        tool: toolName,
                        priceCents,
                        currency: 'USDC',
                        message: `This tool requires payment of $${(priceCents / 100).toFixed(2)} USDC`,
                    }));
                }
                // In production, verify the payment signature here via the x402 facilitator.
                // For now, log it and proceed.
                this.deps.logger.info('x402 payment received', { tool: toolName, priceCents });
            }
        }

        // Real tool execution via ToolExecutor (replaces v1 stub)
        if (this.deps.toolExecutor?.hasHandler(toolName)) {
            try {
                const result = await this.deps.toolExecutor.execute({
                    name: toolName,
                    args: toolArgs,
                    source: 'mcp',
                });

                return this.success(request.id, {
                    content: [
                        {
                            type: 'text',
                            text: result.result,
                        },
                    ],
                    _meta: {
                        durationMs: result.durationMs,
                        truncated: result.truncated,
                    },
                });
            } catch (err) {
                this.deps.logger.error('Tool execution failed', { tool: toolName, error: String(err) });
                return this.error(request.id, INTERNAL_ERROR, `Tool execution failed: ${toolName}`);
            }
        }

        // Fallback stub for tools without handlers
        this.deps.logger.info('MCP tools/call (stub)', { tool: toolName });
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
