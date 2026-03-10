/**
 * Model Discovery Service — auto-detect available models from a provider endpoint.
 *
 * Supports:
 *   - OpenAI-compatible APIs (GET /v1/models) — used by OpenAI, CLIProxyAPI, NVIDIA
 *   - Ollama (GET /api/tags)
 *   - Anthropic — returns known model list (no standard discovery endpoint)
 *   - Gemini — returns known model list
 */
import type { Logger } from '@web4-agent/core';

export interface DiscoveredModel {
    readonly id: string;
    readonly name: string;
    readonly provider: string;
    /** model ID as returned by the provider API */
    readonly externalId: string;
}

export interface DiscoverOptions {
    readonly providerName: string;
    readonly providerType: string;
    readonly endpoint: string;
    readonly apiKey?: string;
    readonly timeoutMs?: number;
}

// No hardcoded model lists — all models are discovered dynamically from provider APIs.

// ── Discovery functions ─────────────────────────────────────────────────

/** Discover models from an OpenAI-compatible endpoint (/v1/models). */
async function discoverOpenAI(
    options: DiscoverOptions,
    logger: Logger,
): Promise<DiscoveredModel[]> {
    // Normalize endpoint: strip trailing /v1, /v1/, and trailing slash, then append /v1/models
    const base = options.endpoint.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    const url = `${base}/v1/models`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (options.apiKey) {
        headers['Authorization'] = `Bearer ${options.apiKey}`;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

        const response = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
            logger.warn('Model discovery failed', {
                provider: options.providerName,
                status: response.status,
                statusText: response.statusText,
            });
            return [];
        }

        const body = await response.json() as { data?: Array<{ id: string; owned_by?: string }> };
        const models = body.data ?? [];

        return models.map(m => ({
            id: `${options.providerName}:${m.id}`,
            name: m.id,
            provider: options.providerName,
            externalId: m.id,
        }));
    } catch (err) {
        logger.warn('Model discovery error', {
            provider: options.providerName,
            error: err instanceof Error ? err.message : String(err),
        });
        return [];
    }
}

/** Discover models from Ollama (GET /api/tags). */
async function discoverOllama(
    options: DiscoverOptions,
    logger: Logger,
): Promise<DiscoveredModel[]> {
    const url = `${options.endpoint.replace(/\/$/, '')}/api/tags`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
            logger.warn('Ollama discovery failed', { status: response.status });
            return [];
        }

        const body = await response.json() as { models?: Array<{ name: string; model?: string }> };
        const models = body.models ?? [];

        return models.map(m => ({
            id: `ollama:${m.name}`,
            name: m.name,
            provider: 'ollama',
            externalId: m.name,
        }));
    } catch (err) {
        logger.warn('Ollama discovery error', {
            error: err instanceof Error ? err.message : String(err),
        });
        return [];
    }
}

// Anthropic and Gemini models are discovered via CLIProxyAPI or other providers.
// No static model lists needed.

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Discover available models from a provider.
 */
export async function discoverModels(
    options: DiscoverOptions,
    logger: Logger,
): Promise<DiscoveredModel[]> {
    const type = options.providerType.toLowerCase();

    switch (type) {
        case 'openai':
        case 'nvidia':
        case 'custom':
            return discoverOpenAI(options, logger);

        case 'cliproxyapi':
            return discoverOpenAI(options, logger);

        case 'ollama':
            return discoverOllama(options, logger);

        default:
            logger.warn('Unknown provider type for discovery', { type });
            return [];
    }
}

/**
 * Test provider connection by attempting model discovery.
 */
export async function testProviderConnection(
    options: DiscoverOptions,
    logger: Logger,
): Promise<{ ok: boolean; modelCount: number; error?: string }> {
    try {
        const models = await discoverModels(options, logger);
        return {
            ok: models.length > 0,
            modelCount: models.length,
        };
    } catch (err) {
        return {
            ok: false,
            modelCount: 0,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
