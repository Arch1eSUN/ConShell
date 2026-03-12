/**
 * Diagnostics Tools — System introspection, health checks, and observability.
 *
 * 6 tools:
 * system_info, health_check, view_logs, metrics_snapshot, config_view, uptime_stats
 */
import { cpus, totalmem, freemem, hostname, platform, release } from 'node:os';
import type { ToolDefinition } from '@conshell/core';
import type { ToolHandler } from './web-tools.js';

// ── Tool Definitions ────────────────────────────────────────────────────

export const systemInfoDefinition: ToolDefinition = {
    name: 'system_info',
    category: 'diagnostics',
    description: 'Get host system information — OS, CPU, memory, Node.js version, uptime.',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: [],
};

export const healthCheckDefinition: ToolDefinition = {
    name: 'health_check',
    category: 'diagnostics',
    description: 'Run a comprehensive health check on all agent subsystems.',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: true,
    auditFields: [],
};

export const viewLogsDefinition: ToolDefinition = {
    name: 'view_logs',
    category: 'diagnostics',
    description: 'View recent agent log entries.',
    inputSchema: {
        type: 'object',
        properties: {
            level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], description: 'Minimum log level (default info)' },
            count: { type: 'number', description: 'Number of log entries (default 50)' },
            search: { type: 'string', description: 'Optional search filter' },
        },
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['level', 'search'],
};

export const metricsSnapshotDefinition: ToolDefinition = {
    name: 'metrics_snapshot',
    category: 'diagnostics',
    description: 'Capture a snapshot of current agent metrics (inference, tools, memory, spend).',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: true,
    auditFields: [],
};

export const configViewDefinition: ToolDefinition = {
    name: 'config_view',
    category: 'diagnostics',
    description: 'View the active agent configuration (redacted secrets).',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: [],
};

export const uptimeStatsDefinition: ToolDefinition = {
    name: 'uptime_stats',
    category: 'diagnostics',
    description: 'Get uptime statistics including total runtime, heartbeat count, and restart history.',
    inputSchema: { type: 'object', properties: {} },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: true,
    auditFields: [],
};

export const DIAGNOSTICS_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    systemInfoDefinition, healthCheckDefinition, viewLogsDefinition,
    metricsSnapshotDefinition, configViewDefinition, uptimeStatsDefinition,
];

// ── Handler Deps ────────────────────────────────────────────────────────

export interface DiagnosticsToolDeps {
    readonly getHealthStatus?: () => {
        status: 'healthy' | 'degraded' | 'unhealthy';
        subsystems: Record<string, { ok: boolean; message: string }>;
    };
    readonly getRecentLogs?: (level: string, count: number, search?: string) => Array<{
        timestamp: string;
        level: string;
        message: string;
        data?: Record<string, unknown>;
    }>;
    readonly getMetrics?: () => {
        inferenceCount: number;
        toolCallCount: number;
        memoryEntries: number;
        totalSpend: number;
        heartbeats: number;
    };
    readonly getConfig?: () => Record<string, unknown>;
    readonly getUptimeStats?: () => {
        uptime: number;
        startedAt: string;
        heartbeatCount: number;
        restartCount: number;
    };
}

// ── Handler Factory ─────────────────────────────────────────────────────

export function createDiagnosticsToolHandlers(deps: DiagnosticsToolDeps): ReadonlyMap<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    handlers.set('system_info', async () => {
        const mem = process.memoryUsage();
        return JSON.stringify({
            hostname: hostname(),
            platform: platform(),
            release: release(),
            cpus: cpus().length,
            totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
            freeMemoryMB: Math.round(freemem() / 1024 / 1024),
            nodeVersion: process.version,
            processMemoryMB: Math.round(mem.heapUsed / 1024 / 1024),
            uptime: Math.round(process.uptime()),
        });
    });

    handlers.set('health_check', async () => {
        if (!deps.getHealthStatus) {
            return JSON.stringify({
                status: 'unknown',
                subsystems: { runtime: { ok: true, message: 'Runtime is up' } },
            });
        }
        return JSON.stringify(deps.getHealthStatus());
    });

    handlers.set('view_logs', async (args) => {
        const level = (args['level'] as string) ?? 'info';
        const count = (args['count'] as number) ?? 50;
        const search = args['search'] as string | undefined;
        if (!deps.getRecentLogs) return JSON.stringify({ entries: [], message: 'Log reader not configured' });
        const entries = deps.getRecentLogs(level, count, search);
        return JSON.stringify({ entries, count: entries.length });
    });

    handlers.set('metrics_snapshot', async () => {
        if (!deps.getMetrics) {
            return JSON.stringify({
                inferenceCount: 0, toolCallCount: 0,
                memoryEntries: 0, totalSpend: 0, heartbeats: 0,
            });
        }
        return JSON.stringify(deps.getMetrics());
    });

    handlers.set('config_view', async () => {
        if (!deps.getConfig) return JSON.stringify({ message: 'Config viewer not configured' });
        const config = deps.getConfig();
        // Redact sensitive keys
        const redacted = { ...config };
        const sensitiveKeys = ['apiKey', 'secret', 'password', 'token', 'privateKey'];
        for (const key of Object.keys(redacted)) {
            if (sensitiveKeys.some(s => key.toLowerCase().includes(s.toLowerCase()))) {
                (redacted as Record<string, unknown>)[key] = '***REDACTED***';
            }
        }
        return JSON.stringify(redacted);
    });

    handlers.set('uptime_stats', async () => {
        if (!deps.getUptimeStats) {
            return JSON.stringify({
                uptime: Math.round(process.uptime()),
                startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
                heartbeatCount: 0,
                restartCount: 0,
            });
        }
        return JSON.stringify(deps.getUptimeStats());
    });

    return handlers;
}
