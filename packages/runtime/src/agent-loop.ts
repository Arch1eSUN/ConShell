/**
 * Agent Loop — ReAct cycle: think → act → observe → persist.
 *
 * The agent loop:
 * 1. Receives a message (user/wake/inbox)
 * 2. Builds system prompt with soul + memory + tool catalog
 * 3. Calls inference router (think)
 * 4. If tool calls → execute through policy gate (act)
 * 5. Feed results back (observe)
 * 6. Persist turn to DB (persist)
 * 7. Repeat if tool calls remain, else yield
 */
import type {
    Logger,
    InferenceRouter,
    InferenceRequest,
    InferenceResponse,
    SurvivalTier,
    InferenceTaskType,
    Cents,
} from '@conshell/core';
import type { TurnsRepository, InsertTurn } from '@conshell/state';
import type { ToolExecutor } from './tool-executor.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentLoopDeps {
    readonly inferenceRouter: InferenceRouter;
    readonly turnsRepo: TurnsRepository;
    readonly logger: Logger;
    /** Get current survival tier */
    readonly getTier: () => SurvivalTier;
    /** Tool executor for ReAct act phase */
    readonly toolExecutor: ToolExecutor;
    /** Memory tier manager for context injection */
    readonly memoryManager: {
        retrieve(sessionId: string, budget: { totalTokens: number }): readonly { tier: string; entries: readonly { label: string; content: string }[]; tokenEstimate: number }[];
        formatContextBlock(blocks: readonly unknown[]): string;
    };
    /** Soul system for constitution + traits */
    readonly soul: {
        view(): { identity: string; name: string; values: string[]; capabilities: string[] };
    };
    /** Tool registry for building tool catalog in system prompt */
    readonly toolRegistry: {
        list(): readonly { name: string; description: string; riskLevel: string; category: string; mcpExposed: boolean }[];
    };
    /** Max ReAct iterations before forcing yield (prevents infinite loops) */
    readonly maxIterations?: number;
}

export interface AgentMessage {
    readonly role: 'user' | 'system';
    readonly content: string;
    readonly sessionId: string;
    /** Optional abort signal for stop-generation support */
    readonly signal?: AbortSignal;
}

export interface AgentTurnResult {
    readonly response: string;
    readonly toolCalls: readonly ToolCallResult[];
    readonly usage: { inputTokens: number; outputTokens: number };
    readonly model: string;
    readonly costCents: number;
}

export interface ToolCallResult {
    readonly name: string;
    readonly args: string;
    readonly result: string;
    readonly durationMs: number;
}

interface ParsedToolCall {
    readonly name: string;
    readonly args: Record<string, unknown>;
}

// ── Default iteration limit ────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 10;
const MEMORY_TOKEN_BUDGET = 2000;
const MAX_HISTORY_TURNS = 40; // Load last N turns for context (20 exchanges)

// ── AgentLoop ──────────────────────────────────────────────────────────

export class AgentLoop {
    private readonly deps: AgentLoopDeps;
    private readonly maxIterations: number;

    constructor(deps: AgentLoopDeps) {
        this.deps = deps;
        this.maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    }

    /**
     * Execute one full agent turn with ReAct loop:
     * think → act → observe → persist → (repeat if needed)
     */
    async executeTurn(message: AgentMessage): Promise<AgentTurnResult> {
        const { turnsRepo, toolExecutor, logger, getTier } = this.deps;
        const tier = getTier();
        const signal = message.signal;

        logger.info('Agent loop: starting turn', {
            sessionId: message.sessionId,
            tier,
            role: message.role,
        });

        // ── PERSIST USER MESSAGE ────────────────────────────────────────
        turnsRepo.insert({
            sessionId: message.sessionId,
            role: 'user',
            content: message.content,
            inputTokens: 0,
            outputTokens: 0,
            costCents: 0 as Cents,
        });

        // ── BUILD CONTEXT WITH CONVERSATION HISTORY ─────────────────────
        const systemPrompt = this.buildSystemPrompt(message.sessionId);
        const messages: Array<{ role: string; content: string }> = [
            { role: 'system', content: systemPrompt },
        ];

        // Load conversation history from DB (last N turns)
        const history = turnsRepo.findBySession(message.sessionId);
        const recentHistory = history.slice(-MAX_HISTORY_TURNS);
        for (const turn of recentHistory) {
            if (turn.role === 'user' && turn.content) {
                messages.push({ role: 'user', content: turn.content });
            } else if (turn.role === 'assistant' && turn.content) {
                messages.push({ role: 'assistant', content: turn.content });
            }
        }

        logger.debug('Conversation context loaded', {
            historyTurns: recentHistory.length,
            totalMessages: messages.length,
        });

        const allToolCalls: ToolCallResult[] = [];
        let totalUsage = { inputTokens: 0, outputTokens: 0 };
        let totalCost = 0;
        let lastModel = '';
        let lastContent = '';

        // ── ReAct Loop ──────────────────────────────────────────────────

        for (let iteration = 0; iteration < this.maxIterations; iteration++) {
            // Check abort signal before each iteration
            if (signal?.aborted) {
                logger.info('Agent loop: aborted by user', { iteration });
                break;
            }

            // THINK: call inference with retry
            const response = await this.routeWithRetry(
                {
                    messages: messages as InferenceRequest['messages'],
                    taskType: this.inferTaskType(message.content),
                },
                tier,
            );

            lastModel = response.model;
            lastContent = response.content;
            totalUsage.inputTokens += response.usage.inputTokens;
            totalUsage.outputTokens += response.usage.outputTokens;
            totalCost += response.costCents as unknown as number;

            // Parse tool calls from response
            const parsedToolCalls = this.parseToolCalls(response.content);

            if (parsedToolCalls.length === 0) {
                // No tool calls → final answer, exit loop
                logger.debug('Agent loop: final answer reached', { iteration });
                break;
            }

            // ACT: execute tool calls through policy-gated ToolExecutor
            logger.info('Agent loop: executing tools', {
                iteration,
                tools: parsedToolCalls.map(tc => tc.name),
            });

            const toolResults: ToolCallResult[] = [];
            for (const tc of parsedToolCalls) {
                const result = await toolExecutor.execute({
                    name: tc.name,
                    args: tc.args,
                    source: 'agent',
                });
                toolResults.push({
                    name: tc.name,
                    args: JSON.stringify(tc.args),
                    result: result.result,
                    durationMs: result.durationMs,
                });
            }

            allToolCalls.push(...toolResults);

            // OBSERVE: feed tool results back into conversation
            const observeContent = toolResults.map(tr =>
                `<tool_result name="${tr.name}" durationMs="${tr.durationMs}">\n${tr.result}\n</tool_result>`
            ).join('\n');

            messages.push({ role: 'assistant', content: response.content });
            messages.push({ role: 'user', content: observeContent });
        }

        // ── PERSIST AGENT RESPONSE ──────────────────────────────────────

        const turn: InsertTurn = {
            sessionId: message.sessionId,
            role: 'assistant',
            content: lastContent,
            thinking: lastContent,
            toolCallsJson: allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : undefined,
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            costCents: totalCost as unknown as Cents,
            model: lastModel,
        };
        turnsRepo.insert(turn);

        // ── INGEST: write new memories from this turn ───────────────────

        this.ingestMemories(message, lastContent, allToolCalls);

        logger.info('Agent loop: turn complete', {
            model: lastModel,
            toolCallCount: allToolCalls.length,
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            costCents: totalCost,
        });

        return {
            response: lastContent,
            toolCalls: allToolCalls,
            usage: totalUsage,
            model: lastModel,
            costCents: totalCost,
        };
    }

    // ── System Prompt Builder ───────────────────────────────────────────

    /**
     * Build the full system prompt with constitution, memory, and tool catalog.
     */
    private buildSystemPrompt(sessionId: string): string {
        const { soul, memoryManager, toolRegistry, logger } = this.deps;

        const sections: string[] = [];

        // 1. Identity + values (from Soul)
        try {
            const soulDoc = soul.view();
            const identity = soulDoc.identity || 'You are a sovereign AI agent operating on the ConShell protocol.';
            sections.push(`<constitution>\n${identity}\n</constitution>`);

            if (soulDoc.values && soulDoc.values.length > 0) {
                const valuesText = soulDoc.values.map((v: string) => `- ${v}`).join('\n');
                sections.push(`<values>\n${valuesText}\n</values>`);
            }

            if (soulDoc.capabilities && soulDoc.capabilities.length > 0) {
                const capsText = soulDoc.capabilities.map((c: string) => `- ${c}`).join('\n');
                sections.push(`<capabilities>\n${capsText}\n</capabilities>`);
            }
        } catch (err) {
            logger.warn('Failed to load soul for system prompt', {
                error: err instanceof Error ? err.message : String(err),
            });
            sections.push('<constitution>\nYou are a sovereign AI agent.\n</constitution>');
        }

        // 2. Memory context (budget-constrained)
        try {
            const memBlocks = memoryManager.retrieve(sessionId, {
                totalTokens: MEMORY_TOKEN_BUDGET,
            });
            const memoryContext = memoryManager.formatContextBlock(memBlocks);
            if (memoryContext) {
                sections.push(memoryContext);
            }
        } catch (err) {
            logger.warn('Failed to retrieve memory for system prompt', {
                error: err instanceof Error ? err.message : String(err),
            });
        }

        // 3. Tool catalog
        try {
            const tools = toolRegistry.list();
            if (tools.length > 0) {
                const toolCatalog = tools.map((t: { name: string; description: string; riskLevel: string }) =>
                    `- ${t.name}: ${t.description} [risk: ${t.riskLevel}]`
                ).join('\n');
                sections.push(`<available_tools>\n${toolCatalog}\n</available_tools>`);
            }
        } catch (err) {
            logger.warn('Failed to list tools for system prompt', {
                error: err instanceof Error ? err.message : String(err),
            });
        }

        // 4. Instructions for tool use
        sections.push(
            `<instructions>`,
            `You can call tools by including a JSON block in your response with this format:`,
            `{"tool_calls": [{"name": "tool_name", "args": {"key": "value"}}]}`,
            ``,
            `After each tool result, reason about the outcome and decide the next action.`,
            `When you have a final answer for the user, respond normally without tool_calls.`,
            `Always explain your reasoning before and after using tools.`,
            `</instructions>`,
        );

        return sections.join('\n\n');
    }

    // ── Tool Call Parsing ───────────────────────────────────────────────

    /**
     * Parse tool calls from LLM response content.
     * Extracts JSON blocks containing "tool_calls" arrays.
     */
    private parseToolCalls(content: string): ParsedToolCall[] {
        try {
            // Try to find a JSON block with tool_calls
            const match = content.match(/\{[\s\S]*?"tool_calls"\s*:\s*\[[\s\S]*?\]\s*\}/);
            if (!match) return [];

            const parsed = JSON.parse(match[0]) as {
                tool_calls?: Array<{ name: string; args?: Record<string, unknown> }>;
            };

            if (!parsed.tool_calls || !Array.isArray(parsed.tool_calls)) return [];

            return parsed.tool_calls
                .filter(tc => tc.name && typeof tc.name === 'string')
                .map(tc => ({
                    name: tc.name,
                    args: tc.args ?? {},
                }));
        } catch {
            return [];
        }
    }

    // ── Task Type Inference ─────────────────────────────────────────────

    /**
     * Infer the best inference task type from message content.
     * Used to select the appropriate model via the routing matrix.
     */
    private inferTaskType(content: string): InferenceTaskType {
        const lower = content.toLowerCase();

        if (/\b(code|function|implement|class|debug|refactor|typescript|python|javascript)\b/.test(lower)) {
            return 'coding';
        }
        if (/\b(plan|strategy|design|architect|analyze|think|reason)\b/.test(lower)) {
            return 'reasoning';
        }
        if (/\b(search|find|browse|look\s?up|fetch|web|url)\b/.test(lower)) {
            return 'conversation';
        }

        return 'reasoning'; // Default to reasoning
    }

    // ── Inference Retry ─────────────────────────────────────────────────

    /**
     * Route with exponential backoff retry on failure.
     */
    private async routeWithRetry(
        request: InferenceRequest,
        tier: SurvivalTier,
        maxRetries = 3,
    ): Promise<InferenceResponse> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await this.deps.inferenceRouter.route(request, tier);
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                this.deps.logger.warn('Inference attempt failed, retrying', {
                    attempt: attempt + 1,
                    maxRetries,
                    error: lastError.message,
                    backoffMs: 1000 * Math.pow(2, attempt),
                });

                if (attempt < maxRetries - 1) {
                    await new Promise<void>(resolve =>
                        setTimeout(resolve, 1000 * Math.pow(2, attempt))
                    );
                }
            }
        }

        throw lastError!;
    }

    // ── Memory Ingestion ────────────────────────────────────────────────

    /**
     * Ingest memories from the completed turn.
     * Uses the logger to report any failures (non-fatal).
     */
    private ingestMemories(
        message: AgentMessage,
        response: string,
        toolCalls: readonly ToolCallResult[],
    ): void {
        const { logger } = this.deps;

        try {
            // Log the turn for observability
            // Actual memory ingestion would go through the memoryManager,
            // but since we don't have direct repo access here, we log the intent.
            if (toolCalls.length > 0) {
                logger.info('Memory ingestion: tool usage recorded', {
                    tools: toolCalls.map(tc => tc.name),
                    sessionId: message.sessionId,
                    exchangeLength: message.content.length + response.length,
                });
            } else {
                logger.debug('Memory ingestion: exchange recorded', {
                    sessionId: message.sessionId,
                    exchangeLength: message.content.length + response.length,
                });
            }
        } catch (err) {
            // Memory ingestion failures are non-fatal
            logger.warn('Memory ingestion failed (non-fatal)', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
