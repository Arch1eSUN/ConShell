/**
 * CapabilityGateRule — Blocks tools that require disabled capabilities.
 *
 * Each tool declares its `requiredCapabilities`. This rule checks that
 * every required capability is enabled in the config. God Mode bypasses.
 */
import type { PolicyRule, PolicyDecision, PolicyEvaluationRequest, ToolMetadata, CapabilityId, SecurityTier } from '@conshell/core';

export interface CapabilityConfig {
    readonly godMode: boolean;
    readonly capabilities: Readonly<Record<CapabilityId, boolean>>;
}

/** Default: only internet_access is enabled (= sandbox tier). */
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
        payment_enabled: false,
    },
};

/** Four progressive security tiers. */
export const SECURITY_TIER_PRESETS: Record<SecurityTier, CapabilityConfig> = {
    sandbox: DEFAULT_CAPABILITY_CONFIG,
    standard: {
        godMode: false,
        capabilities: {
            internet_access: true,
            browser_control: true,
            shell_exec: true,
            file_system: true,
            financial_ops: false,
            account_creation: false,
            self_deploy: false,
            self_modify: false,
            payment_enabled: false,
        },
    },
    autonomous: {
        godMode: false,
        capabilities: {
            internet_access: true,
            browser_control: true,
            shell_exec: true,
            file_system: true,
            financial_ops: true,
            account_creation: true,
            self_deploy: false,
            self_modify: false,
            payment_enabled: true,
        },
    },
    godmode: {
        godMode: true,
        capabilities: {
            internet_access: true,
            browser_control: true,
            shell_exec: true,
            file_system: true,
            financial_ops: true,
            account_creation: true,
            self_deploy: true,
            self_modify: true,
            payment_enabled: true,
        },
    },
};

/** Detect which tier best matches the current config, or 'custom'. */
export function detectTier(config: CapabilityConfig): SecurityTier | 'custom' {
    for (const [tier, preset] of Object.entries(SECURITY_TIER_PRESETS) as [SecurityTier, CapabilityConfig][]) {
        if (config.godMode !== preset.godMode) continue;
        const capsMatch = (Object.keys(preset.capabilities) as CapabilityId[]).every(
            k => config.capabilities[k] === preset.capabilities[k],
        );
        if (capsMatch) return tier;
    }
    return 'custom';
}

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
