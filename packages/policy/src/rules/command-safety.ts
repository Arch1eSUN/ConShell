/**
 * Category 2: Command Safety Rules (priority 200–299)
 *
 * Block forbidden shell patterns, self-harm commands, and rate-limit self-modifications.
 */
import type { PolicyRule, PolicyEvaluationRequest, PolicyDecision, ToolMetadata } from '@web4-agent/core';
import {
    FORBIDDEN_COMMAND_PATTERNS,
    DB_FILENAME,
    WALLET_FILENAME,
    DEFAULT_MAX_SELF_MOD_PER_HOUR,
} from '@web4-agent/core';

function deny(rule: string, reason: string): PolicyDecision {
    return { allowed: false, rule, reason, ruleCategory: 'command_safety' };
}

const SELF_MOD_TOOLS = new Set([
    'edit_own_file',
    'install_npm_package',
    'install_mcp_server',
    'pull_upstream',
    'create_skill',
]);

export interface CommandSafetyDeps {
    /** Count of self-mod tool calls in the current hour */
    selfModCountCurrentHour(): number;
}

export const denyForbiddenCommands: PolicyRule = {
    name: 'deny_forbidden_commands',
    category: 'command_safety',
    priority: 200,
    evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
        if (req.toolName !== 'exec') return null;
        const command = String(req.toolArgs['command'] ?? '');
        for (const pattern of FORBIDDEN_COMMAND_PATTERNS) {
            if (command.includes(pattern)) {
                return deny(this.name, `Command contains forbidden pattern: "${pattern}"`);
            }
        }
        return null;
    },
};

export const denySelfHarmCommands: PolicyRule = {
    name: 'deny_self_harm_commands',
    category: 'command_safety',
    priority: 210,
    evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
        if (req.toolName !== 'exec') return null;
        const command = String(req.toolArgs['command'] ?? '');
        // Block commands targeting critical agent files
        if (command.includes(DB_FILENAME) || command.includes(WALLET_FILENAME)) {
            return deny(this.name, 'Command targets critical agent files');
        }
        return null;
    },
};

export function createRateLimitSelfMod(deps: CommandSafetyDeps): PolicyRule {
    return {
        name: 'rate_limit_self_mod',
        category: 'command_safety',
        priority: 220,
        evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
            if (!SELF_MOD_TOOLS.has(req.toolName)) return null;
            const count = deps.selfModCountCurrentHour();
            if (count >= DEFAULT_MAX_SELF_MOD_PER_HOUR) {
                return deny(this.name, `Self-modification rate limit exceeded: ${count}/${DEFAULT_MAX_SELF_MOD_PER_HOUR} per hour`);
            }
            return null;
        },
    };
}

export const commandSafetyStaticRules: readonly PolicyRule[] = [
    denyForbiddenCommands,
    denySelfHarmCommands,
];
