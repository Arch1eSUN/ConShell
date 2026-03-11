/**
 * Plugin System — lifecycle hooks + manifest validation + sandboxed execution.
 *
 * Plugin hooks: beforeToolCall, afterToolCall, onTurn, onWake, onSleep
 * Each plugin declares permissions via manifest (plugin.json).
 */

import { randomBytes } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────

export type PluginHook = 'beforeToolCall' | 'afterToolCall' | 'onTurn' | 'onWake' | 'onSleep';

export type PluginState = 'installed' | 'enabled' | 'disabled' | 'error';

export interface PluginPermission {
    readonly name: string;
    readonly description: string;
    readonly required: boolean;
}

export interface PluginManifest {
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly author?: string;
    readonly hooks: readonly PluginHook[];
    readonly permissions: readonly PluginPermission[];
    readonly entrypoint: string;
}

export interface PluginInstance {
    readonly id: string;
    readonly manifest: PluginManifest;
    state: PluginState;
    readonly installedAt: number;
    enabledAt?: number;
    lastError?: string;
}

export interface PluginHookContext {
    readonly hookName: PluginHook;
    readonly timestamp: number;
    readonly data?: Record<string, unknown>;
}

export interface ManifestValidation {
    readonly valid: boolean;
    readonly errors: string[];
}

export interface PluginManagerConfig {
    readonly maxPlugins?: number;
    readonly allowedHooks?: readonly PluginHook[];
}

// ── Defaults ───────────────────────────────────────────────────────────

const ALL_HOOKS: readonly PluginHook[] = ['beforeToolCall', 'afterToolCall', 'onTurn', 'onWake', 'onSleep'];

const DEFAULT_PM_CONFIG: Required<PluginManagerConfig> = {
    maxPlugins: 20,
    allowedHooks: ALL_HOOKS,
};

// ── Manifest Validation ────────────────────────────────────────────────

export function validateManifest(manifest: PluginManifest): ManifestValidation {
    const errors: string[] = [];

    if (!manifest.name || manifest.name.trim().length === 0) {
        errors.push('Plugin name is required');
    }
    if (!/^[a-z0-9-]+$/.test(manifest.name)) {
        errors.push('Plugin name must be lowercase alphanumeric with hyphens');
    }
    if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
        errors.push('Version must follow semver (e.g., 1.0.0)');
    }
    if (!manifest.description || manifest.description.trim().length === 0) {
        errors.push('Description is required');
    }
    if (!manifest.hooks || manifest.hooks.length === 0) {
        errors.push('At least one hook must be declared');
    }
    for (const hook of manifest.hooks) {
        if (!ALL_HOOKS.includes(hook)) {
            errors.push(`Unknown hook: ${hook}`);
        }
    }
    if (!manifest.entrypoint || manifest.entrypoint.trim().length === 0) {
        errors.push('Entrypoint is required');
    }

    return { valid: errors.length === 0, errors };
}

// ── PluginManager ──────────────────────────────────────────────────────

export class PluginManager {
    private readonly config: Required<PluginManagerConfig>;
    private readonly plugins = new Map<string, PluginInstance>();
    private readonly hookHandlers = new Map<PluginHook, Set<string>>(); // plugin IDs per hook

    constructor(config?: PluginManagerConfig) {
        this.config = { ...DEFAULT_PM_CONFIG, ...config };
        for (const hook of ALL_HOOKS) {
            this.hookHandlers.set(hook, new Set());
        }
    }

    /** Install a plugin from a manifest */
    install(manifest: PluginManifest): PluginInstance {
        // Validate
        const validation = validateManifest(manifest);
        if (!validation.valid) {
            throw new Error(`Invalid manifest: ${validation.errors.join(', ')}`);
        }

        // Limit
        if (this.plugins.size >= this.config.maxPlugins) {
            throw new Error(`Cannot install: max ${this.config.maxPlugins} plugins reached`);
        }

        // Duplicate check
        const existing = this.findByName(manifest.name);
        if (existing) {
            throw new Error(`Plugin "${manifest.name}" is already installed`);
        }

        // Check hook permissions
        for (const hook of manifest.hooks) {
            if (!this.config.allowedHooks.includes(hook)) {
                throw new Error(`Hook "${hook}" is not allowed by config`);
            }
        }

        const id = randomBytes(8).toString('hex');
        const plugin: PluginInstance = {
            id,
            manifest,
            state: 'installed',
            installedAt: Date.now(),
        };

        this.plugins.set(id, plugin);
        return plugin;
    }

    /** Enable a plugin — registers its hooks */
    enable(pluginId: string): void {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Unknown plugin: ${pluginId}`);
        if (plugin.state === 'enabled') return;

        plugin.state = 'enabled';
        plugin.enabledAt = Date.now();

        for (const hook of plugin.manifest.hooks) {
            this.hookHandlers.get(hook)?.add(pluginId);
        }
    }

    /** Disable a plugin — unregisters its hooks */
    disable(pluginId: string): void {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Unknown plugin: ${pluginId}`);

        plugin.state = 'disabled';
        for (const hook of plugin.manifest.hooks) {
            this.hookHandlers.get(hook)?.delete(pluginId);
        }
    }

    /** Uninstall a plugin completely */
    uninstall(pluginId: string): void {
        this.disable(pluginId);
        this.plugins.delete(pluginId);
    }

    /** Get plugins listening on a hook */
    getHookListeners(hook: PluginHook): readonly PluginInstance[] {
        const ids = this.hookHandlers.get(hook) ?? new Set();
        const results: PluginInstance[] = [];
        for (const id of ids) {
            const plugin = this.plugins.get(id);
            if (plugin && plugin.state === 'enabled') results.push(plugin);
        }
        return results;
    }

    /** Emit a hook to all listeners */
    emit(hook: PluginHook, data?: Record<string, unknown>): PluginHookContext[] {
        const listeners = this.getHookListeners(hook);
        const contexts: PluginHookContext[] = [];

        for (const _listener of listeners) {
            contexts.push({
                hookName: hook,
                timestamp: Date.now(),
                data,
            });
        }

        return contexts;
    }

    /** Find a plugin by name */
    findByName(name: string): PluginInstance | undefined {
        for (const plugin of this.plugins.values()) {
            if (plugin.manifest.name === name) return plugin;
        }
        return undefined;
    }

    /** Find by ID */
    find(pluginId: string): PluginInstance | undefined {
        return this.plugins.get(pluginId);
    }

    /** List all plugins */
    list(): readonly PluginInstance[] {
        return [...this.plugins.values()];
    }

    /** List enabled plugins */
    listEnabled(): readonly PluginInstance[] {
        return [...this.plugins.values()].filter(p => p.state === 'enabled');
    }

    /** Number of installed plugins */
    get size(): number {
        return this.plugins.size;
    }
}
