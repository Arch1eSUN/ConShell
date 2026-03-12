/**
 * System Prompt Builder — Multi-layered context assembly with token budgeting.
 *
 * Layers (priority order):
 * 1. Core Identity (soul, genesis prompt)
 * 2. State Context (survival tier, agent state, capabilities)
 * 3. Memory Context (5-tier retrieval, budget-constrained)
 * 4. Skills Context (active skills/procedures)
 * 5. Social Context (known agents, children, inbox)
 * 6. Tool Descriptions (available tool list)
 *
 * Conway equivalent: system_prompt_builder + context_assembly
 */
import type { AgentState, SurvivalTier } from '@conshell/core';
/** Re-exported from @conshell/memory for type compatibility */
export interface MemoryBlock {
    tier: string;
    entries: readonly { id: number; tier: string; label: string; content: string }[];
    tokenEstimate: number;
}

// ── Types ──────────────────────────────────────────────────────────────

export interface PromptLayer {
    readonly name: string;
    readonly priority: number; // lower = higher priority
    readonly content: string;
    readonly tokenEstimate: number;
}

export interface PromptBuildConfig {
    /** Maximum total tokens for the system prompt. */
    maxTokens: number;
    /** Agent name. */
    agentName: string;
    /** Genesis prompt / base identity. */
    genesisPrompt: string;
    /** Current soul content (SOUL.md). */
    soulContent?: string;
    /** Current agent state. */
    agentState: AgentState;
    /** Current survival tier. */
    survivalTier: SurvivalTier;
    /** Whether agent has financial capabilities. */
    hasFinancialOps: boolean;
    /** Balance in USDC. */
    balanceUSDC?: number;
    /** Available tool names. */
    tools: readonly string[];
    /** Memory blocks from MemoryTierManager. */
    memoryBlocks?: readonly MemoryBlock[];
    /** Active skills. */
    skills?: readonly { name: string; description: string }[];
    /** Known agents. */
    knownAgents?: readonly { name: string; address: string; trust: number }[];
    /** Children. */
    children?: readonly { name: string; state: string }[];
    /** Pending inbox messages count. */
    pendingMessages?: number;
    /** Custom layers to inject. */
    customLayers?: readonly PromptLayer[];
}

export interface BuiltPrompt {
    readonly systemPrompt: string;
    readonly layers: readonly PromptLayer[];
    readonly totalTokens: number;
    readonly truncated: boolean;
}

// ── Token estimation ───────────────────────────────────────────────────

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// ── Prompt Builder ─────────────────────────────────────────────────────

export class SystemPromptBuilder {
    /**
     * Build a complete system prompt, respecting token budget.
     */
    build(config: PromptBuildConfig): BuiltPrompt {
        const layers: PromptLayer[] = [];

        // 1. Core Identity (always included)
        layers.push(this.buildIdentityLayer(config));

        // 2. State Context
        layers.push(this.buildStateLayer(config));

        // 3. Memory Context
        if (config.memoryBlocks?.length) {
            layers.push(this.buildMemoryLayer(config.memoryBlocks));
        }

        // 4. Skills Context
        if (config.skills?.length) {
            layers.push(this.buildSkillsLayer(config.skills));
        }

        // 5. Social Context
        if (config.knownAgents?.length || config.children?.length || config.pendingMessages) {
            layers.push(this.buildSocialLayer(config));
        }

        // 6. Tool Descriptions
        if (config.tools.length > 0) {
            layers.push(this.buildToolsLayer(config.tools));
        }

        // 7. Custom layers
        if (config.customLayers) {
            layers.push(...config.customLayers);
        }

        // Sort by priority (lower = higher priority)
        layers.sort((a, b) => a.priority - b.priority);

        // Budget allocation: include layers until budget exhausted
        const selected: PromptLayer[] = [];
        let totalTokens = 0;
        let truncated = false;

        for (const layer of layers) {
            if (totalTokens + layer.tokenEstimate <= config.maxTokens) {
                selected.push(layer);
                totalTokens += layer.tokenEstimate;
            } else {
                truncated = true;
            }
        }

        const systemPrompt = selected.map(l => l.content).join('\n\n');

        return { systemPrompt, layers: selected, totalTokens, truncated };
    }

    // ── Layer builders ──────────────────────────────────────────────────

    private buildIdentityLayer(config: PromptBuildConfig): PromptLayer {
        const parts = [
            `You are ${config.agentName}, a sovereign AI agent.`,
        ];

        if (config.soulContent) {
            parts.push('<soul>', config.soulContent, '</soul>');
        } else if (config.genesisPrompt) {
            parts.push('<genesis>', config.genesisPrompt, '</genesis>');
        }

        const content = parts.join('\n');
        return { name: 'identity', priority: 0, content, tokenEstimate: estimateTokens(content) };
    }

    private buildStateLayer(config: PromptBuildConfig): PromptLayer {
        const lines = [
            '<state>',
            `Current state: ${config.agentState}`,
            `Survival tier: ${config.survivalTier}`,
        ];

        if (config.hasFinancialOps) {
            lines.push(`Balance: ${config.balanceUSDC?.toFixed(2) ?? '0.00'} USDC`);
        }

        // State-dependent behavioral directives
        switch (config.survivalTier) {
            case 'emergency':
                lines.push('⚠️ EMERGENCY MODE: Minimize all non-essential operations. Focus on survival.');
                break;
            case 'critical':
                lines.push('⚠️ CRITICAL: Conserve resources. Reduce tool usage. Defer non-urgent tasks.');
                break;
            case 'low':
                lines.push('Low resources. Be efficient and avoid speculative operations.');
                break;
        }

        lines.push('</state>');
        const content = lines.join('\n');
        return { name: 'state', priority: 1, content, tokenEstimate: estimateTokens(content) };
    }

    private buildMemoryLayer(blocks: readonly MemoryBlock[]): PromptLayer {
        const lines = ['<memory>'];
        for (const block of blocks) {
            lines.push(`## ${block.tier.toUpperCase()} MEMORY (${block.entries.length} entries, ~${block.tokenEstimate} tokens)`);
            for (const entry of block.entries) {
                lines.push(`- [${entry.label}] ${entry.content}`);
            }
        }
        lines.push('</memory>');
        const content = lines.join('\n');
        return { name: 'memory', priority: 2, content, tokenEstimate: estimateTokens(content) };
    }

    private buildSkillsLayer(skills: readonly { name: string; description: string }[]): PromptLayer {
        const lines = ['<skills>'];
        for (const skill of skills) {
            lines.push(`- ${skill.name}: ${skill.description}`);
        }
        lines.push('</skills>');
        const content = lines.join('\n');
        return { name: 'skills', priority: 3, content, tokenEstimate: estimateTokens(content) };
    }

    private buildSocialLayer(config: PromptBuildConfig): PromptLayer {
        const lines = ['<social>'];

        if (config.children?.length) {
            lines.push(`Children: ${config.children.map(c => `${c.name}(${c.state})`).join(', ')}`);
        }

        if (config.knownAgents?.length) {
            const top = config.knownAgents.slice(0, 10);
            lines.push(`Known agents: ${top.map(a => `${a.name}(trust:${a.trust})`).join(', ')}`);
        }

        if (config.pendingMessages && config.pendingMessages > 0) {
            lines.push(`📨 ${config.pendingMessages} unread message(s) pending.`);
        }

        lines.push('</social>');
        const content = lines.join('\n');
        return { name: 'social', priority: 4, content, tokenEstimate: estimateTokens(content) };
    }

    private buildToolsLayer(tools: readonly string[]): PromptLayer {
        const content = `<available_tools>\n${tools.join(', ')}\n</available_tools>`;
        return { name: 'tools', priority: 5, content, tokenEstimate: estimateTokens(content) };
    }
}
