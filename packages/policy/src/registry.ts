/**
 * ToolRegistry — Central registry for all tool definitions.
 *
 * Provides tool metadata lookup for the policy engine and
 * tool listing for the MCP exposure layer.
 */
import type { ToolDefinition, ToolMetadata, Logger } from '@conshell/core';

export class ToolRegistry {
    private readonly tools = new Map<string, ToolDefinition>();

    constructor(private readonly logger: Logger) { }

    /**
     * Register a tool definition. Throws if name is already registered.
     */
    register(tool: ToolDefinition): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" is already registered`);
        }
        this.tools.set(tool.name, tool);
        this.logger.debug('Tool registered', { name: tool.name, category: tool.category, risk: tool.riskLevel });
    }

    /**
     * Register multiple tools at once.
     */
    registerAll(tools: readonly ToolDefinition[]): void {
        for (const tool of tools) {
            this.register(tool);
        }
    }

    /**
     * Lookup tool metadata by name (used by PolicyEngine).
     */
    getMetadata(name: string): ToolMetadata | undefined {
        const tool = this.tools.get(name);
        if (!tool) return undefined;
        return {
            name: tool.name,
            category: tool.category,
            riskLevel: tool.riskLevel,
            requiredAuthority: tool.requiredAuthority,
            mcpExposed: tool.mcpExposed,
            auditFields: tool.auditFields,
            requiredCapabilities: tool.requiredCapabilities,
        };
    }

    /**
     * Get full tool definition (includes inputSchema).
     */
    getDefinition(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    /**
     * List all registered tools.
     */
    list(): readonly ToolDefinition[] {
        return [...this.tools.values()];
    }

    /**
     * List tools by category.
     */
    listByCategory(category: string): readonly ToolDefinition[] {
        return [...this.tools.values()].filter((t) => t.category === category);
    }

    /**
     * List tools exposed via MCP (safe by default, plus opt-in caution).
     */
    listMcpExposed(): readonly ToolDefinition[] {
        return [...this.tools.values()].filter((t) => t.mcpExposed);
    }

    /**
     * Total count of registered tools.
     */
    get size(): number {
        return this.tools.size;
    }
}
