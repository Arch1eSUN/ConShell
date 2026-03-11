/**
 * CliProxyApiAdapter — InferenceProviderAdapter for CLIProxyAPI gateway.
 *
 * Routes inference requests through a locally-running CLIProxyAPI instance
 * which proxies to subscription/OAuth-based model providers (Claude, Gemini,
 * Codex, etc.) at zero marginal token cost.
 *
 * Uses OpenAI-compatible /v1/chat/completions endpoint format.
 * Model IDs follow the pattern "cliproxyapi:<model>" where <model> is sent
 * directly to CLIProxyAPI (e.g., "cliproxyapi:claude-sonnet-4" → "claude-sonnet-4").
 */
import type {
    InferenceProviderAdapter,
    InferenceRequest,
    InferenceResponse,
    InferenceProvider as InferenceProviderName,
    InferenceAuthType,
} from '@conshell/core';
import { Cents } from '@conshell/core';

interface OpenAIChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OpenAIChatChoice {
    message: { role: string; content: string };
    finish_reason?: string;
}

interface OpenAIChatResponse {
    choices: OpenAIChatChoice[];
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    model?: string;
}

export class CliProxyApiAdapter implements InferenceProviderAdapter {
    readonly name: InferenceProviderName = 'cliproxyapi';
    readonly authType: InferenceAuthType = 'proxy';
    readonly available: boolean = true;
    private readonly baseUrl: string;

    constructor(
        endpoint: string = 'http://localhost:8317',
        private readonly apiKey: string = '',
        private readonly timeoutMs: number = 120_000,
    ) {
        // Normalize endpoint: strip trailing /v1, /v1/, and trailing slash
        this.baseUrl = endpoint.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    }

    async complete(request: InferenceRequest): Promise<InferenceResponse> {
        const model = request.model ?? 'claude-sonnet-4';
        // Strip provider prefix if present (e.g., "cliproxyapi:claude-sonnet-4" → "claude-sonnet-4")
        const proxyModel = model.includes(':') ? model.split(':')[1] : model;

        const messages: OpenAIChatMessage[] = request.messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));

        const body: Record<string, unknown> = {
            model: proxyModel,
            messages,
            max_tokens: request.maxTokens ?? 4096,
            stream: false,
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`CLIProxyAPI error ${response.status}: ${text}`);
            }

            const data = (await response.json()) as OpenAIChatResponse;

            const choice = data.choices?.[0];
            if (!choice) {
                throw new Error('CLIProxyAPI returned no choices');
            }

            return {
                content: choice.message.content,
                usage: {
                    inputTokens: data.usage?.prompt_tokens ?? 0,
                    outputTokens: data.usage?.completion_tokens ?? 0,
                },
                costCents: 0 as unknown as Cents, // Subscription-billed, zero marginal cost
                model: proxyModel,
            };
        } finally {
            clearTimeout(timeout);
        }
    }
}
