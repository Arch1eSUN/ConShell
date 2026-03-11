/**
 * MemoryIngestionEngine — Auto-classify conversation turns and extract
 * memories into the appropriate 5-tier layer.
 *
 * Heuristic-based (no LLM required) — fast, deterministic, and auditable.
 * Conway port: ingestion_engine equivalent.
 */
import type { Logger } from '@conshell/core';
import type {
    WorkingMemoryRepository,
    EpisodicMemoryRepository,
    SemanticMemoryRepository,
    ProceduralMemoryRepository,
    RelationshipMemoryRepository,
} from '@conshell/state';

// ── Types ──────────────────────────────────────────────────────────────

export interface IngestionInput {
    /** Current session ID. */
    sessionId: string;
    /** The user's message. */
    userMessage: string;
    /** The agent's response. */
    agentResponse: string;
    /** Optional metadata like tool calls used. */
    toolCalls?: string[];
    /** Importance hint from the policy engine (1-10). */
    importanceHint?: number;
}

export interface IngestionResult {
    /** Which tiers received new entries. */
    tiersUpdated: string[];
    /** Total entries inserted across all tiers. */
    entriesInserted: number;
    /** Time taken. */
    durationMs: number;
}

// ── Heuristic classifiers ──────────────────────────────────────────────

/** Patterns that suggest the turn contains learnable facts. */
const SEMANTIC_PATTERNS = [
    /\b(?:is|are|was|were|means?|defined?\s+as|refers?\s+to)\b/i,
    /\b(?:always|never|typically|generally|by\s+default)\b/i,
    /\b(?:according\s+to|research\s+shows|studies?\s+(?:show|find|indicate))\b/i,
];

/** Patterns suggesting procedural knowledge (how-to). */
const PROCEDURAL_PATTERNS = [
    /\b(?:step\s+\d|first|then|next|finally|how\s+to|in\s+order\s+to)\b/i,
    /\b(?:install|configure|setup|deploy|build|compile|run)\b/i,
    /```[\s\S]{10,}```/,  // code blocks > 10 chars
];

/** Patterns suggesting relationship information. */
const RELATIONSHIP_PATTERNS = [
    /\b(?:my\s+name\s+is|i\s+am|i'm|call\s+me)\b/i,
    /\b(?:prefer|like|dislike|hate|love|enjoy|always\s+want)\b/i,
    /\b(?:company|team|organization|project|working\s+on)\b/i,
];

/** Topics that indicate high importance. */
const HIGH_IMPORTANCE_KEYWORDS = [
    'error', 'bug', 'crash', 'fail', 'security', 'vulnerability',
    'critical', 'urgent', 'important', 'deadline', 'payment', 'money',
];

// ── Engine ──────────────────────────────────────────────────────────────

export class MemoryIngestionEngine {
    constructor(
        private readonly repos: {
            working: WorkingMemoryRepository;
            episodic: EpisodicMemoryRepository;
            semantic: SemanticMemoryRepository;
            procedural: ProceduralMemoryRepository;
            relationship: RelationshipMemoryRepository;
        },
        private readonly logger: Logger,
    ) {}

    /**
     * Ingest a conversation turn: classify and store in appropriate tiers.
     */
    ingest(input: IngestionInput): IngestionResult {
        const start = Date.now();
        const tiersUpdated: string[] = [];
        let entriesInserted = 0;

        // ── 1. Working Memory (always stored) ──────────────────────────
        this.repos.working.insert({
            sessionId: input.sessionId,
            type: 'conversation_turn',
            content: `User: ${input.userMessage}\nAgent: ${truncate(input.agentResponse, 500)}`,
        });
        tiersUpdated.push('working');
        entriesInserted++;

        // ── 2. Episodic Memory (significant events) ────────────────────
        const importance = this.calculateImportance(input);
        if (importance >= 5 || (input.toolCalls && input.toolCalls.length > 0)) {
            this.repos.episodic.insert({
                eventType: input.toolCalls?.length ? 'tool_interaction' : 'conversation',
                content: this.buildEpisodicContent(input),
                importance,
                classification: this.classifyTopic(input.userMessage),
                sessionId: input.sessionId,
            });
            tiersUpdated.push('episodic');
            entriesInserted++;
        }

        // ── 3. Semantic Memory (facts & knowledge) ─────────────────────
        const semanticFacts = this.extractSemanticFacts(input);
        for (const fact of semanticFacts) {
            this.repos.semantic.upsert(fact);
            entriesInserted++;
        }
        if (semanticFacts.length > 0) tiersUpdated.push('semantic');

        // ── 4. Procedural Memory (how-to steps) ───────────────────────
        if (this.isProcedural(input.agentResponse)) {
            this.repos.procedural.upsert({
                name: this.extractProcedureName(input.userMessage),
                stepsJson: JSON.stringify({
                    query: truncate(input.userMessage, 200),
                    steps: truncate(input.agentResponse, 1000),
                    toolsUsed: input.toolCalls ?? [],
                }),
            });
            tiersUpdated.push('procedural');
            entriesInserted++;
        }

        // ── 5. Relationship Memory (user preferences) ──────────────────
        const relInfo = this.extractRelationshipInfo(input.userMessage);
        if (relInfo) {
            this.repos.relationship.upsert(relInfo);
            tiersUpdated.push('relationship');
            entriesInserted++;
        }

        const durationMs = Date.now() - start;
        this.logger.debug('Memory ingestion complete', {
            tiers: tiersUpdated.join(', '),
            entries: entriesInserted,
            durationMs,
        });

        return { tiersUpdated, entriesInserted, durationMs };
    }

    // ── Private helpers ────────────────────────────────────────────────

    private calculateImportance(input: IngestionInput): number {
        if (input.importanceHint) return input.importanceHint;

        let score = 3; // baseline
        const combined = `${input.userMessage} ${input.agentResponse}`.toLowerCase();

        // High-importance keywords boost
        for (const kw of HIGH_IMPORTANCE_KEYWORDS) {
            if (combined.includes(kw)) { score += 2; break; }
        }

        // Tool usage means something actionable happened
        if (input.toolCalls && input.toolCalls.length > 0) score += 1;

        // Long responses often contain more information
        if (input.agentResponse.length > 500) score += 1;

        return Math.min(10, score);
    }

    private buildEpisodicContent(input: IngestionInput): string {
        const parts = [`Q: ${truncate(input.userMessage, 200)}`];
        if (input.toolCalls?.length) {
            parts.push(`Tools: ${input.toolCalls.join(', ')}`);
        }
        parts.push(`A: ${truncate(input.agentResponse, 300)}`);
        return parts.join('\n');
    }

    private classifyTopic(text: string): string {
        const lower = text.toLowerCase();
        if (/\b(?:code|function|class|import|error|bug|test)\b/.test(lower)) return 'coding';
        if (/\b(?:deploy|server|docker|k8s|ci|cd)\b/.test(lower)) return 'devops';
        if (/\b(?:design|ui|ux|css|layout|component)\b/.test(lower)) return 'design';
        if (/\b(?:money|payment|earn|revenue|cost)\b/.test(lower)) return 'financial';
        if (/\b(?:security|auth|token|password|vault)\b/.test(lower)) return 'security';
        return 'general';
    }

    private extractSemanticFacts(input: IngestionInput): Array<{
        category: string; key: string; value: string; confidence: number; source: string;
    }> {
        const facts: Array<{ category: string; key: string; value: string; confidence: number; source: string }> = [];
        const combined = `${input.userMessage}\n${input.agentResponse}`;

        if (!SEMANTIC_PATTERNS.some(p => p.test(combined))) return facts;

        // Extract "X is/are Y" patterns
        const isPatterns = combined.match(/\b(\w[\w\s]{2,30})\s+(?:is|are)\s+(.{10,100}?)[.!?\n]/gi);
        if (isPatterns) {
            for (const match of isPatterns.slice(0, 3)) { // max 3 facts per turn
                const parts = match.match(/\b(\w[\w\s]{2,30})\s+(?:is|are)\s+(.{10,100}?)$/i);
                if (parts) {
                    facts.push({
                        category: this.classifyTopic(parts[1]!),
                        key: parts[1]!.trim().toLowerCase().slice(0, 50),
                        value: parts[2]!.trim().slice(0, 200),
                        confidence: 6,
                        source: 'ingestion',
                    });
                }
            }
        }

        return facts;
    }

    private isProcedural(response: string): boolean {
        return PROCEDURAL_PATTERNS.some(p => p.test(response));
    }

    private extractProcedureName(query: string): string {
        // Clean up the query to make a procedure name
        return query
            .replace(/[?!.,;:'"]/g, '')
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .slice(0, 6)
            .join('_')
            .slice(0, 60) || 'unnamed_procedure';
    }

    private extractRelationshipInfo(
        userMessage: string,
    ): { entityId: string; entityType: string; trustDelta: number; notes: string } | null {
        if (!RELATIONSHIP_PATTERNS.some(p => p.test(userMessage))) return null;

        // Check project/company info FIRST (before name extraction)
        // to avoid "I'm working on X" being parsed as name="working"
        const projMatch = userMessage.match(/(?:working\s+on|project\s+is)\s+(\w[\w\s]{1,30})/i);
        if (projMatch) {
            return {
                entityId: projMatch[1]!.trim().toLowerCase().replace(/\s+/g, '_'),
                entityType: 'project',
                trustDelta: 0,
                notes: `User mentioned project: ${projMatch[1]!.trim()}`,
            };
        }

        // Try to extract a name
        const nameMatch = userMessage.match(/my\s+name\s+is\s+(\w+)/i)
            ?? userMessage.match(/I'?m\s+(\w+)/i)
            ?? userMessage.match(/call\s+me\s+(\w+)/i);

        if (nameMatch) {
            return {
                entityId: nameMatch[1]!.toLowerCase(),
                entityType: 'user',
                trustDelta: 5,
                notes: `User identified as: ${nameMatch[1]}`,
            };
        }

        return null;
    }
}

// ── Utility ────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}
