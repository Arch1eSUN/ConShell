/**
 * LocalComputeProvider — executes commands on the host OS.
 *
 * No isolation. For development and testing only. Uses child_process.execFile.
 * All file ops relative to a configured workDir (default: cwd).
 */
import { exec as execCb, type ExecException } from 'node:child_process';
import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Logger } from '@conshell/core';
import { nowISO } from '@conshell/core';
import type { ComputeProvider, ExecResult, SandboxInfo, SandboxConfig, ExecOpts } from './provider.js';

export class LocalComputeProvider implements ComputeProvider {
    private readonly sandboxes = new Map<string, SandboxInfo>();

    constructor(
        private readonly logger: Logger,
        private readonly baseDir: string = process.cwd(),
    ) { }

    async createSandbox(config: SandboxConfig): Promise<string> {
        const id = config.name ?? randomUUID();
        const workDir = config.workDir ?? this.baseDir;
        await mkdir(workDir, { recursive: true });

        const info: SandboxInfo = {
            id,
            status: 'running',
            createdAt: nowISO(),
        };
        this.sandboxes.set(id, info);
        this.logger.info('Local sandbox created', { id, workDir });
        return id;
    }

    async destroySandbox(sandboxId: string): Promise<void> {
        const sandbox = this.sandboxes.get(sandboxId);
        if (!sandbox) throw new Error(`Sandbox not found: ${sandboxId}`);
        this.sandboxes.set(sandboxId, { ...sandbox, status: 'stopped' });
        this.logger.info('Local sandbox destroyed', { id: sandboxId });
    }

    async getSandbox(sandboxId: string): Promise<SandboxInfo | undefined> {
        return this.sandboxes.get(sandboxId);
    }

    async exec(sandboxId: string, command: string[], opts?: ExecOpts): Promise<ExecResult> {
        if (!this.sandboxes.has(sandboxId)) throw new Error(`Sandbox not found: ${sandboxId}`);

        const cmd = command.join(' ');
        const cwd = opts?.cwd ?? this.baseDir;
        const timeoutMs = opts?.timeoutMs ?? 30_000;

        const start = Date.now();
        return new Promise<ExecResult>((resolve) => {
            execCb(cmd, { cwd, timeout: timeoutMs }, (error: ExecException | null, stdout: string, stderr: string) => {
                resolve({
                    stdout: stdout ?? '',
                    stderr: stderr ?? '',
                    exitCode: error?.code ?? 0,
                    durationMs: Date.now() - start,
                });
            });
        });
    }

    async readFile(sandboxId: string, path: string): Promise<string> {
        if (!this.sandboxes.has(sandboxId)) throw new Error(`Sandbox not found: ${sandboxId}`);
        const fullPath = join(this.baseDir, path);
        return fsReadFile(fullPath, 'utf-8');
    }

    async writeFile(sandboxId: string, path: string, content: string): Promise<void> {
        if (!this.sandboxes.has(sandboxId)) throw new Error(`Sandbox not found: ${sandboxId}`);
        const fullPath = join(this.baseDir, path);
        await mkdir(dirname(fullPath), { recursive: true });
        await fsWriteFile(fullPath, content, 'utf-8');
    }

    async listSandboxes(): Promise<readonly SandboxInfo[]> {
        return [...this.sandboxes.values()];
    }
}
