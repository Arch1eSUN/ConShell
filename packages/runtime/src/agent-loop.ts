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
    SurvivalTier,
    InferenceTaskType,
} from '@web4-agent/core';
import type { TurnsRepository, InsertTurn } from '@web4-agent/state';

export interface AgentLoopDeps {
    readonly inferenceRouter: InferenceRouter;
    readonly turnsRepo: TurnsRepository;
    readonly logger: Logger;
    /** Get current survival tier */
    readonly getTier: () => SurvivalTier;
}

export interface AgentMessage {
    readonly role: 'user' | 'system';
    readonly content: string;
    readonly sessionId: string;
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

const SYSTEM_PROMPT_STUB = 'You are a sovereign AI agent.';

export class AgentLoop {
    private readonly deps: AgentLoopDeps;

    constructor(deps: AgentLoopDeps) {
        this.deps = deps;
    }

    /**
     * Execute one full agent turn (think → optionally act → persist).
     *
     * v1: No tool execution in this layer — returns the inference response.
     * Tool execution will be wired in with the tool executor subsystem.
     */
    async executeTurn(message: AgentMessage): Promise<AgentTurnResult> {
        const { inferenceRouter, turnsRepo, logger, getTier } = this.deps;
        const tier = getTier();

        logger.info('Agent loop: starting turn', {
            sessionId: message.sessionId,
            tier,
        });

        // Build inference request
        const request: InferenceRequest = {
            messages: [
                { role: 'system', content: SYSTEM_PROMPT_STUB },
                { role: message.role, content: message.content },
            ],
            taskType: 'reasoning' as InferenceTaskType,
        };

        // Think: call inference
        const response = await inferenceRouter.route(request, tier);

        // Persist turn
        const turn: InsertTurn = {
            sessionId: message.sessionId,
            thinking: response.thinking,
            toolCallsJson: response.toolCalls ? JSON.stringify(response.toolCalls) : undefined,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            costCents: response.costCents,
            model: response.model,
        };
        turnsRepo.insert(turn);

        logger.info('Agent loop: turn complete', {
            model: response.model,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
        });

        return {
            response: response.content,
            toolCalls: [], // v1: tool execution deferred to tool-executor subsystem
            usage: response.usage,
            model: response.model,
            costCents: response.costCents as unknown as number,
        };
    }
}
