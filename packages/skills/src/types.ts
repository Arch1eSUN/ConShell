/**
 * @conshell/skills — Skill type definitions.
 */
import type { CapabilityId, ToolDefinition } from '@conshell/core';

export interface SkillManifest {
    readonly name: string;
    readonly description: string;
    /** Capabilities required by this skill. */
    readonly capabilities: readonly CapabilityId[];
    /** Tool definitions if the skill has a handler. */
    readonly tools: readonly SkillToolRef[];
    /** Cron-like triggers for heartbeat integration. */
    readonly triggers: readonly SkillTrigger[];
    /** Path to SKILL.md source file. */
    readonly skillMdPath: string;
    /** Path to handler.ts (if exists). */
    readonly handlerPath?: string;
}

export interface SkillToolRef {
    readonly name: string;
    readonly description: string;
}

export interface SkillTrigger {
    /** Heartbeat cron expression. */
    readonly heartbeat?: string;
    /** Event name to trigger on. */
    readonly event?: string;
}

export interface LoadedSkill {
    readonly manifest: SkillManifest;
    readonly enabled: boolean;
    /** Dynamically loaded tool definitions from handler.ts. */
    readonly toolDefinitions?: readonly ToolDefinition[];
    /** Dynamically loaded tool handlers from handler.ts. */
    readonly toolHandlers?: ReadonlyMap<string, (args: Record<string, unknown>) => Promise<string>>;
}

export interface SkillInstallOptions {
    /** Local filesystem path to the skill directory. */
    readonly localPath?: string;
    /** Remote URL to download the skill from. */
    readonly remoteUrl?: string;
}
