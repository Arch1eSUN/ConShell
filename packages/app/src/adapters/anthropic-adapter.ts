/**
 * AnthropicAdapter — InferenceProviderAdapter for Anthropic Claude models.
 *
 * Calls Anthropic's /v1/messages endpoint.
 * Model IDs follow the pattern "anthropic:<model>" (e.g., "anthropic:claude-sonnet-4-20250514").
 * Auth via ANTHROPIC_API_KEY environment variable.
 */
import type {
    InferenceProviderAdapter,
    InferenceRequest,
    InferenceResponse,
    InferenceProvider as InferenceProviderName,
    InferenceAuthType,
} from '@conshell/core';
import { Cents } from '@conshell/core';

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface AnthropicContentBlock {
    type: 'text';
    text: string;
}

interface AnthropicResponse {
    id: string;
    content: AnthropicContentBlock[];
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
    model: string;
    stop_reason: string;
}

export class AnthropicAdapter implements InferenceProviderAdapter {
    readonly name: InferenceProviderName = 'anthropic';
    readonly authType: InferenceAuthType = 'apiKey';
    readonly available: boolean;

    constructor(
        private readonly apiKey: string,
        private readonly endpoint: string = 'https://api.anthropic.com',
    ) {
        this.available = !!apiKey;
    }

    async complete(request: InferenceRequest): Promise<InferenceResponse> {
        const model = request.model ?? 'claude-sonnet-4-20250514';
        const anthropicModel = model.includes(':') ? model.split(':')[1] : model;

        // Anthropic requires separate system message and user/assistant messages
        let systemPrompt: string | undefined;
        const messages: AnthropicMessage[] = [];

        for (const m of request.messages) {
            if (m.role === 'system') {
                systemPrompt = m.content;
            } else {
                messages.push({ role: m.role as 'user' | 'assistant', content: m.content });
            }
        }

        const body: Record<string, unknown> = {
            model: anthropicModel,
            max_tokens: request.maxTokens ?? 4096,
            messages,
        };
        if (systemPrompt) {
            body.system = systemPrompt;
        }

        const response = await fetch(`${this.endpoint}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Anthropic error ${response.status}: ${text}`);
        }

        const data = (await response.json()) as AnthropicResponse;
        const textContent = data.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');

        return {
            content: textContent,
            usage: {
                inputTokens: data.usage.input_tokens,
                outputTokens: data.usage.output_tokens,
            },
            costCents: 0 as unknown as Cents,
            model: anthropicModel,
        };
    }
}
