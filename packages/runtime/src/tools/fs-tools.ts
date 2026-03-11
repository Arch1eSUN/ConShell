/**
 * Filesystem Tools — Read/write files on the host machine.
 *
 * Requires: file_system capability
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolDefinition } from '@conshell/core';
import type { ToolHandler } from './web-tools.js';

// ── Tool Definitions ────────────────────────────────────────────────────

export const fileReadDefinition: ToolDefinition = {
    name: 'file_read',
    category: 'filesystem',
    description: 'Read a file and return its text content.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute or relative file path' },
            maxLength: { type: 'number', description: 'Max characters to return (default 16000)' },
        },
        required: ['path'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['path'],
    requiredCapabilities: ['file_system'],
};

export const fileWriteDefinition: ToolDefinition = {
    name: 'file_write',
    category: 'filesystem',
    description: 'Write content to a file. Creates the file if it does not exist.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute or relative file path' },
            content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
    },
    riskLevel: 'dangerous',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['path'],
    requiredCapabilities: ['file_system'],
};

export const fileListDefinition: ToolDefinition = {
    name: 'file_list',
    category: 'filesystem',
    description: 'List files and directories in a path.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Directory path to list' },
        },
        required: ['path'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['path'],
    requiredCapabilities: ['file_system'],
};

export const FS_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    fileReadDefinition,
    fileWriteDefinition,
    fileListDefinition,
];

// ── Handlers ────────────────────────────────────────────────────────────

const fileReadHandler: ToolHandler = async (args) => {
    const filePath = resolve(args['path'] as string);
    const maxLength = (args['maxLength'] as number) ?? 16000;
    const content = await readFile(filePath, 'utf-8');
    const truncated = content.length > maxLength;
    return JSON.stringify({
        path: filePath,
        content: content.slice(0, maxLength),
        length: content.length,
        truncated,
    });
};

const fileWriteHandler: ToolHandler = async (args) => {
    const filePath = resolve(args['path'] as string);
    const content = args['content'] as string;
    await writeFile(filePath, content, 'utf-8');
    return JSON.stringify({ path: filePath, bytesWritten: content.length, success: true });
};

const fileListHandler: ToolHandler = async (args) => {
    const dirPath = resolve(args['path'] as string);
    const entries = await readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(
        entries.slice(0, 100).map(async (e) => {
            const fullPath = resolve(dirPath, e.name);
            try {
                const s = await stat(fullPath);
                return {
                    name: e.name,
                    type: e.isDirectory() ? 'directory' : 'file',
                    size: s.size,
                };
            } catch {
                return { name: e.name, type: 'unknown', size: 0 };
            }
        }),
    );
    return JSON.stringify({ path: dirPath, entries: items, total: entries.length });
};

export const FS_TOOL_HANDLERS: ReadonlyMap<string, ToolHandler> = new Map([
    ['file_read', fileReadHandler],
    ['file_write', fileWriteHandler],
    ['file_list', fileListHandler],
]);
