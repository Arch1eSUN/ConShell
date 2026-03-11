/**
 * Category 5: Rate Limit Rules (priority 500–599)
 *
 * Per-turn tool limits, per-session dangerous op limits, per-hour exec limits.
 */
import type { PolicyRule, PolicyEvaluationRequest, PolicyDecision, ToolMetadata } from '@conshell/core';
import {
    DEFAULT_MAX_TOOL_CALLS_PER_TURN,
    DEFAULT_MAX_DANGEROUS_PER_SESSION,
    DEFAULT_MAX_EXEC_PER_HOUR,
} from '@conshell/core';

function deny(rule: string, reason: string): PolicyDecision {
    return { allowed: false, rule, reason, ruleCategory: 'rate_limit' };
}

export interface RateLimitDeps {
    /** Number of tool calls in the current turn */
    toolCallsThisTurn(): number;
    /** Number of dangerous tool calls in the current session */
    dangerousCallsThisSession(): number;
    /** Number of exec calls in the current hour */
    execCallsThisHour(): number;
}

export function createRateLimitRules(deps: RateLimitDeps): readonly PolicyRule[] {
    const denyPerTurnToolLimit: PolicyRule = {
        name: 'deny_per_turn_tool_limit',
        category: 'rate_limit',
        priority: 500,
        evaluate(_req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
            const count = deps.toolCallsThisTurn();
            if (count >= DEFAULT_MAX_TOOL_CALLS_PER_TURN) {
                return deny(this.name, `Tool calls per turn limit exceeded: ${count}/${DEFAULT_MAX_TOOL_CALLS_PER_TURN}`);
            }
            return null;
        },
    };

    const denyPerSessionExpensiveOps: PolicyRule = {
        name: 'deny_per_session_expensive_ops',
        category: 'rate_limit',
        priority: 510,
        evaluate(_req: PolicyEvaluationRequest, tool: ToolMetadata): PolicyDecision | null {
            if (tool.riskLevel !== 'dangerous') return null;
            const count = deps.dangerousCallsThisSession();
            if (count >= DEFAULT_MAX_DANGEROUS_PER_SESSION) {
                return deny(this.name, `Dangerous operations per session limit exceeded: ${count}/${DEFAULT_MAX_DANGEROUS_PER_SESSION}`);
            }
            return null;
        },
    };

    const denyPerHourExecLimit: PolicyRule = {
        name: 'deny_per_hour_exec_limit',
        category: 'rate_limit',
        priority: 520,
        evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
            if (req.toolName !== 'exec') return null;
            const count = deps.execCallsThisHour();
            if (count >= DEFAULT_MAX_EXEC_PER_HOUR) {
                return deny(this.name, `Exec calls per hour limit exceeded: ${count}/${DEFAULT_MAX_EXEC_PER_HOUR}`);
            }
            return null;
        },
    };

    return [denyPerTurnToolLimit, denyPerSessionExpensiveOps, denyPerHourExecLimit];
}
