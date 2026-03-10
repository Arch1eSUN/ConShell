/**
 * ToolExecutor — Executes tool calls through the policy engine.
 *
 * Responsibilities:
 * 1. Look up tool handler by name
 * 2. Pass through PolicyEngine for approval
 * 3. Execute handler with args
 * 4. Truncate result to MAX_TOOL_RESULT_SIZE
 * 5. Return structured result
 */
import type { Logger, ToolCallRequest, ToolCallResult as CoreToolCallResult, AgentState, SurvivalTier } from '@web4-agent/core';
import type { PolicyEngine } from '@web4-agent/policy';
import type { ToolHandler } from './tools/web-tools.js';

export const MAX_TOOL_RESULT_SIZE = 32_768; // 32KB

export interface ToolExecutorDeps {
    readonly policyEngine: PolicyEngine;
    readonly logger: Logger;
    readonly getAgentState: () => AgentState;
    readonly getSurvivalTier: () => SurvivalTier;
}

export class ToolExecutor {
    private readonly handlers = new Map<string, ToolHandler>();
    private readonly deps: ToolExecutorDeps;

    constructor(deps: ToolExecutorDeps) {
        this.deps = deps;
    }

    /**
     * Register a tool handler function.
     */
    registerHandler(name: string, handler: ToolHandler): void {
        this.handlers.set(name, handler);
    }

    /**
     * Register multiple handlers from a Map.
     */
    registerHandlers(handlers: ReadonlyMap<string, ToolHandler>): void {
        for (const [name, handler] of handlers) {
            this.handlers.set(name, handler);
        }
    }

    /**
     * Execute a tool call:
     * 1. Check policy
     * 2. Find handler
     * 3. Execute
     * 4. Truncate result
     */
    async execute(request: ToolCallRequest): Promise<CoreToolCallResult> {
        const { policyEngine, logger } = this.deps;
        const startMs = Date.now();

        // 1. Policy check
        const decision = policyEngine.evaluate({
            toolName: request.name,
            toolArgs: request.args,
            source: request.source === 'mcp' ? 'external' : 'self',
            agentState: this.deps.getAgentState(),
            survivalTier: this.deps.getSurvivalTier(),
        });

        if (!decision.allowed) {
            logger.warn('Tool call denied by policy', {
                tool: request.name,
                rule: decision.rule,
                reason: decision.reason,
            });
            return {
                name: request.name,
                result: JSON.stringify({
                    error: 'denied',
                    rule: decision.rule,
                    reason: decision.reason,
                }),
                durationMs: Date.now() - startMs,
                truncated: false,
            };
        }

        // 2. Find handler
        const handler = this.handlers.get(request.name);
        if (!handler) {
            logger.error('No handler registered for tool', { tool: request.name });
            return {
                name: request.name,
                result: JSON.stringify({ error: `No handler for tool: ${request.name}` }),
                durationMs: Date.now() - startMs,
                truncated: false,
            };
        }

        // 3. Execute
        try {
            logger.debug('Executing tool', { tool: request.name });
            let result = await handler(request.args);

            // 4. Truncate
            const truncated = result.length > MAX_TOOL_RESULT_SIZE;
            if (truncated) {
                result = result.slice(0, MAX_TOOL_RESULT_SIZE) + '\n... [truncated]';
            }

            const durationMs = Date.now() - startMs;
            logger.debug('Tool executed', {
                tool: request.name,
                durationMs,
                resultLength: result.length,
                truncated,
            });

            return {
                name: request.name,
                result,
                durationMs,
                truncated,
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Tool execution error', { tool: request.name, error: msg });
            return {
                name: request.name,
                result: JSON.stringify({ error: msg }),
                durationMs: Date.now() - startMs,
                truncated: false,
            };
        }
    }

    /**
     * Check if a handler is registered for a given tool name.
     */
    hasHandler(name: string): boolean {
        return this.handlers.has(name);
    }

    /**
     * Get the count of registered handlers.
     */
    get handlerCount(): number {
        return this.handlers.size;
    }
}
