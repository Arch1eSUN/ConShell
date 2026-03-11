/**
 * GeminiAdapter — InferenceProviderAdapter for Google Gemini models.
 *
 * Calls Google's Generative Language API:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * Auth via GEMINI_API_KEY (query param).
 */
import type {
    InferenceProviderAdapter,
    InferenceRequest,
    InferenceResponse,
    InferenceProvider as InferenceProviderName,
    InferenceAuthType,
} from '@conshell/core';
import { Cents } from '@conshell/core';

interface GeminiPart {
    text: string;
}

interface GeminiContent {
    role: 'user' | 'model';
    parts: GeminiPart[];
}

interface GeminiCandidate {
    content: { parts: GeminiPart[]; role: string };
    finishReason: string;
}

interface GeminiUsageMetadata {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
}

interface GeminiResponse {
    candidates: GeminiCandidate[];
    usageMetadata?: GeminiUsageMetadata;
}

export class GeminiAdapter implements InferenceProviderAdapter {
    readonly name: InferenceProviderName = 'gemini';
    readonly authType: InferenceAuthType = 'apiKey';
    readonly available: boolean;

    constructor(
        private readonly apiKey: string,
        private readonly endpoint: string = 'https://generativelanguage.googleapis.com/v1beta',
    ) {
        this.available = !!apiKey;
    }

    async complete(request: InferenceRequest): Promise<InferenceResponse> {
        const model = request.model ?? 'gemini-pro';
        const geminiModel = model.includes(':') ? model.split(':')[1] : model;

        // Convert messages to Gemini format
        // Gemini uses 'user' and 'model' roles; system messages become prefixed user messages
        const contents: GeminiContent[] = [];
        let systemInstruction: string | undefined;

        for (const m of request.messages) {
            if (m.role === 'system') {
                systemInstruction = m.content;
            } else {
                contents.push({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }],
                });
            }
        }

        const body: Record<string, unknown> = {
            contents,
            generationConfig: {
                maxOutputTokens: request.maxTokens ?? 4096,
            },
        };
        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        const url = `${this.endpoint}/models/${geminiModel}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Gemini error ${response.status}: ${text}`);
        }

        const data = (await response.json()) as GeminiResponse;
        const candidate = data.candidates?.[0];
        const textContent = candidate?.content?.parts
            ?.map((p) => p.text)
            .join('') ?? '';

        return {
            content: textContent,
            usage: {
                inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
                outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
            },
            costCents: 0 as unknown as Cents,
            model: geminiModel,
        };
    }
}
