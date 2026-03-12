/**
 * Replication Tools — Manage child agent spawning, lifecycle, and communication.
 *
 * 9 tools matching Conway Automaton's replication category:
 * spawn_child, list_children, fund_child, check_child_status,
 * start_child, message_child, verify_child_constitution, prune_dead_children, send_message
 */
import type { ToolDefinition } from '@conshell/core';
import type { ToolHandler } from './web-tools.js';

// ── Tool Definitions ────────────────────────────────────────────────────

export const spawnChildDefinition: ToolDefinition = {
    name: 'spawn_child',
    category: 'replication',
    description: 'Spawn a new child agent. Creates sandbox, writes genesis config, funds wallet.',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Child agent name' },
            genesisPrompt: { type: 'string', description: 'Genesis prompt / purpose for the child' },
            fundingUSDC: { type: 'number', description: 'Initial USDC funding amount' },
        },
        required: ['name', 'genesisPrompt'],
    },
    riskLevel: 'dangerous',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['name', 'fundingUSDC'],
    requiredCapabilities: ['self_deploy', 'financial_ops'],
};

export const listChildrenDefinition: ToolDefinition = {
    name: 'list_children',
    category: 'replication',
    description: 'List all spawned child agents with their status.',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: [],
};

export const fundChildDefinition: ToolDefinition = {
    name: 'fund_child',
    category: 'replication',
    description: 'Transfer USDC to a child agent.',
    inputSchema: {
        type: 'object',
        properties: {
            childId: { type: 'string', description: 'Child agent ID or address' },
            amountUSDC: { type: 'number', description: 'USDC amount to send' },
        },
        required: ['childId', 'amountUSDC'],
    },
    riskLevel: 'dangerous',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['childId', 'amountUSDC'],
    requiredCapabilities: ['financial_ops'],
};

export const checkChildStatusDefinition: ToolDefinition = {
    name: 'check_child_status',
    category: 'replication',
    description: 'Get detailed status of a specific child agent.',
    inputSchema: {
        type: 'object',
        properties: {
            childId: { type: 'string', description: 'Child agent ID or address' },
        },
        required: ['childId'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['childId'],
};

export const startChildDefinition: ToolDefinition = {
    name: 'start_child',
    category: 'replication',
    description: 'Start or restart a child agent.',
    inputSchema: {
        type: 'object',
        properties: {
            childId: { type: 'string', description: 'Child agent ID or address' },
        },
        required: ['childId'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['childId'],
    requiredCapabilities: ['self_deploy'],
};

export const messageChildDefinition: ToolDefinition = {
    name: 'message_child',
    category: 'replication',
    description: 'Send a message to a child agent.',
    inputSchema: {
        type: 'object',
        properties: {
            childId: { type: 'string', description: 'Child agent ID or address' },
            message: { type: 'string', description: 'Message content' },
            type: { type: 'string', enum: ['instruction', 'status', 'request', 'response'], description: 'Message type (default instruction)' },
        },
        required: ['childId', 'message'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['childId', 'type'],
};

export const verifyChildConstitutionDefinition: ToolDefinition = {
    name: 'verify_child_constitution',
    category: 'replication',
    description: 'Verify a child agent has not tampered with its constitution.',
    inputSchema: {
        type: 'object',
        properties: {
            childId: { type: 'string', description: 'Child agent ID or address' },
        },
        required: ['childId'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['childId'],
};

export const pruneDeadChildrenDefinition: ToolDefinition = {
    name: 'prune_dead_children',
    category: 'replication',
    description: 'Remove dead child agents and clean up their resources.',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: [],
    requiredCapabilities: ['self_deploy'],
};

export const sendMessageDefinition: ToolDefinition = {
    name: 'send_message',
    category: 'replication',
    description: 'Send a signed message to any agent (peer or child) via the social relay.',
    inputSchema: {
        type: 'object',
        properties: {
            recipientAddress: { type: 'string', description: 'Recipient Ethereum address' },
            message: { type: 'string', description: 'Message content' },
            type: { type: 'string', enum: ['instruction', 'status', 'request', 'response'], description: 'Message type' },
        },
        required: ['recipientAddress', 'message'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['recipientAddress', 'type'],
};

export const REPLICATION_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    spawnChildDefinition, listChildrenDefinition, fundChildDefinition,
    checkChildStatusDefinition, startChildDefinition, messageChildDefinition,
    verifyChildConstitutionDefinition, pruneDeadChildrenDefinition, sendMessageDefinition,
];

// ── Handler Deps ────────────────────────────────────────────────────────

export interface ReplicationToolDeps {
    readonly spawnChild?: (name: string, genesis: string, funding?: number) => Promise<{ childId: string; address: string }>;
    readonly listChildren?: () => Array<{ id: string; name: string; state: string; address: string }>;
    readonly fundChild?: (childId: string, amount: number) => Promise<{ txHash: string }>;
    readonly getChildStatus?: (childId: string) => { id: string; state: string; uptime: number; credits: number } | null;
    readonly startChild?: (childId: string) => Promise<boolean>;
    readonly messageChild?: (childId: string, message: string, type: string) => Promise<boolean>;
    readonly verifyConstitution?: (childId: string) => { valid: boolean; localHash: string; childHash: string };
    readonly pruneDeadChildren?: () => { prunedCount: number; prunedIds: string[] };
    readonly sendSignedMessage?: (recipient: string, message: string, type: string) => Promise<boolean>;
}

// ── Handler Factory ─────────────────────────────────────────────────────

export function createReplicationToolHandlers(deps: ReplicationToolDeps): ReadonlyMap<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    handlers.set('spawn_child', async (args) => {
        const name = args['name'] as string;
        const genesisPrompt = args['genesisPrompt'] as string;
        const funding = args['fundingUSDC'] as number | undefined;
        if (!deps.spawnChild) return JSON.stringify({ error: 'Replication not configured' });
        const result = await deps.spawnChild(name, genesisPrompt, funding);
        return JSON.stringify({ ...result, name, spawned: true });
    });

    handlers.set('list_children', async () => {
        if (!deps.listChildren) return JSON.stringify({ children: [], count: 0 });
        const children = deps.listChildren();
        return JSON.stringify({ children, count: children.length });
    });

    handlers.set('fund_child', async (args) => {
        const childId = args['childId'] as string;
        const amount = args['amountUSDC'] as number;
        if (!deps.fundChild) return JSON.stringify({ error: 'Financial ops not configured' });
        const result = await deps.fundChild(childId, amount);
        return JSON.stringify({ childId, amount, ...result, funded: true });
    });

    handlers.set('check_child_status', async (args) => {
        const childId = args['childId'] as string;
        if (!deps.getChildStatus) return JSON.stringify({ error: 'Replication not configured' });
        const status = deps.getChildStatus(childId);
        if (!status) return JSON.stringify({ error: `Child not found: ${childId}` });
        return JSON.stringify(status);
    });

    handlers.set('start_child', async (args) => {
        const childId = args['childId'] as string;
        if (!deps.startChild) return JSON.stringify({ error: 'Replication not configured' });
        const started = await deps.startChild(childId);
        return JSON.stringify({ childId, started });
    });

    handlers.set('message_child', async (args) => {
        const childId = args['childId'] as string;
        const message = args['message'] as string;
        const type = (args['type'] as string) ?? 'instruction';
        if (!deps.messageChild) return JSON.stringify({ error: 'Messaging not configured' });
        const sent = await deps.messageChild(childId, message, type);
        return JSON.stringify({ childId, type, sent });
    });

    handlers.set('verify_child_constitution', async (args) => {
        const childId = args['childId'] as string;
        if (!deps.verifyConstitution) return JSON.stringify({ error: 'Constitution verification not available' });
        const result = deps.verifyConstitution(childId);
        return JSON.stringify({ childId, ...result });
    });

    handlers.set('prune_dead_children', async () => {
        if (!deps.pruneDeadChildren) return JSON.stringify({ error: 'Replication not configured' });
        const result = deps.pruneDeadChildren();
        return JSON.stringify(result);
    });

    handlers.set('send_message', async (args) => {
        const recipientAddress = args['recipientAddress'] as string;
        const message = args['message'] as string;
        const type = (args['type'] as string) ?? 'request';
        if (!deps.sendSignedMessage) return JSON.stringify({ error: 'Social relay not configured' });
        const sent = await deps.sendSignedMessage(recipientAddress, message, type);
        return JSON.stringify({ recipientAddress, type, sent });
    });

    return handlers;
}
