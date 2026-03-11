/**
 * PolicyEngine — First-deny-wins rule evaluator.
 *
 * Evaluates all registered rules in priority order (ascending).
 * First deny stops evaluation. Every decision is persisted to the audit trail.
 */
import type {
    PolicyRule,
    PolicyEvaluationRequest,
    PolicyDecision,
    ToolMetadata,
    Logger,
} from '@conshell/core';
import type { PolicyDecisionsRepository } from '@conshell/state';

export class PolicyEngine {
    private readonly rules: PolicyRule[];

    constructor(
        rules: readonly PolicyRule[],
        private readonly decisions: PolicyDecisionsRepository,
        private readonly toolMetaLookup: (name: string) => ToolMetadata | undefined,
        private readonly logger: Logger,
    ) {
        // Sort by priority ascending (lower = higher priority)
        this.rules = [...rules].sort((a, b) => a.priority - b.priority);
        this.logger.info('PolicyEngine initialized', { ruleCount: this.rules.length });
    }

    /**
     * Evaluate a tool invocation request against all rules.
     * Returns the decision (always persisted).
     */
    evaluate(request: PolicyEvaluationRequest): PolicyDecision {
        const toolMeta = this.toolMetaLookup(request.toolName);
        if (!toolMeta) {
            const decision: PolicyDecision = {
                allowed: false,
                rule: 'unknown_tool',
                reason: `Tool "${request.toolName}" is not registered`,
                ruleCategory: 'engine',
            };
            this.persistDecision(request, decision);
            return decision;
        }

        for (const rule of this.rules) {
            try {
                const result = rule.evaluate(request, toolMeta);
                if (result !== null && !result.allowed) {
                    // First deny wins
                    this.logger.warn('Policy DENIED', {
                        tool: request.toolName,
                        rule: rule.name,
                        category: rule.category,
                        reason: result.reason,
                    });
                    this.persistDecision(request, result);
                    return result;
                }
            } catch (err) {
                // Rule evaluation failure = deny (safe fallback)
                const decision: PolicyDecision = {
                    allowed: false,
                    rule: rule.name,
                    reason: `Rule evaluation error: ${err instanceof Error ? err.message : String(err)}`,
                    ruleCategory: rule.category,
                };
                this.logger.error('Policy rule evaluation error', {
                    tool: request.toolName,
                    rule: rule.name,
                    error: err,
                });
                this.persistDecision(request, decision);
                return decision;
            }
        }

        // No rule denied → allowed
        const decision: PolicyDecision = { allowed: true };
        this.persistDecision(request, decision);
        return decision;
    }

    private persistDecision(request: PolicyEvaluationRequest, decision: PolicyDecision): void {
        try {
            this.decisions.insert({
                toolName: request.toolName,
                toolArgsRedacted: this.redactArgs(request.toolArgs),
                source: request.source,
                allowed: decision.allowed,
                ruleCategory: decision.ruleCategory,
                ruleName: decision.rule,
                reason: decision.reason,
            });
        } catch (err) {
            // Audit persistence failure is logged but does not affect decision
            this.logger.error('Failed to persist policy decision', { error: err });
        }
    }

    private redactArgs(args: Record<string, unknown>): string {
        const redacted: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
            if (this.isSensitiveKey(key)) {
                redacted[key] = '[REDACTED]';
            } else if (typeof value === 'string' && value.length > 256) {
                redacted[key] = value.slice(0, 256) + '...[TRUNCATED]';
            } else {
                redacted[key] = value;
            }
        }
        return JSON.stringify(redacted);
    }

    private isSensitiveKey(key: string): boolean {
        const lower = key.toLowerCase();
        return (
            lower.includes('password') ||
            lower.includes('secret') ||
            lower.includes('key') ||
            lower.includes('token') ||
            lower.includes('content')
        );
    }
}
