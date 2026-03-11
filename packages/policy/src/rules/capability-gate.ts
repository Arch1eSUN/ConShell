/**
 * CapabilityGateRule — Blocks tools that require disabled capabilities.
 *
 * Each tool declares its `requiredCapabilities`. This rule checks that
 * every required capability is enabled in the config. God Mode bypasses.
 */
import type { PolicyRule, PolicyDecision, PolicyEvaluationRequest, ToolMetadata, CapabilityId } from '@conshell/core';

export interface CapabilityConfig {
    readonly godMode: boolean;
    readonly capabilities: Readonly<Record<CapabilityId, boolean>>;
}

/** Default: only internet_access is enabled. */
export const DEFAULT_CAPABILITY_CONFIG: CapabilityConfig = {
    godMode: false,
    capabilities: {
        internet_access: true,
        browser_control: false,
        shell_exec: false,
        file_system: false,
        financial_ops: false,
        account_creation: false,
        self_deploy: false,
        self_modify: false,
    },
};

export class CapabilityGateRule implements PolicyRule {
    readonly name = 'capability_gate';
    readonly category = 'capability';
    readonly priority = 5; // High priority — runs before most rules

    constructor(private readonly getConfig: () => CapabilityConfig) { }

    evaluate(_request: PolicyEvaluationRequest, toolMeta: ToolMetadata): PolicyDecision | null {
        const config = this.getConfig();

        // God mode → skip all capability checks
        if (config.godMode) {
            return null;
        }

        const required = toolMeta.requiredCapabilities ?? [];
        for (const cap of required) {
            if (!config.capabilities[cap]) {
                return {
                    allowed: false,
                    rule: this.name,
                    reason: `Capability "${cap}" is disabled. Enable it in Settings → Permissions.`,
                    ruleCategory: this.category,
                };
            }
        }

        return null; // All required capabilities are enabled
    }
}
