/**
 * Plugin Sandbox — Isolated execution environment for third-party plugins.
 *
 * Design doc §L12: Each plugin runs in an isolated context with:
 *   - No access to other plugins' data
 *   - No direct access to host process internals
 *   - Resource limits (CPU time, memory, network)
 *   - Capability-based permissions
 *
 * Implementation uses Node.js `vm` module for lightweight isolation.
 * Full VM2 or Firecracker isolation is for Conway Cloud (future).
 */
import { createContext, runInContext, Script } from 'node:vm';
import { EventEmitter } from 'node:events';

// ── Types ──────────────────────────────────────────────────────────────

export interface PluginManifest {
    readonly name: string;
    readonly version: string;
    readonly author?: string;
    readonly permissions: readonly PluginPermission[];
    readonly entrypoint: string;
}

export type PluginPermission =
    | 'network:outbound'
    | 'fs:read'
    | 'fs:write'
    | 'memory:read'
    | 'memory:write'
    | 'tool:register'
    | 'tool:invoke'
    | 'event:subscribe'
    | 'event:emit';

export interface SandboxOptions {
    /** Max execution time in ms (default: 5000). */
    readonly timeoutMs?: number;
    /** Max memory in bytes (default: 64MB). */
    readonly maxMemoryBytes?: number;
    /** Allowed permissions for this plugin. */
    readonly permissions?: readonly PluginPermission[];
    /** APIs exposed to the plugin sandbox. */
    readonly exposedApis?: Record<string, unknown>;
}

export interface SandboxResult {
    readonly success: boolean;
    readonly output?: unknown;
    readonly error?: string;
    readonly executionTimeMs: number;
    readonly memoryUsedBytes?: number;
}

export type PluginState = 'loading' | 'ready' | 'running' | 'error' | 'stopped';

export interface PluginInfo {
    readonly name: string;
    readonly version: string;
    readonly state: PluginState;
    readonly permissions: readonly PluginPermission[];
    readonly loadedAt: string;
    readonly lastRunAt?: string;
    readonly errorCount: number;
}

// ── Sandbox ────────────────────────────────────────────────────────────

export class PluginSandbox extends EventEmitter {
    private readonly plugins = new Map<string, {
        manifest: PluginManifest;
        state: PluginState;
        permissions: Set<PluginPermission>;
        loadedAt: string;
        lastRunAt?: string;
        errorCount: number;
        code?: string;
    }>();

    private readonly defaultTimeout: number;
    private readonly defaultMaxMemory: number;

    constructor(options: { defaultTimeoutMs?: number; defaultMaxMemoryBytes?: number } = {}) {
        super();
        this.defaultTimeout = options.defaultTimeoutMs ?? 5000;
        this.defaultMaxMemory = options.defaultMaxMemoryBytes ?? 64 * 1024 * 1024;
    }

    /**
     * Register a plugin with its manifest and code.
     * Does NOT execute it yet — call `execute()` to run.
     */
    register(manifest: PluginManifest, code: string): void {
        if (this.plugins.has(manifest.name)) {
            throw new Error(`Plugin '${manifest.name}' is already registered`);
        }

        // Validate manifest
        if (!manifest.name || !manifest.version) {
            throw new Error('Plugin manifest must include name and version');
        }

        // Check for dangerous patterns in code
        const dangerousPatterns = [
            /process\.exit/,
            /require\s*\(\s*['"]child_process['"]\s*\)/,
            /require\s*\(\s*['"]cluster['"]\s*\)/,
            /global\s*\.\s*process/,
            /Reflect\.deleteProperty/,
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(code)) {
                throw new Error(
                    `Plugin '${manifest.name}' contains dangerous code pattern: ${pattern.source}`,
                );
            }
        }

        this.plugins.set(manifest.name, {
            manifest,
            state: 'ready',
            permissions: new Set(manifest.permissions),
            loadedAt: new Date().toISOString(),
            errorCount: 0,
            code,
        });

        this.emit('plugin:registered', manifest.name);
    }

    /**
     * Execute a plugin's code in an isolated sandbox.
     */
    execute(pluginName: string, options: SandboxOptions = {}): SandboxResult {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) {
            return {
                success: false,
                error: `Plugin '${pluginName}' not found`,
                executionTimeMs: 0,
            };
        }

        if (!plugin.code) {
            return {
                success: false,
                error: `Plugin '${pluginName}' has no code loaded`,
                executionTimeMs: 0,
            };
        }

        // Check permissions
        const requestedPerms = new Set(options.permissions ?? plugin.manifest.permissions);
        for (const perm of requestedPerms) {
            if (!plugin.permissions.has(perm)) {
                return {
                    success: false,
                    error: `Plugin '${pluginName}' lacks permission: ${perm}`,
                    executionTimeMs: 0,
                };
            }
        }

        plugin.state = 'running';
        const timeout = options.timeoutMs ?? this.defaultTimeout;
        const startTime = performance.now();

        try {
            // Build sandboxed context
            const sandbox = this.buildSandboxContext(pluginName, plugin.permissions, options.exposedApis);
            const context = createContext(sandbox, {
                name: `plugin:${pluginName}`,
            });

            // Execute in isolated context with timeout
            const script = new Script(plugin.code, {
                filename: `${pluginName}/index.js`,
            });

            const output = script.runInContext(context, {
                timeout,
                displayErrors: true,
            });

            const executionTimeMs = performance.now() - startTime;
            plugin.state = 'ready';
            plugin.lastRunAt = new Date().toISOString();

            this.emit('plugin:executed', pluginName, executionTimeMs);

            return {
                success: true,
                output,
                executionTimeMs,
            };
        } catch (err) {
            const executionTimeMs = performance.now() - startTime;
            plugin.state = 'error';
            plugin.errorCount++;
            plugin.lastRunAt = new Date().toISOString();

            const errorMessage = err instanceof Error ? err.message : String(err);
            this.emit('plugin:error', pluginName, errorMessage);

            return {
                success: false,
                error: errorMessage,
                executionTimeMs,
            };
        }
    }

    /**
     * Unregister a plugin by name.
     */
    unregister(pluginName: string): boolean {
        const existed = this.plugins.delete(pluginName);
        if (existed) {
            this.emit('plugin:unregistered', pluginName);
        }
        return existed;
    }

    /**
     * List all registered plugins.
     */
    list(): readonly PluginInfo[] {
        return Array.from(this.plugins.entries()).map(([, p]) => ({
            name: p.manifest.name,
            version: p.manifest.version,
            state: p.state,
            permissions: Array.from(p.permissions),
            loadedAt: p.loadedAt,
            lastRunAt: p.lastRunAt,
            errorCount: p.errorCount,
        }));
    }

    /**
     * Get info about a specific plugin.
     */
    getInfo(pluginName: string): PluginInfo | undefined {
        const p = this.plugins.get(pluginName);
        if (!p) return undefined;
        return {
            name: p.manifest.name,
            version: p.manifest.version,
            state: p.state,
            permissions: Array.from(p.permissions),
            loadedAt: p.loadedAt,
            lastRunAt: p.lastRunAt,
            errorCount: p.errorCount,
        };
    }

    /**
     * Validate a plugin manifest's permissions against an allow-list.
     */
    static validatePermissions(
        requested: readonly PluginPermission[],
        allowed: readonly PluginPermission[],
    ): { valid: boolean; denied: readonly PluginPermission[] } {
        const allowedSet = new Set(allowed);
        const denied = requested.filter(p => !allowedSet.has(p));
        return { valid: denied.length === 0, denied };
    }

    // ── Private helpers ─────────────────────────────────────────────────

    private buildSandboxContext(
        pluginName: string,
        permissions: Set<PluginPermission>,
        exposedApis?: Record<string, unknown>,
    ): Record<string, unknown> {
        const sandbox: Record<string, unknown> = {
            // Safe globals
            console: {
                log: (...args: unknown[]) => this.emit('plugin:log', pluginName, 'info', args),
                warn: (...args: unknown[]) => this.emit('plugin:log', pluginName, 'warn', args),
                error: (...args: unknown[]) => this.emit('plugin:log', pluginName, 'error', args),
            },
            setTimeout: undefined,
            setInterval: undefined,
            setImmediate: undefined,
            clearTimeout: undefined,
            clearInterval: undefined,
            clearImmediate: undefined,

            // Plugin metadata
            __pluginName__: pluginName,
            __permissions__: Array.from(permissions),

            // Utility
            JSON,
            Math,
            Date,
            String,
            Number,
            Boolean,
            Array,
            Object,
            Map,
            Set,
            RegExp,
            Error,
            TypeError,
            RangeError,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
            encodeURIComponent,
            decodeURIComponent,
        };

        // Merge exposed APIs (controlled by host)
        if (exposedApis) {
            for (const [key, value] of Object.entries(exposedApis)) {
                sandbox[key] = value;
            }
        }

        return sandbox;
    }
}
