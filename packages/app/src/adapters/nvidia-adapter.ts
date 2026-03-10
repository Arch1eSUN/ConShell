/**
 * NvidiaAdapter — InferenceProviderAdapter for NVIDIA NIM models.
 *
 * NVIDIA NIM provides an OpenAI-compatible chat completions API:
 *   POST https://integrate.api.nvidia.com/v1/chat/completions
 * Auth via NVIDIA_API_KEY (Bearer token).
 */
import type {
    InferenceProviderAdapter,
    InferenceRequest,
    InferenceResponse,
    InferenceProvider as InferenceProviderName,
    InferenceAuthType,
} from '@web4-agent/core';
import { Cents } from '@web4-agent/core';

interface NvidiaChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface NvidiaChatChoice {
    message: { role: string; content: string | null };
    finish_reason: string;
}

interface NvidiaChatResponse {
    id: string;
    choices: NvidiaChatChoice[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export class NvidiaAdapter implements InferenceProviderAdapter {
    readonly name: InferenceProviderName = 'nvidia';
    readonly authType: InferenceAuthType = 'apiKey';
    readonly available: boolean;

    constructor(
        private readonly apiKey: string,
        private readonly endpoint: string = 'https://integrate.api.nvidia.com/v1',
    ) {
        this.available = !!apiKey;
    }

    async complete(request: InferenceRequest): Promise<InferenceResponse> {
        const model = request.model ?? 'nvidia/llama-3.1-nemotron-70b-instruct';
        // Strip "nvidia:" prefix if present, but NVIDIA models use full paths like "nvidia/llama-..."
        const nvidiaModel = model.startsWith('nvidia:') ? model.slice(7) : model;

        const messages: NvidiaChatMessage[] = request.messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));

        const body = {
            model: nvidiaModel,
            messages,
            max_tokens: request.maxTokens ?? 4096,
            stream: false,
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
            throw new Error(`NVIDIA NIM error ${response.status}: ${text}`);
        }

        const data = (await response.json()) as NvidiaChatResponse;
        const choice = data.choices[0];

        return {
            content: choice?.message?.content ?? '',
            usage: {
                inputTokens: data.usage?.prompt_tokens ?? 0,
                outputTokens: data.usage?.completion_tokens ?? 0,
            },
            costCents: 0 as unknown as Cents,
            model: nvidiaModel,
        };
    }
}
