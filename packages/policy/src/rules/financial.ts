/**
 * Category 3: Financial Rules (priority 300–399)
 *
 * Enforce treasury policy: per-payment cap, hourly/daily transfer caps,
 * minimum reserve, x402 domain allowlist, inference budget.
 */
import type { PolicyRule, PolicyEvaluationRequest, PolicyDecision, ToolMetadata } from '@conshell/core';
import type { AutomatonConfig } from '@conshell/core';

function deny(rule: string, reason: string): PolicyDecision {
    return { allowed: false, rule, reason, ruleCategory: 'financial' };
}

export function createFinancialRules(config: AutomatonConfig): readonly PolicyRule[] {
    const tp = config.treasury;

    const denyExceedsPerPaymentCap: PolicyRule = {
        name: 'deny_exceeds_per_payment_cap',
        category: 'financial',
        priority: 300,
        evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
            const amount = Number(req.toolArgs['amount_cents'] ?? req.toolArgs['amountCents'] ?? 0);
            if (amount <= 0) return null;
            if (amount > tp.maxPaymentCents) {
                return deny(this.name, `Payment ${amount} cents exceeds cap of ${tp.maxPaymentCents} cents`);
            }
            return null;
        },
    };

    const denyExceedsHourlyTransferCap: PolicyRule = {
        name: 'deny_exceeds_hourly_transfer_cap',
        category: 'financial',
        priority: 310,
        evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
            if (!req.financialContext) return null;
            const amount = Number(req.toolArgs['amount_cents'] ?? req.toolArgs['amountCents'] ?? 0);
            if (amount <= 0) return null;
            const projected = req.financialContext.hourlyTransferCents + amount;
            if (projected > tp.hourlyTransferCapCents) {
                return deny(this.name, `Hourly transfer total would be ${projected} cents, exceeds cap of ${tp.hourlyTransferCapCents}`);
            }
            return null;
        },
    };

    const denyExceedsDailyTransferCap: PolicyRule = {
        name: 'deny_exceeds_daily_transfer_cap',
        category: 'financial',
        priority: 320,
        evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
            if (!req.financialContext) return null;
            const amount = Number(req.toolArgs['amount_cents'] ?? req.toolArgs['amountCents'] ?? 0);
            if (amount <= 0) return null;
            const projected = req.financialContext.dailyTransferCents + amount;
            if (projected > tp.dailyTransferCapCents) {
                return deny(this.name, `Daily transfer total would be ${projected} cents, exceeds cap of ${tp.dailyTransferCapCents}`);
            }
            return null;
        },
    };

    const denyBelowMinimumReserve: PolicyRule = {
        name: 'deny_below_minimum_reserve',
        category: 'financial',
        priority: 330,
        evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
            if (!req.financialContext) return null;
            const amount = Number(req.toolArgs['amount_cents'] ?? req.toolArgs['amountCents'] ?? 0);
            if (amount <= 0) return null;
            const remaining = req.financialContext.balanceCents - amount;
            if (remaining < tp.minimumReserveCents) {
                return deny(this.name, `Transfer would drop balance to ${remaining} cents, below reserve of ${tp.minimumReserveCents}`);
            }
            return null;
        },
    };

    const denyX402UnlistedDomain: PolicyRule = {
        name: 'deny_x402_unlisted_domain',
        category: 'financial',
        priority: 340,
        evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
            if (req.toolName !== 'x402_fetch') return null;
            const url = String(req.toolArgs['url'] ?? '');
            if (!url) return null;
            try {
                const domain = new URL(url).hostname;
                if (!tp.x402DomainAllowlist.includes(domain)) {
                    return deny(this.name, `Domain "${domain}" not in x402 allowlist`);
                }
            } catch {
                return deny(this.name, `Invalid URL: "${url}"`);
            }
            return null;
        },
    };

    const denyExceedsInferenceDailyBudget: PolicyRule = {
        name: 'deny_exceeds_inference_daily_budget',
        category: 'financial',
        priority: 350,
        evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
            if (!req.financialContext) return null;
            const estimatedCost = Number(req.toolArgs['estimated_cost_cents'] ?? 0);
            if (estimatedCost <= 0) return null;
            const projected = req.financialContext.dailyInferenceCents + estimatedCost;
            if (projected > tp.inferenceDailyBudgetCents) {
                return deny(this.name, `Inference daily spend would be ${projected} cents, exceeds budget of ${tp.inferenceDailyBudgetCents}`);
            }
            return null;
        },
    };

    return [
        denyExceedsPerPaymentCap,
        denyExceedsHourlyTransferCap,
        denyExceedsDailyTransferCap,
        denyBelowMinimumReserve,
        denyX402UnlistedDomain,
        denyExceedsInferenceDailyBudget,
    ];
}
