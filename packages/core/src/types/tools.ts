/**
 * Tool system types.
 */
import type { AuthorityLevel, RiskLevel, ToolCategory, ToolSource } from './common.js';

export interface ToolDefinition {
    readonly name: string;
    readonly category: ToolCategory;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
    readonly riskLevel: RiskLevel;
    readonly requiredAuthority: AuthorityLevel;
    readonly mcpExposed: boolean;
    readonly auditFields: readonly string[];
}

export interface ToolCallRequest {
    readonly name: string;
    readonly args: Record<string, unknown>;
    readonly source: ToolSource;
    readonly turnId?: number;
}

export interface ToolCallResult {
    readonly name: string;
    readonly result: string;
    readonly durationMs: number;
    readonly truncated: boolean;
}

export interface ToolExecutor {
    execute(request: ToolCallRequest): Promise<ToolCallResult>;
}
