/**
 * OllamaAdapter — InferenceProviderAdapter for local Ollama models.
 *
 * Calls Ollama's /api/chat endpoint with the model name extracted from the modelId.
 * Model IDs follow the pattern "ollama:<tag>" (e.g., "ollama:llama3.2").
 * The adapter strips the "ollama:" prefix → sends "llama3.2" to Ollama.
 */
import type {
    InferenceProviderAdapter,
    InferenceRequest,
    InferenceResponse,
    InferenceProvider as InferenceProviderName,
    InferenceAuthType,
} from '@web4-agent/core';
import { Cents } from '@web4-agent/core';

interface OllamaChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OllamaChatResponse {
    message: { role: string; content: string };
    total_duration?: number;
    eval_count?: number;
    prompt_eval_count?: number;
}

export class OllamaAdapter implements InferenceProviderAdapter {
    readonly name: InferenceProviderName = 'ollama';
    readonly authType: InferenceAuthType = 'local';
    readonly available: boolean = true;

    constructor(
        private readonly endpoint: string = 'http://localhost:11434',
    ) { }

    async complete(request: InferenceRequest): Promise<InferenceResponse> {
        const model = request.model ?? 'llama3.2';
        // Strip provider prefix if present (e.g. "ollama:llama3.2" → "llama3.2")
        const ollamaModel = model.includes(':') ? model.split(':')[1] : model;

        const messages: OllamaChatMessage[] = request.messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));

        const body = {
            model: ollamaModel,
            messages,
            stream: false,
            options: {
                num_predict: request.maxTokens ?? 2048,
            },
        };

        const response = await fetch(`${this.endpoint}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Ollama error ${response.status}: ${text}`);
        }

        const data = (await response.json()) as OllamaChatResponse;

        return {
            content: data.message.content,
            usage: {
                inputTokens: data.prompt_eval_count ?? 0,
                outputTokens: data.eval_count ?? 0,
            },
            costCents: 0 as unknown as Cents,
            model: ollamaModel,
        };
    }
}
