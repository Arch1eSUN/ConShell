/**
 * Category 4: Path Protection Rules (priority 400–499)
 *
 * Protect critical files from write and sensitive files from read.
 */
import type { PolicyRule, PolicyEvaluationRequest, PolicyDecision, ToolMetadata } from '@conshell/core';
import {
    PROTECTED_FILE_BASENAMES,
    PROTECTED_DIRECTORIES,
    SENSITIVE_FILE_PATTERNS,
} from '@conshell/core';
import path from 'node:path';

function deny(rule: string, reason: string): PolicyDecision {
    return { allowed: false, rule, reason, ruleCategory: 'path_protection' };
}

const WRITE_TOOLS = new Set(['edit_own_file', 'write_file']);
const READ_TOOLS = new Set(['read_file']);

function isProtectedPath(filePath: string): boolean {
    const basename = path.basename(filePath);
    if (PROTECTED_FILE_BASENAMES.has(basename)) return true;
    const parts = filePath.split(path.sep);
    for (const part of parts) {
        if (PROTECTED_DIRECTORIES.has(part)) return true;
    }
    return false;
}

function matchesSensitivePattern(filePath: string): boolean {
    const basename = path.basename(filePath);
    for (const pattern of SENSITIVE_FILE_PATTERNS) {
        if (pattern.startsWith('*')) {
            // Wildcard pattern like "*.pem" → check extension
            const ext = pattern.slice(1); // ".pem"
            if (basename.endsWith(ext)) return true;
        } else {
            // Exact basename match
            if (basename === pattern) return true;
        }
    }
    return false;
}

export const denyWriteProtectedFiles: PolicyRule = {
    name: 'deny_write_protected_files',
    category: 'path_protection',
    priority: 400,
    evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
        if (!WRITE_TOOLS.has(req.toolName)) return null;
        const filePath = String(req.toolArgs['path'] ?? req.toolArgs['file'] ?? '');
        if (!filePath) return null;
        if (isProtectedPath(filePath)) {
            return deny(this.name, `Write to protected file blocked: ${path.basename(filePath)}`);
        }
        return null;
    },
};

export const denyReadSensitiveFiles: PolicyRule = {
    name: 'deny_read_sensitive_files',
    category: 'path_protection',
    priority: 410,
    evaluate(req: PolicyEvaluationRequest, _tool: ToolMetadata): PolicyDecision | null {
        if (!READ_TOOLS.has(req.toolName)) return null;
        const filePath = String(req.toolArgs['path'] ?? req.toolArgs['file'] ?? '');
        if (!filePath) return null;
        if (matchesSensitivePattern(filePath)) {
            return deny(this.name, `Read of sensitive file blocked: ${path.basename(filePath)}`);
        }
        return null;
    },
};

export const pathProtectionRules: readonly PolicyRule[] = [
    denyWriteProtectedFiles,
    denyReadSensitiveFiles,
];
