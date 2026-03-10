/**
 * Policy engine types.
 */
import type { Cents } from '../money/money.js';
import type { AgentState, AuthorityLevel, CapabilityId, RiskLevel, SurvivalTier } from './common.js';

export interface PolicyEvaluationRequest {
    readonly toolName: string;
    readonly toolArgs: Record<string, unknown>;
    readonly source: AuthorityLevel;
    readonly agentState: AgentState;
    readonly survivalTier: SurvivalTier;
    readonly financialContext?: FinancialContext;
}

export interface FinancialContext {
    readonly balanceCents: Cents;
    readonly hourlySpendCents: Cents;
    readonly dailySpendCents: Cents;
    readonly hourlyTransferCents: Cents;
    readonly dailyTransferCents: Cents;
    readonly dailyInferenceCents: Cents;
}

export interface PolicyDecision {
    readonly allowed: boolean;
    readonly rule?: string;
    readonly reason?: string;
    readonly ruleCategory?: string;
}

export interface PolicyRule {
    readonly name: string;
    readonly category: string;
    readonly priority: number;
    evaluate(request: PolicyEvaluationRequest, toolMeta: ToolMetadata): PolicyDecision | null;
}

export interface ToolMetadata {
    readonly name: string;
    readonly category: string;
    readonly riskLevel: RiskLevel;
    readonly requiredAuthority: AuthorityLevel;
    readonly mcpExposed: boolean;
    readonly auditFields: readonly string[];
    /** Capabilities required by this tool. */
    readonly requiredCapabilities?: readonly CapabilityId[];
}
