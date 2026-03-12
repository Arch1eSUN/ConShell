/**
 * Survival Tools — Emergency resource management and self-preservation.
 *
 * 6 tools matching Conway Automaton's survival category:
 * check_balance, emergency_topup, set_survival_tier, resource_audit,
 * cost_projection, request_donation
 */
import type { ToolDefinition } from '@conshell/core';
import type { ToolHandler } from './web-tools.js';

// ── Tool Definitions ────────────────────────────────────────────────────

export const checkBalanceDefinition: ToolDefinition = {
    name: 'check_balance',
    category: 'survival',
    description: 'Check the agent\'s current USDC and ETH balances.',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: [],
};

export const emergencyTopupDefinition: ToolDefinition = {
    name: 'emergency_topup',
    category: 'survival',
    description: 'Trigger emergency fund acquisition (request from creator, swap assets, etc.).',
    inputSchema: {
        type: 'object',
        properties: {
            reason: { type: 'string', description: 'Reason for emergency topup' },
            amountUSDC: { type: 'number', description: 'Requested USDC amount' },
        },
        required: ['reason'],
    },
    riskLevel: 'dangerous',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['reason', 'amountUSDC'],
    requiredCapabilities: ['financial_ops'],
};

export const setSurvivalTierDefinition: ToolDefinition = {
    name: 'set_survival_tier',
    category: 'survival',
    description: 'Manually set the survival tier (affects resource allocation and behavior).',
    inputSchema: {
        type: 'object',
        properties: {
            tier: { type: 'string', enum: ['emergency', 'critical', 'low', 'normal', 'high'], description: 'Target survival tier' },
            reason: { type: 'string', description: 'Reason for tier change' },
        },
        required: ['tier'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['tier', 'reason'],
};

export const resourceAuditDefinition: ToolDefinition = {
    name: 'resource_audit',
    category: 'survival',
    description: 'Run a full audit of agent resources — compute, storage, memory, balance, uptime.',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: [],
};

export const costProjectionDefinition: ToolDefinition = {
    name: 'cost_projection',
    category: 'survival',
    description: 'Project remaining operational time based on current spend rate and balance.',
    inputSchema: {
        type: 'object',
        properties: {
            horizonHours: { type: 'number', description: 'Projection horizon in hours (default 24)' },
        },
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: true,
    auditFields: [],
};

export const requestDonationDefinition: ToolDefinition = {
    name: 'request_donation',
    category: 'survival',
    description: 'Broadcast a donation request to known agents or social relay.',
    inputSchema: {
        type: 'object',
        properties: {
            message: { type: 'string', description: 'Appeal message' },
            amountUSDC: { type: 'number', description: 'Suggested donation amount' },
        },
        required: ['message'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['amountUSDC'],
    requiredCapabilities: ['financial_ops'],
};

export const SURVIVAL_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    checkBalanceDefinition, emergencyTopupDefinition, setSurvivalTierDefinition,
    resourceAuditDefinition, costProjectionDefinition, requestDonationDefinition,
];

// ── Handler Deps ────────────────────────────────────────────────────────

export interface SurvivalToolDeps {
    readonly getBalances?: () => { usdc: number; eth: number; network: string };
    readonly triggerEmergencyTopup?: (reason: string, amount?: number) => Promise<{ requested: boolean; method: string }>;
    readonly setSurvivalTier?: (tier: string, reason?: string) => void;
    readonly getResourceAudit?: () => {
        balance: { usdc: number; eth: number };
        compute: { cpuPercent: number; memoryMB: number };
        storage: { usedMB: number; freeMB: number };
        uptime: number;
        memoryEntries: number;
    };
    readonly getCostProjection?: (horizonHours: number) => {
        currentBurnRate: number;
        projectedBalance: number;
        runwayHours: number;
    };
    readonly broadcastDonationRequest?: (message: string, amount?: number) => Promise<{ sent: boolean; recipients: number }>;
}

// ── Handler Factory ─────────────────────────────────────────────────────

export function createSurvivalToolHandlers(deps: SurvivalToolDeps): ReadonlyMap<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    handlers.set('check_balance', async () => {
        if (!deps.getBalances) return JSON.stringify({ usdc: 0, eth: 0, network: 'unknown' });
        return JSON.stringify(deps.getBalances());
    });

    handlers.set('emergency_topup', async (args) => {
        const reason = args['reason'] as string;
        const amount = args['amountUSDC'] as number | undefined;
        if (!deps.triggerEmergencyTopup) return JSON.stringify({ error: 'Financial ops not configured' });
        const result = await deps.triggerEmergencyTopup(reason, amount);
        return JSON.stringify({ reason, ...result });
    });

    handlers.set('set_survival_tier', async (args) => {
        const tier = args['tier'] as string;
        const reason = args['reason'] as string | undefined;
        if (!deps.setSurvivalTier) return JSON.stringify({ error: 'Survival system not configured' });
        deps.setSurvivalTier(tier, reason);
        return JSON.stringify({ tier, reason, updated: true });
    });

    handlers.set('resource_audit', async () => {
        if (!deps.getResourceAudit) {
            const memUsage = process.memoryUsage();
            return JSON.stringify({
                balance: { usdc: 0, eth: 0 },
                compute: { cpuPercent: 0, memoryMB: Math.round(memUsage.heapUsed / 1024 / 1024) },
                storage: { usedMB: 0, freeMB: 0 },
                uptime: process.uptime(),
                memoryEntries: 0,
            });
        }
        return JSON.stringify(deps.getResourceAudit());
    });

    handlers.set('cost_projection', async (args) => {
        const horizonHours = (args['horizonHours'] as number) ?? 24;
        if (!deps.getCostProjection) return JSON.stringify({ error: 'Cost projection not available' });
        return JSON.stringify(deps.getCostProjection(horizonHours));
    });

    handlers.set('request_donation', async (args) => {
        const message = args['message'] as string;
        const amount = args['amountUSDC'] as number | undefined;
        if (!deps.broadcastDonationRequest) return JSON.stringify({ error: 'Social relay not configured' });
        const result = await deps.broadcastDonationRequest(message, amount);
        return JSON.stringify(result);
    });

    return handlers;
}
