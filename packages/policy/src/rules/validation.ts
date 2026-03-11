/**
 * Category 6: Validation Rules (priority 600–699)
 *
 * Input format validation: npm package names, URLs, domains, git hashes, ETH addresses.
 */
import type { PolicyRule, PolicyEvaluationRequest, PolicyDecision, ToolMetadata } from '@conshell/core';
import { NPM_PACKAGE_NAME_PATTERN, isValidEthAddress } from '@conshell/core';

function deny(rule: string, reason: string): PolicyDecision {
    return { allowed: false, rule, reason, ruleCategory: 'validation' };
}

const GIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;

export const validatePackageName: PolicyRule = {
    name: 'validate_package_name',
    category: 'validation',
    priority: 600,
    evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
        if (req.toolName !== 'install_npm_package') return null;
        const name = String(req.toolArgs['package_name'] ?? req.toolArgs['packageName'] ?? '');
        if (!name || !NPM_PACKAGE_NAME_PATTERN.test(name)) {
            return deny(this.name, `Invalid npm package name: "${name}"`);
        }
        return null;
    },
};

export const validateUrlFormat: PolicyRule = {
    name: 'validate_url_format',
    category: 'validation',
    priority: 610,
    evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
        const url = req.toolArgs['url'] as string | undefined;
        if (!url) return null;
        // Only validate if tool expects a URL argument
        if (req.toolName !== 'x402_fetch') return null;
        try {
            new URL(url);
        } catch {
            return deny(this.name, `Invalid URL format: "${url}"`);
        }
        return null;
    },
};

export const validateDomainFormat: PolicyRule = {
    name: 'validate_domain_format',
    category: 'validation',
    priority: 620,
    evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
        const domain = req.toolArgs['domain'] as string | undefined;
        if (!domain) return null;
        // Simple domain validation: alphanumeric with dots, no spaces
        if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(domain)) {
            return deny(this.name, `Invalid domain format: "${domain}"`);
        }
        return null;
    },
};

export const validateGitHash: PolicyRule = {
    name: 'validate_git_hash',
    category: 'validation',
    priority: 630,
    evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
        if (req.toolName !== 'pull_upstream') return null;
        const hash = String(req.toolArgs['commit_hash'] ?? req.toolArgs['commitHash'] ?? '');
        if (!hash) return null;
        if (!GIT_HASH_PATTERN.test(hash)) {
            return deny(this.name, `Invalid git hash: "${hash}" (expected 7–40 hex characters)`);
        }
        return null;
    },
};

export const validateEthereumAddress: PolicyRule = {
    name: 'validate_ethereum_address',
    category: 'validation',
    priority: 640,
    evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
        const address = req.toolArgs['address'] as string | undefined;
        if (!address) return null;
        if (!isValidEthAddress(address)) {
            return deny(this.name, `Invalid Ethereum address: "${address}"`);
        }
        return null;
    },
};

export const validationRules: readonly PolicyRule[] = [
    validatePackageName,
    validateUrlFormat,
    validateDomainFormat,
    validateGitHash,
    validateEthereumAddress,
];
