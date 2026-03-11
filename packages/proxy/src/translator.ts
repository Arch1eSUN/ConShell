/**
 * OpenAI-compatible API Translator.
 *
 * Converts between OpenAI v1/chat/completions format and ConShell's
 * internal InferenceRequest/InferenceResponse types.
 */
import type {
    InferenceMessage,
    InferenceRequest,
    InferenceResponse,
    InferenceToolDefinition,
    InferenceTaskType,
} from '@conshell/core';

// ── OpenAI-Compatible Request Types ───────────────────────────────────

export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
}

export interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
    };
}

export interface OpenAIChatRequest {
    model: string;
    messages: OpenAIMessage[];
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stream?: boolean;
    tools?: OpenAITool[];
    tool_choice?: string | { type: string; function?: { name: string } };
    stop?: string | string[];
    n?: number;
}

// ── OpenAI-Compatible Response Types ──────────────────────────────────

export interface OpenAIChatResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: OpenAIChatChoice[];
    usage: OpenAIUsage;
}

export interface OpenAIChatChoice {
    index: number;
    message: OpenAIMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface OpenAIUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

// ── Streaming Types ───────────────────────────────────────────────────

export interface OpenAIStreamChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: OpenAIStreamChoice[];
}

export interface OpenAIStreamChoice {
    index: number;
    delta: Partial<OpenAIMessage>;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

// ── Model List Types ──────────────────────────────────────────────────

export interface OpenAIModelObject {
    id: string;
    object: 'model';
    created: number;
    owned_by: string;
}

export interface OpenAIModelList {
    object: 'list';
    data: OpenAIModelObject[];
}

// ── Translator Functions ──────────────────────────────────────────────

let _requestCounter = 0;

function generateId(): string {
    return `chatcmpl-${Date.now().toString(36)}-${(++_requestCounter).toString(36)}`;
}

/**
 * Convert OpenAI chat request → ConShell InferenceRequest.
 */
export function toInferenceRequest(oaiReq: OpenAIChatRequest): InferenceRequest {
    const messages: InferenceMessage[] = oaiReq.messages
        .filter((m): m is OpenAIMessage & { role: 'system' | 'user' | 'assistant' } =>
            m.role !== 'tool')
        .map((m) => ({
            role: m.role,
            content: m.content ?? '',
        }));

    const tools: InferenceToolDefinition[] | undefined = oaiReq.tools?.map((t) => ({
        name: t.function.name,
        description: t.function.description ?? '',
        inputSchema: t.function.parameters ?? {},
    }));

    return {
        messages,
        taskType: inferTaskType(oaiReq.model),
        maxTokens: oaiReq.max_tokens,
        model: oaiReq.model,
        tools: tools && tools.length > 0 ? tools : undefined,
    };
}

/**
 * Convert ConShell InferenceResponse → OpenAI chat completion response.
 */
export function toOpenAIResponse(
    response: InferenceResponse,
    requestModel: string,
): OpenAIChatResponse {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);

    const toolCalls: OpenAIToolCall[] | undefined = response.toolCalls?.map((tc: { id: string; name: string; arguments: string }) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
            name: tc.name,
            arguments: tc.arguments,
        },
    }));

    const hasToolCalls = toolCalls && toolCalls.length > 0;

    return {
        id,
        object: 'chat.completion',
        created: now,
        model: response.model || requestModel,
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: hasToolCalls ? null : response.content,
                    ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
                },
                finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
            },
        ],
        usage: {
            prompt_tokens: response.usage.inputTokens,
            completion_tokens: response.usage.outputTokens,
            total_tokens: response.usage.inputTokens + response.usage.outputTokens,
        },
    };
}

/**
 * Convert ConShell InferenceResponse → SSE stream chunks.
 */
export function* toStreamChunks(
    response: InferenceResponse,
    requestModel: string,
): Generator<string> {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);
    const model = response.model || requestModel;

    // Role chunk
    yield formatSSE({
        id,
        object: 'chat.completion.chunk',
        created: now,
        model,
        choices: [{
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null,
        }],
    });

    // Content chunks (split into ~20 char segments for realistic streaming)
    const content = response.content;
    const chunkSize = 20;
    for (let i = 0; i < content.length; i += chunkSize) {
        yield formatSSE({
            id,
            object: 'chat.completion.chunk',
            created: now,
            model,
            choices: [{
                index: 0,
                delta: { content: content.slice(i, i + chunkSize) },
                finish_reason: null,
            }],
        });
    }

    // Final chunk
    yield formatSSE({
        id,
        object: 'chat.completion.chunk',
        created: now,
        model,
        choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop',
        }],
    });

    yield 'data: [DONE]\n\n';
}

function formatSSE(chunk: OpenAIStreamChunk): string {
    return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Infer task type from model name.
 */
function inferTaskType(model: string): InferenceTaskType {
    const lower = model.toLowerCase();
    if (lower.includes('code') || lower.includes('codex')) return 'coding';
    if (lower.includes('embed') || lower.includes('analysis')) return 'analysis';
    return 'conversation';
}
