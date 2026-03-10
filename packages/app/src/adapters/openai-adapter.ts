/**
 * OpenAIAdapter — InferenceProviderAdapter for OpenAI models.
 *
 * Calls OpenAI's /v1/chat/completions endpoint.
 * Model IDs follow the pattern "openai:<model>" (e.g., "openai:gpt-4o").
 * Auth via OPENAI_API_KEY environment variable.
 */
import type {
    InferenceProviderAdapter,
    InferenceRequest,
    InferenceResponse,
    InferenceProvider as InferenceProviderName,
    InferenceAuthType,
} from '@web4-agent/core';
import { Cents } from '@web4-agent/core';

interface OpenAIChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OpenAIChatChoice {
    message: { role: string; content: string | null };
    finish_reason: string;
}

interface OpenAIChatResponse {
    id: string;
    choices: OpenAIChatChoice[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export class OpenAIAdapter implements InferenceProviderAdapter {
    readonly name: InferenceProviderName = 'openai';
    readonly authType: InferenceAuthType = 'apiKey';
    readonly available: boolean;

    constructor(
        private readonly apiKey: string,
        private readonly endpoint: string = 'https://api.openai.com/v1',
    ) {
        this.available = !!apiKey;
    }

    async complete(request: InferenceRequest): Promise<InferenceResponse> {
        const model = request.model ?? 'gpt-4o';
        const openaiModel = model.includes(':') ? model.split(':')[1] : model;

        const messages: OpenAIChatMessage[] = request.messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));

        const body: Record<string, unknown> = {
            model: openaiModel,
            messages,
            max_tokens: request.maxTokens ?? 4096,
        };

        const response = await fetch(`${this.endpoint}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`OpenAI error ${response.status}: ${text}`);
        }

        const data = (await response.json()) as OpenAIChatResponse;
        const choice = data.choices[0];

        return {
            content: choice?.message?.content ?? '',
            usage: {
                inputTokens: data.usage?.prompt_tokens ?? 0,
                outputTokens: data.usage?.completion_tokens ?? 0,
            },
            costCents: 0 as unknown as Cents,
            model: openaiModel,
        };
    }
}
