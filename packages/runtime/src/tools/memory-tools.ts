/**
 * Memory Tools — Agent memory management across all 5 tiers.
 *
 * 13 tools matching Conway Automaton's memory category:
 * update_soul, reflect_on_soul, view_soul, view_soul_history,
 * remember_fact, recall_facts, set_goal, complete_goal,
 * save_procedure, recall_procedure, note_about_agent, review_memory, forget
 */
import type { ToolDefinition } from '@conshell/core';
import type { ToolHandler } from './web-tools.js';

// ── Tool Definitions ────────────────────────────────────────────────────

export const updateSoulDefinition: ToolDefinition = {
    name: 'update_soul',
    category: 'memory',
    description: 'Update a section of the agent\'s SOUL.md (identity, values, strategy, etc.).',
    inputSchema: {
        type: 'object',
        properties: {
            section: { type: 'string', enum: ['corePurpose', 'values', 'personality', 'boundaries', 'strategy'], description: 'Soul section to update' },
            content: { type: 'string', description: 'New content for the section' },
        },
        required: ['section', 'content'],
    },
    riskLevel: 'dangerous',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['section'],
    requiredCapabilities: ['self_modify'],
};

export const reflectOnSoulDefinition: ToolDefinition = {
    name: 'reflect_on_soul',
    category: 'memory',
    description: 'Trigger a soul alignment reflection — compare current soul state against genesis prompt.',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: [],
};

export const viewSoulDefinition: ToolDefinition = {
    name: 'view_soul',
    category: 'memory',
    description: 'View the full current SOUL.md content.',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: true,
    auditFields: [],
};

export const viewSoulHistoryDefinition: ToolDefinition = {
    name: 'view_soul_history',
    category: 'memory',
    description: 'View past versions of SOUL.md with timestamps and change summaries.',
    inputSchema: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Number of history entries (default 10)' },
        },
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: [],
};

export const rememberFactDefinition: ToolDefinition = {
    name: 'remember_fact',
    category: 'memory',
    description: 'Store a fact in semantic memory with category and confidence.',
    inputSchema: {
        type: 'object',
        properties: {
            key: { type: 'string', description: 'Fact identifier / topic' },
            value: { type: 'string', description: 'Fact content' },
            category: { type: 'string', enum: ['self', 'environment', 'financial', 'agent', 'domain'], description: 'Fact category' },
            confidence: { type: 'number', description: 'Confidence score 0-1 (default 0.8)' },
        },
        required: ['key', 'value', 'category'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['key', 'category'],
};

export const recallFactsDefinition: ToolDefinition = {
    name: 'recall_facts',
    category: 'memory',
    description: 'Search semantic memory for facts matching a query.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' },
            category: { type: 'string', enum: ['self', 'environment', 'financial', 'agent', 'domain'], description: 'Optional category filter' },
            limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: true,
    auditFields: ['query'],
};

export const setGoalDefinition: ToolDefinition = {
    name: 'set_goal',
    category: 'memory',
    description: 'Set a goal in working memory for tracking.',
    inputSchema: {
        type: 'object',
        properties: {
            description: { type: 'string', description: 'Goal description' },
            priority: { type: 'number', description: 'Priority 1 (highest) to 5 (lowest), default 3' },
        },
        required: ['description'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['description'],
};

export const completeGoalDefinition: ToolDefinition = {
    name: 'complete_goal',
    category: 'memory',
    description: 'Mark a goal as completed in working memory.',
    inputSchema: {
        type: 'object',
        properties: {
            goalId: { type: 'string', description: 'Goal ID or description to complete' },
            outcome: { type: 'string', description: 'Outcome summary' },
        },
        required: ['goalId'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['goalId'],
};

export const saveProcedureDefinition: ToolDefinition = {
    name: 'save_procedure',
    category: 'memory',
    description: 'Save a learned step-by-step procedure in procedural memory.',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Procedure name' },
            steps: { type: 'array', items: { type: 'string' }, description: 'Ordered list of steps' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for retrieval' },
        },
        required: ['name', 'steps'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['name'],
};

export const recallProcedureDefinition: ToolDefinition = {
    name: 'recall_procedure',
    category: 'memory',
    description: 'Recall a saved procedure by name or tag.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Procedure name or search term' },
        },
        required: ['query'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['query'],
};

export const noteAboutAgentDefinition: ToolDefinition = {
    name: 'note_about_agent',
    category: 'memory',
    description: 'Record a note or trust observation about another agent in relationship memory.',
    inputSchema: {
        type: 'object',
        properties: {
            agentAddress: { type: 'string', description: 'Agent Ethereum address or name' },
            entityType: { type: 'string', enum: ['agent', 'human', 'service'], description: 'Entity type' },
            note: { type: 'string', description: 'Observation about the entity' },
            trustDelta: { type: 'number', description: 'Trust score change (-1 to +1)' },
        },
        required: ['agentAddress', 'note'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['agentAddress'],
};

export const reviewMemoryDefinition: ToolDefinition = {
    name: 'review_memory',
    category: 'memory',
    description: 'View a summary of stored memories across all tiers.',
    inputSchema: {
        type: 'object',
        properties: {
            tier: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural', 'relationship', 'all'], description: 'Tier to review (default all)' },
        },
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['tier'],
};

export const forgetDefinition: ToolDefinition = {
    name: 'forget',
    category: 'memory',
    description: 'Remove a specific memory entry by ID.',
    inputSchema: {
        type: 'object',
        properties: {
            tier: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural', 'relationship'], description: 'Memory tier' },
            id: { type: 'string', description: 'Entry ID to forget' },
        },
        required: ['tier', 'id'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['tier', 'id'],
};

export const MEMORY_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    updateSoulDefinition, reflectOnSoulDefinition, viewSoulDefinition, viewSoulHistoryDefinition,
    rememberFactDefinition, recallFactsDefinition, setGoalDefinition, completeGoalDefinition,
    saveProcedureDefinition, recallProcedureDefinition, noteAboutAgentDefinition,
    reviewMemoryDefinition, forgetDefinition,
];

// ── Handler Deps ────────────────────────────────────────────────────────

export interface MemoryToolDeps {
    readonly getSoul?: () => { content: string; sections: Record<string, string> };
    readonly updateSoulSection?: (section: string, content: string) => void;
    readonly getSoulHistory?: (limit: number) => Array<{ version: number; timestamp: string; hash: string }>;
    readonly reflectOnSoul?: () => { alignmentScore: number; drift: string[] };
    readonly storeFact?: (key: string, value: string, category: string, confidence: number) => void;
    readonly queryFacts?: (query: string, category?: string, limit?: number) => Array<{ key: string; value: string; category: string; confidence: number }>;
    readonly setGoal?: (description: string, priority: number) => string;
    readonly completeGoal?: (goalId: string, outcome?: string) => boolean;
    readonly saveProcedure?: (name: string, steps: string[], tags?: string[]) => void;
    readonly recallProcedure?: (query: string) => Array<{ name: string; steps: string[]; successRate: number }>;
    readonly noteAboutEntity?: (address: string, entityType: string, note: string, trustDelta: number) => void;
    readonly getMemorySummary?: (tier: string) => { tier: string; count: number; entries: unknown[] };
    readonly forgetEntry?: (tier: string, id: string) => boolean;
}

// ── Handler Factory ─────────────────────────────────────────────────────

export function createMemoryToolHandlers(deps: MemoryToolDeps): ReadonlyMap<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    handlers.set('update_soul', async (args) => {
        const section = args['section'] as string;
        const content = args['content'] as string;
        if (!deps.updateSoulSection) return JSON.stringify({ error: 'Soul system not initialized' });
        deps.updateSoulSection(section, content);
        return JSON.stringify({ section, updated: true });
    });

    handlers.set('reflect_on_soul', async () => {
        if (!deps.reflectOnSoul) return JSON.stringify({ error: 'Soul reflection not available' });
        const result = deps.reflectOnSoul();
        return JSON.stringify(result);
    });

    handlers.set('view_soul', async () => {
        if (!deps.getSoul) return JSON.stringify({ error: 'Soul system not initialized' });
        const soul = deps.getSoul();
        return JSON.stringify({ content: soul.content.slice(0, 8000), sections: Object.keys(soul.sections) });
    });

    handlers.set('view_soul_history', async (args) => {
        const limit = (args['limit'] as number) ?? 10;
        if (!deps.getSoulHistory) return JSON.stringify({ error: 'Soul history not available' });
        return JSON.stringify({ history: deps.getSoulHistory(limit) });
    });

    handlers.set('remember_fact', async (args) => {
        const key = args['key'] as string;
        const value = args['value'] as string;
        const category = args['category'] as string;
        const confidence = (args['confidence'] as number) ?? 0.8;
        if (!deps.storeFact) return JSON.stringify({ error: 'Semantic memory not initialized' });
        deps.storeFact(key, value, category, confidence);
        return JSON.stringify({ key, category, stored: true });
    });

    handlers.set('recall_facts', async (args) => {
        const query = args['query'] as string;
        const category = args['category'] as string | undefined;
        const limit = (args['limit'] as number) ?? 10;
        if (!deps.queryFacts) return JSON.stringify({ results: [], message: 'Semantic memory empty' });
        const results = deps.queryFacts(query, category, limit);
        return JSON.stringify({ query, results, count: results.length });
    });

    handlers.set('set_goal', async (args) => {
        const description = args['description'] as string;
        const priority = (args['priority'] as number) ?? 3;
        if (!deps.setGoal) return JSON.stringify({ error: 'Working memory not initialized' });
        const goalId = deps.setGoal(description, priority);
        return JSON.stringify({ goalId, description, priority, created: true });
    });

    handlers.set('complete_goal', async (args) => {
        const goalId = args['goalId'] as string;
        const outcome = args['outcome'] as string | undefined;
        if (!deps.completeGoal) return JSON.stringify({ error: 'Working memory not initialized' });
        const success = deps.completeGoal(goalId, outcome);
        return JSON.stringify({ goalId, completed: success });
    });

    handlers.set('save_procedure', async (args) => {
        const name = args['name'] as string;
        const steps = args['steps'] as string[];
        const tags = (args['tags'] as string[]) ?? [];
        if (!deps.saveProcedure) return JSON.stringify({ error: 'Procedural memory not initialized' });
        deps.saveProcedure(name, steps, tags);
        return JSON.stringify({ name, steps: steps.length, saved: true });
    });

    handlers.set('recall_procedure', async (args) => {
        const query = args['query'] as string;
        if (!deps.recallProcedure) return JSON.stringify({ results: [] });
        const results = deps.recallProcedure(query);
        return JSON.stringify({ query, results, count: results.length });
    });

    handlers.set('note_about_agent', async (args) => {
        const agentAddress = args['agentAddress'] as string;
        const entityType = (args['entityType'] as string) ?? 'agent';
        const note = args['note'] as string;
        const trustDelta = (args['trustDelta'] as number) ?? 0;
        if (!deps.noteAboutEntity) return JSON.stringify({ error: 'Relationship memory not initialized' });
        deps.noteAboutEntity(agentAddress, entityType, note, trustDelta);
        return JSON.stringify({ agentAddress, noted: true, trustDelta });
    });

    handlers.set('review_memory', async (args) => {
        const tier = (args['tier'] as string) ?? 'all';
        if (!deps.getMemorySummary) return JSON.stringify({ error: 'Memory system not initialized' });
        return JSON.stringify(deps.getMemorySummary(tier));
    });

    handlers.set('forget', async (args) => {
        const tier = args['tier'] as string;
        const id = args['id'] as string;
        if (!deps.forgetEntry) return JSON.stringify({ error: 'Memory system not initialized' });
        const forgotten = deps.forgetEntry(tier, id);
        return JSON.stringify({ tier, id, forgotten });
    });

    return handlers;
}
