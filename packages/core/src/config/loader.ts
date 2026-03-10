/**
 * Config loader — reads, validates, and deep-merges automaton.json.
 *
 * If the file doesn't exist, throws ConfigNotFoundError (which triggers setup wizard).
 * If validation fails, throws ConfigValidationError with all issues.
 * Config is immutable after load — reload requires restart.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { AGENT_HOME_DIR, CONFIG_FILENAME } from '../constants.js';
import { ConfigNotFoundError, ConfigValidationError } from '../errors/base.js';
import { type AutomatonConfig, automatonConfigSchema } from '../types/config.js';

/**
 * Resolve the agent home directory path.
 * Default: ~/.web4-agent/
 */
export function resolveAgentHome(overridePath?: string): string {
    return overridePath ?? join(homedir(), AGENT_HOME_DIR);
}

/**
 * Resolve the config file path.
 */
export function resolveConfigPath(agentHome: string): string {
    return join(agentHome, CONFIG_FILENAME);
}

/**
 * Load and validate the configuration.
 * Deep-merges user config with defaults via Zod's .default() chains.
 *
 * @param agentHome - Agent home directory (default: ~/.web4-agent/)
 * @returns Validated, frozen configuration object
 * @throws ConfigNotFoundError if config file doesn't exist
 * @throws ConfigValidationError if config is invalid
 */
export function loadConfig(agentHome?: string): AutomatonConfig {
    const home = resolveAgentHome(agentHome);
    const configPath = resolveConfigPath(home);

    if (!existsSync(configPath)) {
        throw new ConfigNotFoundError(configPath);
    }

    let rawJson: unknown;
    try {
        const content = readFileSync(configPath, 'utf-8');
        rawJson = JSON.parse(content);
    } catch (err) {
        throw new ConfigValidationError([
            `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        ]);
    }

    const result = automatonConfigSchema.safeParse(rawJson);

    if (!result.success) {
        const errors = result.error.issues.map(
            (issue) => `${issue.path.join('.')}: ${issue.message}`,
        );
        throw new ConfigValidationError(errors);
    }

    // Freeze deeply to enforce immutability after load
    return deepFreeze(result.data as unknown) as AutomatonConfig;
}

/**
 * Validate configuration input without loading from disk.
 * Useful for setup wizard and testing.
 */
export function validateConfig(input: unknown): AutomatonConfig {
    const result = automatonConfigSchema.safeParse(input);

    if (!result.success) {
        const errors = result.error.issues.map(
            (issue) => `${issue.path.join('.')}: ${issue.message}`,
        );
        throw new ConfigValidationError(errors);
    }

    return deepFreeze(result.data as unknown) as AutomatonConfig;
}

/**
 * Deep-freeze an object recursively.
 */
function deepFreeze<T>(obj: T): T {
    if (obj === null || obj === undefined || typeof obj !== 'object') {
        return obj;
    }

    Object.freeze(obj);

    for (const value of Object.values(obj as Record<string, unknown>)) {
        if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    }

    return obj;
}
