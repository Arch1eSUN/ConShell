/**
 * ComputeProvider — abstraction for execution sandboxes.
 *
 * ADR-001: Docker as primary, local fallback for dev/tests.
 */


export interface ExecResult {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
    readonly durationMs: number;
}

export interface SandboxInfo {
    readonly id: string;
    readonly status: 'running' | 'stopped' | 'creating' | 'error';
    readonly createdAt: string;
}

export interface ComputeProvider {
    /** Create a new sandbox / container. Returns sandbox ID. */
    createSandbox(config: SandboxConfig): Promise<string>;
    /** Destroy a sandbox. */
    destroySandbox(sandboxId: string): Promise<void>;
    /** Get sandbox info. */
    getSandbox(sandboxId: string): Promise<SandboxInfo | undefined>;
    /** Execute a command inside a sandbox. */
    exec(sandboxId: string, command: string[], opts?: ExecOpts): Promise<ExecResult>;
    /** Read a file from sandbox. */
    readFile(sandboxId: string, path: string): Promise<string>;
    /** Write a file into sandbox. */
    writeFile(sandboxId: string, path: string, content: string): Promise<void>;
    /** List running sandboxes. */
    listSandboxes(): Promise<readonly SandboxInfo[]>;
}

export interface SandboxConfig {
    readonly name?: string;
    readonly image?: string;
    readonly memoryMb?: number;
    readonly cpuShares?: number;
    readonly workDir?: string;
    readonly env?: Record<string, string>;
}

export interface ExecOpts {
    readonly timeoutMs?: number;
    readonly cwd?: string;
    readonly stdin?: string;
}
