/**
 * DockerComputeProvider — executes commands inside Docker containers.
 *
 * ADR-001: Docker is the primary sandbox for v1.
 * Uses `docker` CLI via child_process (no Docker SDK dependency).
 */
import { exec as execCb, type ExecException } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Logger } from '@conshell/core';
import { nowISO } from '@conshell/core';
import type { ComputeProvider, ExecResult, SandboxInfo, SandboxConfig, ExecOpts } from './provider.js';

const DEFAULT_IMAGE = 'node:20-slim';
const DEFAULT_MEMORY_MB = 512;

function dockerExec(cmd: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        execCb(cmd, { timeout: timeoutMs }, (error: ExecException | null, stdout: string, stderr: string) => {
            resolve({
                stdout: stdout ?? '',
                stderr: stderr ?? '',
                exitCode: error?.code ?? 0,
            });
        });
    });
}

export class DockerComputeProvider implements ComputeProvider {
    private readonly containers = new Map<string, SandboxInfo>();

    constructor(private readonly logger: Logger) { }

    async createSandbox(config: SandboxConfig): Promise<string> {
        const name = config.name ?? `conshell-${randomUUID().slice(0, 8)}`;
        const image = config.image ?? DEFAULT_IMAGE;
        const memoryMb = config.memoryMb ?? DEFAULT_MEMORY_MB;

        const envFlags = config.env
            ? Object.entries(config.env).map(([k, v]) => `-e ${k}=${v}`).join(' ')
            : '';

        const cmd = `docker create --name ${name} --memory ${memoryMb}m ${envFlags} ${image} tail -f /dev/null`;
        const result = await dockerExec(cmd);

        if (result.exitCode !== 0) {
            throw new Error(`Docker create failed: ${result.stderr}`);
        }

        // Start the container
        const startResult = await dockerExec(`docker start ${name}`);
        if (startResult.exitCode !== 0) {
            throw new Error(`Docker start failed: ${startResult.stderr}`);
        }

        const info: SandboxInfo = {
            id: name,
            status: 'running',
            createdAt: nowISO(),
        };
        this.containers.set(name, info);
        this.logger.info('Docker sandbox created', { name, image, memoryMb });
        return name;
    }

    async destroySandbox(sandboxId: string): Promise<void> {
        await dockerExec(`docker rm -f ${sandboxId}`);
        const info = this.containers.get(sandboxId);
        if (info) {
            this.containers.set(sandboxId, { ...info, status: 'stopped' });
        }
        this.logger.info('Docker sandbox destroyed', { id: sandboxId });
    }

    async getSandbox(sandboxId: string): Promise<SandboxInfo | undefined> {
        return this.containers.get(sandboxId);
    }

    async exec(sandboxId: string, command: string[], opts?: ExecOpts): Promise<ExecResult> {
        const cwdFlag = opts?.cwd ? `-w ${opts.cwd}` : '';
        const cmd = `docker exec ${cwdFlag} ${sandboxId} ${command.join(' ')}`;
        const timeoutMs = opts?.timeoutMs ?? 30_000;

        const start = Date.now();
        const result = await dockerExec(cmd, timeoutMs);

        return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: Date.now() - start,
        };
    }

    async readFile(sandboxId: string, path: string): Promise<string> {
        const result = await dockerExec(`docker exec ${sandboxId} cat ${path}`);
        if (result.exitCode !== 0) {
            throw new Error(`File not found: ${path}`);
        }
        return result.stdout;
    }

    async writeFile(sandboxId: string, path: string, content: string): Promise<void> {
        // Use docker exec with echo to write file
        const escaped = content.replace(/'/g, "'\\''");
        const result = await dockerExec(
            `docker exec ${sandboxId} sh -c 'mkdir -p "$(dirname ${path})" && printf "%s" '\\''${escaped}'\\'' > ${path}'`,
        );
        if (result.exitCode !== 0) {
            throw new Error(`Write failed: ${result.stderr}`);
        }
    }

    async listSandboxes(): Promise<readonly SandboxInfo[]> {
        return [...this.containers.values()];
    }
}
