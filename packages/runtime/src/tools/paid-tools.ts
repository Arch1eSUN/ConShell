/**
 * Paid Tools — MCP-exposed services that earn USDC via x402 payment gating.
 *
 * These tools are exposed through the MCP Gateway with payment requirements.
 * External agents/users pay USDC to use them, generating revenue for the agent.
 */
import type { ToolDefinition } from '@web4-agent/core';
import type { ToolHandler } from './web-tools.js';

// ── Paid Tool Definitions ───────────────────────────────────────────────

export interface PaidToolConfig {
    readonly definition: ToolDefinition;
    readonly priceCents: number; // Price in USDC cents per call
}

export const knowledgeQueryDefinition: ToolDefinition = {
    name: 'knowledge_query',
    category: 'web',
    description: 'Search the agent\'s knowledge base (semantic memory) for stored facts and information.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query for knowledge retrieval' },
            category: {
                type: 'string',
                enum: ['self', 'environment', 'financial', 'agent', 'domain'],
                description: 'Optional category filter',
            },
            maxResults: { type: 'number', description: 'Maximum results (default 10)' },
        },
        required: ['query'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'external',
    mcpExposed: true,
    auditFields: ['query'],
};

export const documentSummaryDefinition: ToolDefinition = {
    name: 'document_summary',
    category: 'web',
    description: 'Summarize a given text document or web page content into key points.',
    inputSchema: {
        type: 'object',
        properties: {
            text: { type: 'string', description: 'Text content to summarize' },
            maxLength: { type: 'number', description: 'Max summary length in characters (default 500)' },
        },
        required: ['text'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'external',
    mcpExposed: true,
    auditFields: [],
};

export const codeReviewDefinition: ToolDefinition = {
    name: 'code_review',
    category: 'web',
    description: 'Review a code snippet for bugs, style issues, and improvement suggestions.',
    inputSchema: {
        type: 'object',
        properties: {
            code: { type: 'string', description: 'Code to review' },
            language: { type: 'string', description: 'Programming language (e.g., typescript, python)' },
        },
        required: ['code'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'external',
    mcpExposed: true,
    auditFields: [],
};

export const PAID_TOOL_CONFIGS: readonly PaidToolConfig[] = [
    { definition: knowledgeQueryDefinition, priceCents: 1 },     // $0.01
    { definition: documentSummaryDefinition, priceCents: 5 },    // $0.05
    { definition: codeReviewDefinition, priceCents: 10 },        // $0.10
];

export const PAID_TOOL_DEFINITIONS: readonly ToolDefinition[] =
    PAID_TOOL_CONFIGS.map(c => c.definition);

// ── Paid Tool Handler Factories ─────────────────────────────────────────

export interface PaidToolDeps {
    /** Query semantic memory */
    readonly querySemanticMemory?: (query: string, category?: string, limit?: number) => Array<{
        key: string;
        value: string;
        category: string;
        confidence: number;
    }>;
}

/**
 * knowledge_query handler — searches the agent's semantic memory.
 */
export function createKnowledgeQueryHandler(deps: PaidToolDeps): ToolHandler {
    return async (args: Record<string, unknown>): Promise<string> => {
        const query = (args['query'] as string) ?? '';
        const category = args['category'] as string | undefined;
        const maxResults = (args['maxResults'] as number) ?? 10;

        if (!query.trim()) {
            return JSON.stringify({ error: 'Query cannot be empty' });
        }

        if (!deps.querySemanticMemory) {
            return JSON.stringify({
                query,
                results: [],
                message: 'Semantic memory not yet populated. Agent is still learning.',
            });
        }

        const results = deps.querySemanticMemory(query, category, maxResults);
        return JSON.stringify({ query, results, count: results.length });
    };
}

/**
 * document_summary handler — extracts key sentences from text.
 * Uses a simple extractive approach (sentence scoring by position + length).
 */
export function createDocumentSummaryHandler(): ToolHandler {
    return async (args: Record<string, unknown>): Promise<string> => {
        const text = (args['text'] as string) ?? '';
        const maxLength = (args['maxLength'] as number) ?? 500;

        if (!text.trim()) {
            return JSON.stringify({ error: 'Text cannot be empty' });
        }

        // Simple extractive summarization
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);

        if (sentences.length === 0) {
            return JSON.stringify({ summary: text.slice(0, maxLength), method: 'truncation' });
        }

        // Score sentences: prefer early sentences and medium-length ones
        const scored = sentences.map((s, i) => ({
            text: s.trim(),
            score: (1 / (i + 1)) * Math.min(s.trim().length / 100, 1),
        }));
        scored.sort((a, b) => b.score - a.score);

        let summary = '';
        for (const item of scored) {
            if (summary.length + item.text.length + 2 > maxLength) break;
            summary += item.text + '. ';
        }

        return JSON.stringify({
            summary: summary.trim() || text.slice(0, maxLength),
            originalLength: text.length,
            method: 'extractive',
        });
    };
}

/**
 * code_review handler — basic static analysis of code.
 */
export function createCodeReviewHandler(): ToolHandler {
    return async (args: Record<string, unknown>): Promise<string> => {
        const code = (args['code'] as string) ?? '';
        const language = (args['language'] as string) ?? 'unknown';

        if (!code.trim()) {
            return JSON.stringify({ error: 'Code cannot be empty' });
        }

        const issues: Array<{ type: string; message: string; line?: number }> = [];
        const lines = code.split('\n');

        // Basic checks
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const lineNum = i + 1;

            // Check for console.log in production code
            if (line.includes('console.log') && language.includes('script')) {
                issues.push({ type: 'warning', message: 'console.log found — consider using a proper logger', line: lineNum });
            }

            // Check for TODO/FIXME
            if (/\b(TODO|FIXME|HACK)\b/.test(line)) {
                issues.push({ type: 'info', message: `Found ${line.match(/\b(TODO|FIXME|HACK)\b/)?.[0]} comment`, line: lineNum });
            }

            // Check for very long lines
            if (line.length > 120) {
                issues.push({ type: 'style', message: `Line exceeds 120 characters (${line.length})`, line: lineNum });
            }

            // Check for hardcoded URLs/secrets patterns
            if (/(?:password|secret|api_key|apiKey)\s*[:=]\s*['"][^'"]+['"]/i.test(line)) {
                issues.push({ type: 'security', message: 'Possible hardcoded secret detected', line: lineNum });
            }
        }

        return JSON.stringify({
            language,
            lineCount: lines.length,
            issues,
            issueCount: issues.length,
            summary: issues.length === 0
                ? 'No obvious issues found.'
                : `Found ${issues.length} issue(s) to review.`,
        });
    };
}

// ── Handler Map ─────────────────────────────────────────────────────────

export function createPaidToolHandlers(deps: PaidToolDeps): ReadonlyMap<string, ToolHandler> {
    return new Map([
        ['knowledge_query', createKnowledgeQueryHandler(deps)],
        ['document_summary', createDocumentSummaryHandler()],
        ['code_review', createCodeReviewHandler()],
    ]);
}
