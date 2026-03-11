/**
 * SkillRegistry — Tracks installed skills and their enabled/disabled state.
 */
import type { LoadedSkill, SkillManifest } from './types.js';

export class SkillRegistry {
    private readonly skills: Map<string, LoadedSkill> = new Map();

    /**
     * Register skills loaded by SkillLoader.
     */
    registerAll(skills: readonly LoadedSkill[]): void {
        for (const skill of skills) {
            this.skills.set(skill.manifest.name, skill);
        }
    }

    /**
     * Get all registered skills.
     */
    getAll(): readonly LoadedSkill[] {
        return [...this.skills.values()];
    }

    /**
     * Get a specific skill by name.
     */
    get(name: string): LoadedSkill | undefined {
        return this.skills.get(name);
    }

    /**
     * Enable or disable a skill.
     */
    setEnabled(name: string, enabled: boolean): boolean {
        const skill = this.skills.get(name);
        if (!skill) return false;

        // Create a new LoadedSkill with updated enabled state
        this.skills.set(name, { ...skill, enabled });
        return true;
    }

    /**
     * List skill manifests for API responses.
     */
    listManifests(): readonly (SkillManifest & { enabled: boolean })[] {
        return [...this.skills.values()].map((s) => ({
            ...s.manifest,
            enabled: s.enabled,
        }));
    }

    /**
     * Get all enabled skills that have the given trigger type.
     */
    getSkillsWithHeartbeatTriggers(): readonly LoadedSkill[] {
        return [...this.skills.values()].filter(
            (s) => s.enabled && s.manifest.triggers.some((t) => t.heartbeat),
        );
    }

    /**
     * Update a loaded skill with resolved tool definitions and handlers.
     */
    updateLoadedSkill(name: string, updates: {
        toolDefinitions?: readonly import('@conshell/core').ToolDefinition[];
        toolHandlers?: ReadonlyMap<string, (args: Record<string, unknown>) => Promise<string>>;
    }): void {
        const skill = this.skills.get(name);
        if (!skill) return;
        this.skills.set(name, { ...skill, ...updates });
    }

    /**
     * Number of registered skills.
     */
    get size(): number {
        return this.skills.size;
    }
}
