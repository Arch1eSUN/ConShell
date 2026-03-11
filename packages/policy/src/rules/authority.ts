/**
 * Category 1: Authority Rules (priority 100–199)
 *
 * Enforce trust hierarchy: creator > self > peer > external.
 * Forbidden-risk tools are blocked unconditionally.
 */
import type { PolicyRule, PolicyEvaluationRequest, PolicyDecision, ToolMetadata } from '@conshell/core';

function deny(rule: string, category: string, reason: string): PolicyDecision {
    return { allowed: false, rule, reason, ruleCategory: category };
}

const CATEGORY = 'authority';

export const denyForbiddenTools: PolicyRule = {
    name: 'deny_forbidden_tools',
    category: CATEGORY,
    priority: 100,
    evaluate(_req: PolicyEvaluationRequest, tool: ToolMetadata): PolicyDecision | null {
        if (tool.riskLevel === 'forbidden') {
            return deny(this.name, CATEGORY, `Tool "${tool.name}" is forbidden and can never be executed`);
        }
        return null;
    },
};

export const denyDangerousFromExternal: PolicyRule = {
    name: 'deny_dangerous_from_external',
    category: CATEGORY,
    priority: 110,
    evaluate(req: PolicyEvaluationRequest, tool: ToolMetadata): PolicyDecision | null {
        if (tool.riskLevel === 'dangerous' && req.source === 'external') {
            return deny(this.name, CATEGORY, `Dangerous tool "${tool.name}" cannot be invoked by external sources`);
        }
        return null;
    },
};

export const denyDangerousFromPeer: PolicyRule = {
    name: 'deny_dangerous_from_peer',
    category: CATEGORY,
    priority: 120,
    evaluate(req: PolicyEvaluationRequest, tool: ToolMetadata): PolicyDecision | null {
        if (tool.riskLevel === 'dangerous' && req.source === 'peer') {
            return deny(this.name, CATEGORY, `Dangerous tool "${tool.name}" cannot be invoked by peers`);
        }
        return null;
    },
};

export const denyCautionFromPeer: PolicyRule = {
    name: 'deny_caution_from_peer',
    category: CATEGORY,
    priority: 130,
    evaluate(req: PolicyEvaluationRequest, tool: ToolMetadata): PolicyDecision | null {
        if (tool.riskLevel === 'caution' && req.source === 'peer') {
            return deny(this.name, CATEGORY, `Caution-level tool "${tool.name}" cannot be invoked by peers`);
        }
        return null;
    },
};

export const denyCautionFromExternal: PolicyRule = {
    name: 'deny_caution_from_external',
    category: CATEGORY,
    priority: 140,
    evaluate(req: PolicyEvaluationRequest, tool: ToolMetadata): PolicyDecision | null {
        if (tool.riskLevel === 'caution' && req.source === 'external') {
            // Allowed if tool is in the MCP caution tools allowlist
            if (tool.mcpExposed) return null;
            return deny(this.name, CATEGORY, `Caution-level tool "${tool.name}" denied for external source (not in allowlist)`);
        }
        return null;
    },
};

export const authorityRules: readonly PolicyRule[] = [
    denyForbiddenTools,
    denyDangerousFromExternal,
    denyDangerousFromPeer,
    denyCautionFromPeer,
    denyCautionFromExternal,
];
