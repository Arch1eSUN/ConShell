/**
 * SkillLoader — Scans a directory for skills, parses SKILL.md frontmatter,
 * and optionally loads handler.ts for code-based tools.
 */
import { readdir, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SkillManifest, SkillTrigger, SkillToolRef, LoadedSkill } from './types.js';

export interface SkillLoaderOptions {
    /** Root directory to scan for skills. */
    readonly skillsDir: string;
    /** Additional directories to scan for skills (e.g., shared skill paths). */
    readonly additionalPaths?: readonly string[];
    /** Logger for diagnostics (matches @conshell/core Logger). */
    readonly logger?: {
        info: (message: string, data?: Record<string, unknown>) => void;
        warn: (message: string, data?: Record<string, unknown>) => void;
    };
}

/**
 * Parse SKILL.md frontmatter (YAML between --- delimiters) and return a SkillManifest.
 */
export function parseSkillMd(content: string, skillMdPath: string): SkillManifest {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch?.[1]) {
        throw new Error(`Invalid SKILL.md: no YAML frontmatter found in ${skillMdPath}`);
    }

    const fm = parseYaml(fmMatch[1]) as Record<string, unknown>;

    const name = (fm['name'] as string) ?? 'unknown';
    const description = (fm['description'] as string) ?? '';
    const capabilities = (fm['capabilities'] as string[]) ?? [];
    const rawTools = (fm['tools'] as Array<{ name: string; description: string }>) ?? [];
    const rawTriggers = (fm['triggers'] as Array<Record<string, string>>) ?? [];

    const tools: SkillToolRef[] = rawTools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
    }));

    const triggers: SkillTrigger[] = rawTriggers.map((t) => ({
        heartbeat: t['heartbeat'],
        event: t['event'],
    }));

    return {
        name,
        description,
        capabilities: capabilities as SkillManifest['capabilities'],
        tools,
        triggers,
        skillMdPath,
    };
}

/**
 * Scan skills directory and load all discovered skills.
 */
export async function loadAllSkills(options: SkillLoaderOptions): Promise<LoadedSkill[]> {
    const { skillsDir, additionalPaths = [], logger } = options;
    const skills: LoadedSkill[] = [];
    const seenNames = new Set<string>();

    // Scan a single directory for skills
    async function scanDir(dir: string): Promise<void> {
        let entries: string[];
        try {
            entries = await readdir(dir);
        } catch {
            logger?.warn(`Skills directory not found or unreadable: ${dir}`);
            return;
        }

        for (const entry of entries) {
            const skillDir = resolve(dir, entry);
            const skillMdPath = join(skillDir, 'SKILL.md');
            const handlerPath = join(skillDir, 'handler.ts');

            try {
                await access(skillMdPath);
            } catch {
                continue; // Not a skill directory
            }

            try {
                const content = await readFile(skillMdPath, 'utf-8');
                const manifest = parseSkillMd(content, skillMdPath);

                // Deduplicate by name (first loaded wins)
                if (seenNames.has(manifest.name)) {
                    logger?.info(`Skipping duplicate skill: ${manifest.name} from ${dir}`);
                    continue;
                }
                seenNames.add(manifest.name);

                // Check for handler.ts
                let hasHandler = false;
                try {
                    await access(handlerPath);
                    hasHandler = true;
                } catch {
                    // No handler — pure markdown skill
                }

                const finalManifest: SkillManifest = {
                    ...manifest,
                    handlerPath: hasHandler ? handlerPath : undefined,
                };

                skills.push({
                    manifest: finalManifest,
                    enabled: true,
                });

                logger?.info(`Loaded skill: ${manifest.name}`, {
                    source: dir,
                    capabilities: manifest.capabilities,
                    tools: manifest.tools.length,
                    triggers: manifest.triggers.length,
                    hasHandler,
                });
            } catch (err) {
                logger?.warn(`Failed to load skill from ${skillDir}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    // Scan primary directory first
    await scanDir(skillsDir);

    // Scan additional shared directories
    for (const additionalPath of additionalPaths) {
        await scanDir(additionalPath);
    }

    logger?.info(`Total skills loaded: ${skills.length}`, {
        primaryDir: skillsDir,
        additionalDirs: additionalPaths.length,
    });

    return skills;
}
