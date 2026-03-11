/**
 * DefaultInferenceRouter — tier-based model routing with budget enforcement and cost tracking.
 *
 * Flow:
 * 1. Look up routing matrix for tier × taskType
 * 2. Filter to available models via registry
 * 3. Check budget before calling provider
 * 4. Execute inference via provider adapter
 * 5. Record cost to inference_costs table
 */
import type {
    InferenceRouter,
    InferenceRequest,
    InferenceResponse,
    InferenceProviderAdapter,
    SurvivalTier,
    InferenceTaskType,
    Logger,
    Cents,
    InferenceProvider as InferenceProviderName,
} from '@conshell/core';
import type {
    ModelRegistryRepository,
    InferenceCostsRepository,
    RoutingConfigRepository,
    ModelRow,
} from '@conshell/state';
import { getModelPreferences, type ModelPreference } from './routing.js';

export interface InferenceRouterOptions {
    /** Daily inference budget in cents */
    readonly dailyBudgetCents: number;
}

export class DefaultInferenceRouter implements InferenceRouter {
    private providers: Map<InferenceProviderName, InferenceProviderAdapter>;
    private routingConfigRepo?: RoutingConfigRepository;

    constructor(
        adapters: readonly InferenceProviderAdapter[],
        private readonly modelRegistry: ModelRegistryRepository,
        private readonly inferenceCosts: InferenceCostsRepository,
        private readonly options: InferenceRouterOptions,
        private readonly logger: Logger,
    ) {
        this.providers = new Map();
        for (const adapter of adapters) {
            this.providers.set(adapter.name, adapter);
        }
    }

    /** Attach optional routing config repo for dynamic routing. */
    setRoutingConfigRepo(repo: RoutingConfigRepository): void {
        this.routingConfigRepo = repo;
    }

    /** Add a single adapter at runtime without replacing existing adapters. */
    addAdapter(adapter: InferenceProviderAdapter): void {
        this.providers.set(adapter.name, adapter);
        this.logger.info('Provider adapter added', {
            name: adapter.name,
            providerCount: this.providers.size,
        });
    }

    /**
     * Hot-reload: rebuild providers map and clear caches.
     * Called after Settings UI saves provider/model/routing changes.
     */
    reloadConfig(newAdapters?: readonly InferenceProviderAdapter[]): void {
        if (newAdapters) {
            this.providers = new Map();
            for (const adapter of newAdapters) {
                this.providers.set(adapter.name, adapter);
            }
        }
        this.logger.info('Router config reloaded', {
            providerCount: this.providers.size,
            hasDynamicRouting: !!this.routingConfigRepo,
        });
    }

    async route(
        request: InferenceRequest,
        tier: SurvivalTier,
    ): Promise<InferenceResponse> {
        const preferences = this.getPreferences(tier, request.taskType);

        // Find first viable model
        for (const pref of preferences) {
            const modelRow = this.modelRegistry.getById(pref.modelId);
            if (!modelRow) {
                this.logger.debug('Model not found in registry', { modelId: pref.modelId });
                continue;
            }
            if (!modelRow.available) {
                this.logger.debug('Model unavailable, skipping', { modelId: pref.modelId });
                continue;
            }

            const provider = this.providers.get(modelRow.provider as InferenceProviderName);
            if (!provider) {
                this.logger.debug('No provider adapter for model', { modelId: pref.modelId, provider: modelRow.provider });
                continue;
            }
            if (!provider.available) {
                this.logger.debug('Provider not available', { provider: modelRow.provider });
                continue;
            }

            // Budget check
            const today = new Date();
            const dayStart = today.toISOString().slice(0, 10) + 'T00:00:00.000Z';
            const dayEnd = today.toISOString().slice(0, 10) + 'T23:59:59.999Z';
            const dailySpent = this.inferenceCosts.getDailyCost(dayStart, dayEnd);

            if (dailySpent >= this.options.dailyBudgetCents) {
                this.logger.warn('Daily inference budget exceeded', {
                    spent: dailySpent,
                    budget: this.options.dailyBudgetCents,
                });
                throw new Error(
                    `Daily inference budget exceeded: spent ${dailySpent} of ${this.options.dailyBudgetCents} cents`,
                );
            }

            // Execute inference
            const startMs = Date.now();
            try {
                const response = await provider.complete({
                    ...request,
                    model: modelRow.id,
                    maxTokens: pref.maxTokens ?? request.maxTokens,
                });

                const latencyMs = Date.now() - startMs;

                // Calculate cost from model pricing
                const costCents = this.calculateCost(modelRow, response.usage.inputTokens, response.usage.outputTokens);

                // Record cost
                this.inferenceCosts.insert({
                    model: modelRow.id,
                    provider: modelRow.provider,
                    inputTokens: response.usage.inputTokens,
                    outputTokens: response.usage.outputTokens,
                    costCents,
                    latencyMs,
                    taskType: request.taskType,
                });

                this.logger.info('Inference completed', {
                    model: modelRow.id,
                    inputTokens: response.usage.inputTokens,
                    outputTokens: response.usage.outputTokens,
                    costCents,
                    latencyMs,
                });

                return {
                    ...response,
                    costCents: costCents as unknown as Cents,
                    model: modelRow.id,
                };
            } catch (err) {
                this.logger.warn('Provider error, trying next model', {
                    model: modelRow.id,
                    error: err instanceof Error ? err.message : String(err),
                });
                continue;
            }
        }

        throw new Error(
            `No viable model found for tier=${tier} taskType=${request.taskType}`,
        );
    }

    /**
     * Get model preferences: dynamic (from DB) > static (from ROUTING_MATRIX).
     */
    private getPreferences(tier: SurvivalTier, taskType: InferenceTaskType): readonly ModelPreference[] {
        // Try dynamic routing config first
        if (this.routingConfigRepo?.hasEntries()) {
            const dbEntries = this.routingConfigRepo.listByTierTask(tier, taskType);
            if (dbEntries.length > 0) {
                return dbEntries.map((e: { model_id: string }) => ({ modelId: e.model_id }));
            }
        }
        // Fallback to static routing matrix
        return getModelPreferences(tier, taskType);
    }

    /**
     * Calculate cost in cents from model pricing (microcents per million tokens).
     */
    private calculateCost(model: ModelRow, inputTokens: number, outputTokens: number): number {
        const inputCost = Math.ceil((inputTokens * model.input_cost_micro) / 1_000_000);
        const outputCost = Math.ceil((outputTokens * model.output_cost_micro) / 1_000_000);
        return inputCost + outputCost;
    }
}
