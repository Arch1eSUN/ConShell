/**
 * Model Mapping — maps external model names to internal ConShell model IDs.
 *
 * Supports:
 * 1. CLIProxyAPI-style model names (gpt-4o, claude-sonnet-4, gemini-2.5-flash, etc.)
 * 2. Direct model IDs (ollama:llama3.2, etc.)
 * 3. Alias resolution (e.g., "gpt-4" → latest GPT-4 variant)
 * 4. Dynamic additions at runtime
 */

// ── Static Model Alias Map ────────────────────────────────────────────

const DEFAULT_ALIASES: Record<string, string> = {
    // OpenAI
    'gpt-4o': 'openai:gpt-4o',
    'gpt-4o-mini': 'openai:gpt-4o-mini',
    'gpt-4-turbo': 'openai:gpt-4-turbo',
    'gpt-4': 'openai:gpt-4',
    'gpt-3.5-turbo': 'openai:gpt-3.5-turbo',
    'o1': 'openai:o1',
    'o1-mini': 'openai:o1-mini',
    'o1-preview': 'openai:o1-preview',
    'o3': 'openai:o3',
    'o3-mini': 'openai:o3-mini',

    // Anthropic
    'claude-opus-4': 'anthropic:claude-opus-4',
    'claude-sonnet-4': 'anthropic:claude-sonnet-4',
    'claude-3.5-sonnet': 'anthropic:claude-3.5-sonnet',
    'claude-3-haiku': 'anthropic:claude-3-haiku',

    // Google
    'gemini-2.5-pro': 'gemini:gemini-2.5-pro',
    'gemini-2.5-flash': 'gemini:gemini-2.5-flash',
    'gemini-2.0-flash': 'gemini:gemini-2.0-flash',
    'gemini-pro': 'gemini:gemini-pro',

    // Ollama (local)
    'llama3.2': 'ollama:llama3.2',
    'llama3.1': 'ollama:llama3.1',
    'codellama': 'ollama:codellama',
    'mixtral': 'ollama:mixtral',
    'mistral': 'ollama:mistral',
    'qwen2.5': 'ollama:qwen2.5',
    'deepseek-r1': 'ollama:deepseek-r1',

    // GLM (Z.ai)
    'glm-4.7': 'cliproxyapi:glm-4.7',
    'glm-5': 'cliproxyapi:glm-5',
};

// ── Model Mapper Class ────────────────────────────────────────────────

export class ModelMapper {
    private aliases: Map<string, string>;

    constructor(customAliases?: Record<string, string>) {
        this.aliases = new Map(Object.entries(DEFAULT_ALIASES));
        if (customAliases) {
            for (const [alias, target] of Object.entries(customAliases)) {
                this.aliases.set(alias.toLowerCase(), target);
            }
        }
    }

    /**
     * Resolve an external model name to internal model ID.
     * Returns the input unchanged if no mapping exists (passthrough).
     */
    resolve(externalModel: string): string {
        const lower = externalModel.toLowerCase();

        // 1. Direct alias match
        const alias = this.aliases.get(lower);
        if (alias) return alias;

        // 2. Already in provider:model format → passthrough
        if (externalModel.includes(':')) return externalModel;

        // 3. No match → passthrough, let the router decide
        return externalModel;
    }

    /**
     * Add or override a model alias at runtime.
     */
    addAlias(externalName: string, internalId: string): void {
        this.aliases.set(externalName.toLowerCase(), internalId);
    }

    /**
     * Remove a model alias.
     */
    removeAlias(externalName: string): void {
        this.aliases.delete(externalName.toLowerCase());
    }

    /**
     * Get all registered aliases as a plain object.
     */
    getAllAliases(): Record<string, string> {
        return Object.fromEntries(this.aliases);
    }

    /**
     * List all available external model names.
     */
    listExternalModels(): string[] {
        return Array.from(this.aliases.keys()).sort();
    }
}
