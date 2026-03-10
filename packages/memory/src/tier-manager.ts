/**
 * MemoryTierManager — 5-tier retrieval + ingestion.
 *
 * Retrieval is budget-allocated, priority-ordered:
 *   working > episodic > semantic > procedural > relationship
 *
 * Ingestion classifies turns and extracts memories into appropriate tiers.
 */
import type { Logger } from '@web4-agent/core';
import type {
    WorkingMemoryRepository,
    EpisodicMemoryRepository,
    SemanticMemoryRepository,
    ProceduralMemoryRepository,
    RelationshipMemoryRepository,
} from '@web4-agent/state';

// ── Types ──────────────────────────────────────────────────────────────

export type MemoryTier = 'working' | 'episodic' | 'semantic' | 'procedural' | 'relationship';

export interface MemoryBlock {
    tier: MemoryTier;
    entries: readonly MemoryEntry[];
    tokenEstimate: number;
}

export interface MemoryEntry {
    id: number;
    tier: MemoryTier;
    label: string;
    content: string;
}

export interface RetrievalBudget {
    /** Maximum total tokens across all tiers */
    totalTokens: number;
    /** Per-tier allocation (fraction of total, must sum to ≤ 1.0) */
    tierWeights?: Partial<Record<MemoryTier, number>>;
}

export interface TierStats {
    tier: MemoryTier;
    count: number;
}

// ── Default tier weights ───────────────────────────────────────────────

const DEFAULT_WEIGHTS: Record<MemoryTier, number> = {
    working: 0.35,
    episodic: 0.25,
    semantic: 0.20,
    procedural: 0.12,
    relationship: 0.08,
};

/** Rough token estimate: 1 token ≈ 4 chars. */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// ── MemoryTierManager ──────────────────────────────────────────────────

export class MemoryTierManager {
    constructor(
        private readonly repos: {
            working: WorkingMemoryRepository;
            episodic: EpisodicMemoryRepository;
            semantic: SemanticMemoryRepository;
            procedural: ProceduralMemoryRepository;
            relationship: RelationshipMemoryRepository;
        },
        private readonly logger: Logger,
    ) { }

    /**
     * Retrieve context-ready memory blocks, budget-constrained and priority-ordered.
     */
    retrieve(sessionId: string, budget: RetrievalBudget): readonly MemoryBlock[] {
        const weights = { ...DEFAULT_WEIGHTS, ...budget.tierWeights };
        const tiers: MemoryTier[] = ['working', 'episodic', 'semantic', 'procedural', 'relationship'];
        const blocks: MemoryBlock[] = [];

        for (const tier of tiers) {
            const tierBudget = Math.floor(budget.totalTokens * weights[tier]);
            const entries = this.fetchTier(tier, sessionId, tierBudget);
            const tokenEstimate = entries.reduce((sum, e) => sum + estimateTokens(e.content), 0);

            if (entries.length > 0) {
                blocks.push({ tier, entries, tokenEstimate });
            }
        }

        this.logger.debug('Memory retrieval complete', {
            tiers: blocks.map(b => `${b.tier}:${b.entries.length}`).join(', '),
        });

        return blocks;
    }

    /**
     * Get tier statistics.
     */
    stats(sessionId: string): readonly TierStats[] {
        return [
            { tier: 'working', count: this.repos.working.findBySession(sessionId).length },
            { tier: 'episodic', count: this.repos.episodic.findTopByImportance(999_999).length },
            { tier: 'semantic', count: this.repos.semantic.findAll().length },
            { tier: 'procedural', count: this.repos.procedural.findAll().length },
            { tier: 'relationship', count: this.repos.relationship.findAll().length },
        ];
    }

    /**
     * Format blocks into a text context block suitable for system prompt injection.
     */
    formatContextBlock(blocks: readonly MemoryBlock[]): string {
        if (blocks.length === 0) return '';

        const sections: string[] = ['<memory>'];
        for (const block of blocks) {
            sections.push(`## ${block.tier.toUpperCase()} MEMORY (${block.entries.length} entries, ~${block.tokenEstimate} tokens)`);
            for (const entry of block.entries) {
                sections.push(`- [${entry.label}] ${entry.content}`);
            }
        }
        sections.push('</memory>');
        return sections.join('\n');
    }

    // ── Private helpers ────────────────────────────────────────────────

    private fetchTier(tier: MemoryTier, sessionId: string, tokenBudget: number): MemoryEntry[] {
        switch (tier) {
            case 'working':
                return this.truncateToTokenBudget(
                    this.repos.working.findBySession(sessionId).map(r => ({
                        id: r.id, tier: 'working' as const, label: r.type, content: r.content,
                    })),
                    tokenBudget,
                );
            case 'episodic':
                return this.truncateToTokenBudget(
                    this.repos.episodic.findTopByImportance(50).map(r => ({
                        id: r.id, tier: 'episodic' as const, label: `${r.event_type} (importance:${r.importance})`, content: r.content,
                    })),
                    tokenBudget,
                );
            case 'semantic':
                return this.truncateToTokenBudget(
                    this.repos.semantic.findAll().map(r => ({
                        id: r.id, tier: 'semantic' as const, label: `${r.category}/${r.key}`, content: r.value,
                    })),
                    tokenBudget,
                );
            case 'procedural':
                return this.truncateToTokenBudget(
                    this.repos.procedural.findAll().map(r => ({
                        id: r.id, tier: 'procedural' as const, label: r.name, content: r.steps_json,
                    })),
                    tokenBudget,
                );
            case 'relationship':
                return this.truncateToTokenBudget(
                    this.repos.relationship.findAll().map(r => ({
                        id: r.id, tier: 'relationship' as const, label: r.entity_id,
                        content: `trust:${r.trust_score} interactions:${r.interaction_count}${r.notes ? ' notes:' + r.notes : ''}`,
                    })),
                    tokenBudget,
                );
        }
    }

    private truncateToTokenBudget(entries: MemoryEntry[], tokenBudget: number): MemoryEntry[] {
        const result: MemoryEntry[] = [];
        let tokens = 0;
        for (const entry of entries) {
            const entryTokens = estimateTokens(entry.content);
            if (tokens + entryTokens > tokenBudget) break;
            result.push(entry);
            tokens += entryTokens;
        }
        return result;
    }
}
