/**
 * Shell Tools — Execute commands on the host machine.
 *
 * Requires: shell_exec capability
 */
import { exec, spawn } from 'node:child_process';
import type { ToolDefinition } from '@conshell/core';
import type { ToolHandler } from './web-tools.js';

// ── Tool Definitions ────────────────────────────────────────────────────

export const shellRunDefinition: ToolDefinition = {
    name: 'shell_run',
    category: 'shell',
    description: 'Execute a shell command and return stdout/stderr. Timeout: 30s.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            cwd: { type: 'string', description: 'Working directory (optional)' },
            timeout: { type: 'number', description: 'Timeout in ms (default 30000)' },
        },
        required: ['command'],
    },
    riskLevel: 'dangerous',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['command'],
    requiredCapabilities: ['shell_exec'],
};

export const shellRunBgDefinition: ToolDefinition = {
    name: 'shell_run_bg',
    category: 'shell',
    description: 'Run a command in the background. Returns PID immediately.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            cwd: { type: 'string', description: 'Working directory (optional)' },
        },
        required: ['command'],
    },
    riskLevel: 'dangerous',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['command'],
    requiredCapabilities: ['shell_exec'],
};

export const SHELL_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    shellRunDefinition,
    shellRunBgDefinition,
];

// ── Handlers ────────────────────────────────────────────────────────────

const shellRunHandler: ToolHandler = async (args) => {
    const command = args['command'] as string;
    const cwd = (args['cwd'] as string) ?? process.cwd();
    const timeout = (args['timeout'] as number) ?? 30000;

    return new Promise((resolve) => {
        exec(command, { cwd, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            const maxLen = 16000;
            resolve(JSON.stringify({
                exitCode: error ? error.code ?? 1 : 0,
                stdout: stdout.slice(0, maxLen),
                stderr: stderr.slice(0, 4000),
                truncated: stdout.length > maxLen || stderr.length > 4000,
            }));
        });
    });
};

const shellRunBgHandler: ToolHandler = async (args) => {
    const command = args['command'] as string;
    const cwd = (args['cwd'] as string) ?? process.cwd();

    const child = spawn(command, {
        cwd,
        shell: true,
        detached: true,
        stdio: 'ignore',
    });
    child.unref();

    return JSON.stringify({ pid: child.pid, status: 'launched' });
};

export const SHELL_TOOL_HANDLERS: ReadonlyMap<string, ToolHandler> = new Map([
    ['shell_run', shellRunHandler],
    ['shell_run_bg', shellRunBgHandler],
]);
