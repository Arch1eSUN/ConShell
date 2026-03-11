/**
 * OpenClawAdapter — InferenceProviderAdapter for OpenClaw digital lives.
 *
 * OpenClaw provides OAuth-authenticated access to existing AI agents (digital lives)
 * such as Codex and Antigravity. The adapter routes inference requests through
 * OpenClaw's API, which delegates to the appropriate sub-provider.
 *
 * Model IDs follow the pattern "openclaw:<sub-provider>" (e.g., "openclaw:codex").
 * Auth via OPENCLAW_OAUTH_TOKEN (OAuth Bearer token).
 */
import type {
    InferenceProviderAdapter,
    InferenceRequest,
    InferenceResponse,
    InferenceProvider as InferenceProviderName,
    InferenceAuthType,
    OpenClawSubProvider,
} from '@conshell/core';
import { Cents } from '@conshell/core';

interface OpenClawChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OpenClawChatResponse {
    id: string;
    subProvider: OpenClawSubProvider;
    content: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

export class OpenClawAdapter implements InferenceProviderAdapter {
    readonly name: InferenceProviderName = 'openclaw';
    readonly authType: InferenceAuthType = 'oauth';
    readonly available: boolean;

    constructor(
        private readonly oauthToken: string,
        private readonly endpoint: string = 'https://api.openclaw.com',
    ) {
        this.available = !!oauthToken;
    }

    async complete(request: InferenceRequest): Promise<InferenceResponse> {
        const model = request.model ?? 'openclaw:codex';
        // Extract sub-provider: "openclaw:codex" → "codex"
        const subProvider = model.includes(':') ? model.split(':')[1] : model;

        const messages: OpenClawChatMessage[] = request.messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));

        const body = {
            subProvider,
            messages,
            maxTokens: request.maxTokens ?? 4096,
        };

        const response = await fetch(`${this.endpoint}/v1/inference`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.oauthToken}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`OpenClaw error ${response.status}: ${text}`);
        }

        const data = (await response.json()) as OpenClawChatResponse;

        return {
            content: data.content,
            usage: {
                inputTokens: data.usage?.inputTokens ?? 0,
                outputTokens: data.usage?.outputTokens ?? 0,
            },
            costCents: 0 as unknown as Cents,
            model: `openclaw:${subProvider}`,
        };
    }
}
