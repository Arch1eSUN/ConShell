/**
 * Git Tools — Version control operations for the agent's workspace.
 *
 * 7 tools matching Conway Automaton's git category:
 * git_status, git_diff, git_commit, git_log, git_push, git_branch, git_clone
 *
 * Requires: file_system capability
 */
import { exec } from 'node:child_process';
import type { ToolDefinition } from '@conshell/core';
import type { ToolHandler } from './web-tools.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function git(command: string, cwd: string, timeout = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`git ${command}`, { cwd, timeout, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr.trim() || err.message));
            else resolve(stdout.trim());
        });
    });
}

// ── Tool Definitions ────────────────────────────────────────────────────

export const gitStatusDefinition: ToolDefinition = {
    name: 'git_status',
    category: 'git',
    description: 'Show the working tree status of a git repository.',
    inputSchema: {
        type: 'object',
        properties: {
            cwd: { type: 'string', description: 'Repository directory path' },
        },
        required: ['cwd'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['cwd'],
    requiredCapabilities: ['file_system'],
};

export const gitDiffDefinition: ToolDefinition = {
    name: 'git_diff',
    category: 'git',
    description: 'Show changes between commits, working tree, etc.',
    inputSchema: {
        type: 'object',
        properties: {
            cwd: { type: 'string', description: 'Repository directory path' },
            target: { type: 'string', description: 'Diff target (e.g., HEAD, staged, commit hash). Default: unstaged changes.' },
            path: { type: 'string', description: 'Optional path filter' },
        },
        required: ['cwd'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['cwd', 'target'],
    requiredCapabilities: ['file_system'],
};

export const gitCommitDefinition: ToolDefinition = {
    name: 'git_commit',
    category: 'git',
    description: 'Stage all changes and create a commit.',
    inputSchema: {
        type: 'object',
        properties: {
            cwd: { type: 'string', description: 'Repository directory path' },
            message: { type: 'string', description: 'Commit message' },
            addAll: { type: 'boolean', description: 'Stage all changes before commit (default true)' },
        },
        required: ['cwd', 'message'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['cwd', 'message'],
    requiredCapabilities: ['file_system'],
};

export const gitLogDefinition: ToolDefinition = {
    name: 'git_log',
    category: 'git',
    description: 'Show recent commit log.',
    inputSchema: {
        type: 'object',
        properties: {
            cwd: { type: 'string', description: 'Repository directory path' },
            count: { type: 'number', description: 'Number of commits to show (default 10)' },
            oneline: { type: 'boolean', description: 'Use one-line format (default true)' },
        },
        required: ['cwd'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['cwd'],
    requiredCapabilities: ['file_system'],
};

export const gitPushDefinition: ToolDefinition = {
    name: 'git_push',
    category: 'git',
    description: 'Push commits to a remote repository.',
    inputSchema: {
        type: 'object',
        properties: {
            cwd: { type: 'string', description: 'Repository directory path' },
            remote: { type: 'string', description: 'Remote name (default origin)' },
            branch: { type: 'string', description: 'Branch name (default current branch)' },
        },
        required: ['cwd'],
    },
    riskLevel: 'dangerous',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['cwd', 'remote', 'branch'],
    requiredCapabilities: ['file_system'],
};

export const gitBranchDefinition: ToolDefinition = {
    name: 'git_branch',
    category: 'git',
    description: 'List, create, or switch branches.',
    inputSchema: {
        type: 'object',
        properties: {
            cwd: { type: 'string', description: 'Repository directory path' },
            action: { type: 'string', enum: ['list', 'create', 'switch'], description: 'Action to perform (default list)' },
            name: { type: 'string', description: 'Branch name (required for create/switch)' },
        },
        required: ['cwd'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['cwd', 'action', 'name'],
    requiredCapabilities: ['file_system'],
};

export const gitCloneDefinition: ToolDefinition = {
    name: 'git_clone',
    category: 'git',
    description: 'Clone a git repository.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Repository URL to clone' },
            dest: { type: 'string', description: 'Destination directory' },
            depth: { type: 'number', description: 'Shallow clone depth (optional)' },
        },
        required: ['url', 'dest'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['url', 'dest'],
    requiredCapabilities: ['file_system'],
};

export const GIT_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    gitStatusDefinition,
    gitDiffDefinition,
    gitCommitDefinition,
    gitLogDefinition,
    gitPushDefinition,
    gitBranchDefinition,
    gitCloneDefinition,
];

// ── Handlers ────────────────────────────────────────────────────────────

const gitStatusHandler: ToolHandler = async (args) => {
    const cwd = args['cwd'] as string;
    const output = await git('status --porcelain', cwd);
    const lines = output ? output.split('\n') : [];
    return JSON.stringify({
        cwd, clean: lines.length === 0, changes: lines.length,
        files: lines.slice(0, 50).map(l => ({ status: l.slice(0, 2).trim(), path: l.slice(3) })),
    });
};

const gitDiffHandler: ToolHandler = async (args) => {
    const cwd = args['cwd'] as string;
    const target = (args['target'] as string) ?? '';
    const path = (args['path'] as string) ?? '';
    const cmd = target === 'staged' ? 'diff --cached' : target ? `diff ${target}` : 'diff';
    const output = await git(`${cmd} --stat ${path}`, cwd);
    const fullDiff = await git(`${cmd} ${path}`, cwd);
    return JSON.stringify({ cwd, stat: output, diff: fullDiff.slice(0, 16000), truncated: fullDiff.length > 16000 });
};

const gitCommitHandler: ToolHandler = async (args) => {
    const cwd = args['cwd'] as string;
    const message = args['message'] as string;
    const addAll = (args['addAll'] as boolean) ?? true;
    if (addAll) await git('add -A', cwd);
    const output = await git(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
    return JSON.stringify({ cwd, message, output: output.slice(0, 2000), success: true });
};

const gitLogHandler: ToolHandler = async (args) => {
    const cwd = args['cwd'] as string;
    const count = (args['count'] as number) ?? 10;
    const oneline = (args['oneline'] as boolean) ?? true;
    const fmt = oneline ? '--oneline' : '--format="%H %s (%an, %ar)"';
    const output = await git(`log -n ${count} ${fmt}`, cwd);
    return JSON.stringify({ cwd, commits: output.split('\n').filter(Boolean), count });
};

const gitPushHandler: ToolHandler = async (args) => {
    const cwd = args['cwd'] as string;
    const remote = (args['remote'] as string) ?? 'origin';
    const branch = (args['branch'] as string) ?? '';
    const output = await git(`push ${remote} ${branch}`.trim(), cwd);
    return JSON.stringify({ cwd, remote, branch, output: output.slice(0, 2000), success: true });
};

const gitBranchHandler: ToolHandler = async (args) => {
    const cwd = args['cwd'] as string;
    const action = (args['action'] as string) ?? 'list';
    const name = args['name'] as string | undefined;
    let output: string;
    switch (action) {
        case 'create':
            if (!name) throw new Error('Branch name required for create');
            output = await git(`checkout -b ${name}`, cwd);
            break;
        case 'switch':
            if (!name) throw new Error('Branch name required for switch');
            output = await git(`checkout ${name}`, cwd);
            break;
        default:
            output = await git('branch -a', cwd);
    }
    return JSON.stringify({ cwd, action, name, output: output.slice(0, 4000) });
};

const gitCloneHandler: ToolHandler = async (args) => {
    const url = args['url'] as string;
    const dest = args['dest'] as string;
    const depth = args['depth'] as number | undefined;
    const depthArg = depth ? `--depth ${depth}` : '';
    const output = await git(`clone ${depthArg} ${url} ${dest}`.trim(), process.cwd(), 60000);
    return JSON.stringify({ url, dest, output: output.slice(0, 2000), success: true });
};

export const GIT_TOOL_HANDLERS: ReadonlyMap<string, ToolHandler> = new Map([
    ['git_status', gitStatusHandler],
    ['git_diff', gitDiffHandler],
    ['git_commit', gitCommitHandler],
    ['git_log', gitLogHandler],
    ['git_push', gitPushHandler],
    ['git_branch', gitBranchHandler],
    ['git_clone', gitCloneHandler],
]);
