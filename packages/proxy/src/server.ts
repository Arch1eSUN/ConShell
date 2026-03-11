/**
 * Proxy Server — OpenAI v1/chat/completions compatible endpoint handler.
 *
 * This module provides request handler functions that can be mounted on
 * an Express app. It translates OpenAI-format requests through the
 * ConShell inference router and returns OpenAI-format responses.
 *
 * Supports:
 * - POST /v1/chat/completions (stream + non-stream)
 * - GET  /v1/models
 * - GET  /v1/models/:id
 * - GET  /api/accounts/status
 * - POST /api/accounts/add
 */
import type { Logger, InferenceRouter, SurvivalTier } from '@conshell/core';
import { ModelMapper } from './model-mapping.js';
import { AccountPool, parseCLIProxyKey, type ProxyAccount } from './account-pool.js';
import {
    toInferenceRequest,
    toOpenAIResponse,
    toStreamChunks,
    type OpenAIChatRequest,
    type OpenAIModelList,
    type OpenAIModelObject,
} from './translator.js';

// ── Config ────────────────────────────────────────────────────────────

export interface ProxyConfig {
    /** Inference router to delegate to */
    readonly router: InferenceRouter;
    /** Logger */
    readonly logger: Logger;
    /** Current survival tier (for routing) */
    readonly getTier: () => SurvivalTier;
    /** Custom model aliases */
    readonly modelAliases?: Record<string, string>;
    /** Pre-configured accounts */
    readonly accounts?: ProxyAccount[];
}

// ── Proxy Handler ─────────────────────────────────────────────────────

export class ProxyHandler {
    private readonly mapper: ModelMapper;
    private readonly pool: AccountPool;
    private readonly router: InferenceRouter;
    private readonly logger: Logger;
    private readonly getTier: () => SurvivalTier;

    constructor(config: ProxyConfig) {
        this.router = config.router;
        this.logger = config.logger;
        this.getTier = config.getTier;
        this.mapper = new ModelMapper(config.modelAliases);
        this.pool = new AccountPool(config.logger);

        // Load pre-configured accounts
        if (config.accounts) {
            for (const account of config.accounts) {
                this.pool.addAccount(account);
            }
        }
    }

    /**
     * Handle POST /v1/chat/completions
     */
    async handleChatCompletion(
        body: OpenAIChatRequest,
        writeStream?: (chunk: string) => void,
        endStream?: () => void,
    ): Promise<{
        status: number;
        body?: Record<string, unknown>;
        isStream: boolean;
    }> {
        const requestModel = body.model;
        const resolvedModel = this.mapper.resolve(requestModel);
        const isStream = body.stream === true;

        this.logger.info('Proxy: chat completion request', {
            requestModel,
            resolvedModel,
            stream: isStream,
            messageCount: body.messages.length,
        });

        try {
            // Translate to internal format
            const internalReq = toInferenceRequest({
                ...body,
                model: resolvedModel,
            });

            // Route through inference
            const tier = this.getTier();
            const response = await this.router.route(internalReq, tier);

            if (isStream && writeStream && endStream) {
                // Streaming response
                for (const chunk of toStreamChunks(response, requestModel)) {
                    writeStream(chunk);
                }
                endStream();
                return { status: 200, isStream: true };
            } else {
                // Non-streaming response
                const oaiResponse = toOpenAIResponse(response, requestModel);
                return {
                    status: 200,
                    body: oaiResponse as unknown as Record<string, unknown>,
                    isStream: false,
                };
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error('Proxy: chat completion failed', { error: message });
            return {
                status: 500,
                body: {
                    error: {
                        message,
                        type: 'server_error',
                        param: null,
                        code: 'internal_error',
                    },
                },
                isStream: false,
            };
        }
    }

    /**
     * Handle GET /v1/models
     */
    handleListModels(): OpenAIModelList {
        const models = this.mapper.listExternalModels();
        const now = Math.floor(Date.now() / 1000);

        return {
            object: 'list',
            data: models.map((id): OpenAIModelObject => ({
                id,
                object: 'model',
                created: now,
                owned_by: this.getOwner(id),
            })),
        };
    }

    /**
     * Handle GET /v1/models/:id
     */
    handleGetModel(modelId: string): OpenAIModelObject | null {
        const resolved = this.mapper.resolve(modelId);
        if (resolved === modelId && !modelId.includes(':')) {
            return null; // not found
        }
        return {
            id: modelId,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: this.getOwner(modelId),
        };
    }

    /**
     * Add a new account to the pool.
     */
    addAccount(account: ProxyAccount): void {
        this.pool.addAccount(account);
    }

    /**
     * Add account via CLIProxy-style API key.
     */
    addAccountFromKey(apiKey: string, options?: {
        label?: string;
        baseUrl?: string;
        rpmLimit?: number;
    }): ProxyAccount {
        const parsed = parseCLIProxyKey(apiKey);
        const account: ProxyAccount = {
            id: `${parsed.provider}-${Date.now().toString(36)}`,
            provider: parsed.provider,
            apiKey: parsed.isCLIProxy ? parsed.apiKey : apiKey,
            label: options?.label,
            baseUrl: options?.baseUrl,
            rpmLimit: options?.rpmLimit,
        };
        this.pool.addAccount(account);
        return account;
    }

    /**
     * Get pool status.
     */
    getPoolStatus(): Record<string, unknown> {
        return this.pool.getStatus();
    }

    /**
     * Add a model alias at runtime.
     */
    addModelAlias(externalName: string, internalId: string): void {
        this.mapper.addAlias(externalName, internalId);
    }

    private getOwner(modelId: string): string {
        const lower = modelId.toLowerCase();
        if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3')) return 'openai';
        if (lower.includes('claude')) return 'anthropic';
        if (lower.includes('gemini')) return 'google';
        if (lower.includes('llama') || lower.includes('mixtral') || lower.includes('mistral')) return 'meta';
        if (lower.includes('glm')) return 'zhipu';
        if (lower.includes('qwen')) return 'alibaba';
        if (lower.includes('deepseek')) return 'deepseek';
        return 'conshell';
    }
}
