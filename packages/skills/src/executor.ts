/**
 * SkillExecutor — Dynamically imports handler.ts from skills and registers tools.
 *
 * Handles the bridge between SKILL.md manifests and the runtime ToolExecutor.
 */
import { pathToFileURL } from 'node:url';
import type { ToolDefinition } from '@web4-agent/core';
import type { SkillRegistry } from './registry.js';

export interface SkillExecutorDeps {
    readonly registry: SkillRegistry;
    readonly logger?: {
        info: (message: string, data?: Record<string, unknown>) => void;
        warn: (message: string, data?: Record<string, unknown>) => void;
    };
}

export interface SkillHandlerExports {
    readonly definitions?: readonly ToolDefinition[];
    readonly handlers?: ReadonlyMap<string, (args: Record<string, unknown>) => Promise<string>>;
}

/**
 * Load handler.ts for all skills that have one, returning tool definitions + handlers.
 */
export async function loadSkillHandlers(
    deps: SkillExecutorDeps,
): Promise<{
    definitions: ToolDefinition[];
    handlers: Map<string, (args: Record<string, unknown>) => Promise<string>>;
}> {
    const { registry, logger } = deps;
    const allDefs: ToolDefinition[] = [];
    const allHandlers = new Map<string, (args: Record<string, unknown>) => Promise<string>>();

    for (const skill of registry.getAll()) {
        if (!skill.enabled || !skill.manifest.handlerPath) continue;

        try {
            const handlerUrl = pathToFileURL(skill.manifest.handlerPath).href;
            const mod = (await import(handlerUrl)) as SkillHandlerExports;

            if (mod.definitions) {
                for (const def of mod.definitions) {
                    // Inject requiredCapabilities from manifest if not set
                    const enriched: ToolDefinition = {
                        ...def,
                        requiredCapabilities: def.requiredCapabilities ??
                            (skill.manifest.capabilities as ToolDefinition['requiredCapabilities']),
                    };
                    allDefs.push(enriched);
                }
            }

            if (mod.handlers) {
                for (const [name, handler] of mod.handlers) {
                    allHandlers.set(name, handler);
                }
            }

            // Update the loaded skill in registry with resolved definitions/handlers
            registry.updateLoadedSkill(skill.manifest.name, {
                toolDefinitions: mod.definitions ?? [],
                toolHandlers: mod.handlers ?? new Map(),
            });

            logger?.info(`Skill handler loaded: ${skill.manifest.name}`, {
                defs: mod.definitions?.length ?? 0,
                handlers: mod.handlers?.size ?? 0,
            });
        } catch (err) {
            logger?.warn(`Failed to load handler for skill "${skill.manifest.name}"`, {
                error: err instanceof Error ? err.message : String(err),
                path: skill.manifest.handlerPath,
            });
        }
    }

    return { definitions: allDefs, handlers: allHandlers };
}

/**
 * Register heartbeat triggers from enabled skills.
 */
export function getSkillHeartbeatTriggers(
    registry: SkillRegistry,
): Array<{ skillName: string; cron: string }> {
    const triggers: Array<{ skillName: string; cron: string }> = [];
    for (const skill of registry.getSkillsWithHeartbeatTriggers()) {
        for (const trigger of skill.manifest.triggers) {
            if (trigger.heartbeat) {
                triggers.push({ skillName: skill.manifest.name, cron: trigger.heartbeat });
            }
        }
    }
    return triggers;
}
