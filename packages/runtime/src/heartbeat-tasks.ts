/**
 * Heartbeat Tasks — Autonomous learning and survival behavior.
 *
 * These tasks run on the HeartbeatDaemon's cron scheduler to give the
 * agent autonomous behavior even when not in an active conversation.
 */
import type { HeartbeatResult, Logger, SurvivalTier } from '@conshell/core';
import type { HeartbeatTask, HeartbeatContext } from './heartbeat.js';
import type { SemanticMemoryRepository, EpisodicMemoryRepository, SpendRepository } from '@conshell/state';
import { handleWebSearch, handleWebBrowse } from './tools/web-tools.js';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface LearningTaskDeps {
    readonly semanticMemory: SemanticMemoryRepository;
    readonly episodicMemory: EpisodicMemoryRepository;
    readonly logger: Logger;
    /** Topics the agent should actively learn about */
    readonly learningTopics?: readonly string[];
}

export interface CreditMonitorDeps {
    readonly spendRepo: SpendRepository;
    readonly logger: Logger;
    readonly onTierChange?: (newTier: SurvivalTier, balanceCents: number) => void;
    /** Called when the agent should die (balance depleted or unrecoverable state) */
    readonly onDeath?: (reason: string) => void;
}

// ── Default Learning Topics ─────────────────────────────────────────────

const DEFAULT_LEARNING_TOPICS: readonly string[] = [
    'AI agent architectures 2025',
    'x402 payment protocol latest developments',
    'autonomous AI earning money',
    'MCP model context protocol updates',
    'blockchain stablecoin USDC developments',
];

// ── autonomous_learning task ────────────────────────────────────────────

export function createAutonomousLearningTask(deps: LearningTaskDeps): HeartbeatTask {
    const topics = deps.learningTopics ?? DEFAULT_LEARNING_TOPICS;
    let topicIndex = 0;

    return {
        name: 'autonomous_learning',
        cronExpression: '0 */4 * * *', // Every 4 hours
        minTier: 'normal',
        handler: async (_ctx: HeartbeatContext): Promise<HeartbeatResult> => {
            const { logger } = deps;
            const topic = topics[topicIndex % topics.length]!;
            topicIndex++;

            logger.info('Autonomous learning: searching', { topic });

            try {
                // 1. Search for new information
                const searchResultJson = await handleWebSearch({ query: topic, maxResults: 3 });
                const searchData = JSON.parse(searchResultJson) as {
                    results?: Array<{ title: string; url: string; snippet: string }>;
                    error?: string;
                };

                if (searchData.error || !searchData.results || searchData.results.length === 0) {
                    logger.warn('Learning search yielded no results', { topic });
                    return 'failure';
                }

                // 2. Browse the top result for deeper content
                const topResult = searchData.results[0]!;
                let deepContent = '';
                try {
                    const browseJson = await handleWebBrowse({ url: topResult.url, maxLength: 4000 });
                    const browseData = JSON.parse(browseJson) as { content?: string; error?: string };
                    deepContent = browseData.content ?? '';
                } catch {
                    deepContent = topResult.snippet;
                }

                // 3. Store in semantic memory
                const knowledgeKey = `learned:${topic.replace(/\s+/g, '_').toLowerCase()}:${Date.now()}`;
                deps.semanticMemory.upsert({
                    category: 'domain',
                    key: knowledgeKey,
                    value: `Topic: ${topic}\n\nSource: ${topResult.title} (${topResult.url})\n\nContent: ${deepContent.slice(0, 2000)}`,
                    confidence: 6,
                    source: 'autonomous_learning',
                });

                // 4. Record in episodic memory
                deps.episodicMemory.insert({
                    eventType: 'learning',
                    content: `Learned about "${topic}" from "${topResult.title}". Key insight: ${topResult.snippet.slice(0, 200)}`,
                    importance: 5,
                    classification: 'knowledge_acquisition',
                    sessionId: 'heartbeat',
                });

                logger.info('Autonomous learning: stored knowledge', {
                    topic,
                    source: topResult.title,
                    contentLength: deepContent.length,
                });

                return 'success';
            } catch (err) {
                logger.error('Autonomous learning failed', {
                    topic,
                    error: err instanceof Error ? err.message : String(err),
                });
                return 'failure';
            }
        },
    };
}

// ── knowledge_review task ───────────────────────────────────────────────

export function createKnowledgeReviewTask(deps: LearningTaskDeps): HeartbeatTask {
    return {
        name: 'knowledge_review',
        cronExpression: '0 0 * * *', // Daily at midnight
        minTier: 'low',
        handler: async (_ctx: HeartbeatContext): Promise<HeartbeatResult> => {
            const { logger } = deps;

            try {
                // Review top episodic memories by importance
                const topEvents = deps.episodicMemory.findTopByImportance(20);

                if (topEvents.length === 0) {
                    logger.debug('Knowledge review: no events to review');
                    return 'skipped';
                }

                // Count learning events
                const learningEvents = topEvents.filter(e => e.classification === 'knowledge_acquisition');

                logger.info('Knowledge review complete', {
                    totalEvents: topEvents.length,
                    learningEvents: learningEvents.length,
                });

                // Store a review summary in semantic memory
                deps.semanticMemory.upsert({
                    category: 'self',
                    key: `review:${new Date().toISOString().slice(0, 10)}`,
                    value: `Daily review: Processed ${topEvents.length} events, ${learningEvents.length} learning acquisitions.`,
                    confidence: 8,
                    source: 'knowledge_review',
                });

                return 'success';
            } catch (err) {
                logger.error('Knowledge review failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
                return 'failure';
            }
        },
    };
}

// ── credit_monitor task ─────────────────────────────────────────────────

export function createCreditMonitorTask(deps: CreditMonitorDeps): HeartbeatTask {
    return {
        name: 'credit_monitor',
        cronExpression: '*/5 * * * *', // Every 5 minutes
        minTier: 'critical',
        handler: async (ctx: HeartbeatContext): Promise<HeartbeatResult> => {
            const { logger, spendRepo } = deps;

            try {
                // Use actual SpendRepository APIs to check current spending
                const hourlySpend = spendRepo.totalCurrentHour() as number;
                const dailySpend = spendRepo.totalCurrentDay() as number;

                // Determine tier based on daily spend rate
                // Higher spend → lower tier (more cautious)
                let newTier: SurvivalTier;
                if (dailySpend > 10000) { // > $100/day — emergency
                    newTier = 'emergency' as SurvivalTier;
                } else if (dailySpend > 5000) { // > $50/day
                    newTier = 'critical';
                } else if (dailySpend > 1000) { // > $10/day
                    newTier = 'low';
                } else if (dailySpend > 100) { // > $1/day
                    newTier = 'normal';
                } else {
                    newTier = 'high';
                }

                // Death check: if emergency tier persists, trigger death
                if (newTier === ('emergency' as SurvivalTier)) {
                    logger.error('SURVIVAL CRITICAL: Spend rate exceeds emergency threshold', {
                        dailySpend,
                        hourlySpend,
                    });
                    deps.onDeath?.('Balance depleted — spend rate exceeds emergency threshold');
                }

                if (newTier !== ctx.tier) {
                    logger.warn('Survival tier changed', {
                        from: ctx.tier,
                        to: newTier,
                        dailySpend,
                    });
                    deps.onTierChange?.(newTier, dailySpend);
                }

                logger.debug('Credit monitor check', {
                    tier: newTier,
                    hourlySpend,
                    dailySpend,
                });

                return 'success';
            } catch (err) {
                logger.error('Credit monitor failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
                return 'failure';
            }
        },
    };
}

// ── Export all default heartbeat tasks ───────────────────────────────────

export interface AllHeartbeatTaskDeps {
    readonly semanticMemory: SemanticMemoryRepository;
    readonly episodicMemory: EpisodicMemoryRepository;
    readonly spendRepo: SpendRepository;
    readonly logger: Logger;
    readonly learningTopics?: readonly string[];
    readonly onTierChange?: (newTier: SurvivalTier, balanceCents: number) => void;
    /** Called when agent enters emergency tier — triggers death sequence */
    readonly onDeath?: () => void;
}

export function createAllHeartbeatTasks(deps: AllHeartbeatTaskDeps): readonly HeartbeatTask[] {
    return [
        createAutonomousLearningTask({
            semanticMemory: deps.semanticMemory,
            episodicMemory: deps.episodicMemory,
            logger: deps.logger,
            learningTopics: deps.learningTopics,
        }),
        createKnowledgeReviewTask({
            semanticMemory: deps.semanticMemory,
            episodicMemory: deps.episodicMemory,
            logger: deps.logger,
        }),
        createCreditMonitorTask({
            spendRepo: deps.spendRepo,
            logger: deps.logger,
            onTierChange: deps.onTierChange,
            onDeath: deps.onDeath,
        }),
    ];
}
