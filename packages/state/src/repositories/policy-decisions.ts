/**
 * Policy decisions repository — append-only audit of all policy evaluations.
 */
import type Database from 'better-sqlite3';
import { nowISO } from '@conshell/core';

export interface PolicyDecisionRow {
    readonly id: number;
    readonly tool_name: string;
    readonly tool_args_redacted: string | null;
    readonly source: string;
    readonly allowed: number;
    readonly rule_category: string | null;
    readonly rule_name: string | null;
    readonly reason: string | null;
    readonly created_at: string;
}

export interface InsertPolicyDecision {
    readonly toolName: string;
    readonly toolArgsRedacted?: string;
    readonly source: string;
    readonly allowed: boolean;
    readonly ruleCategory?: string;
    readonly ruleName?: string;
    readonly reason?: string;
}

export class PolicyDecisionsRepository {
    private readonly insertStmt: Database.Statement;
    private readonly findByToolStmt: Database.Statement;
    private readonly findDeniedStmt: Database.Statement;
    private readonly countInWindowStmt: Database.Statement;

    constructor(db: Database.Database) {
        this.insertStmt = db.prepare(`
      INSERT INTO policy_decisions (tool_name, tool_args_redacted, source, allowed, rule_category, rule_name, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        this.findByToolStmt = db.prepare(
            'SELECT * FROM policy_decisions WHERE tool_name = ? ORDER BY created_at DESC LIMIT ?',
        );
        this.findDeniedStmt = db.prepare(
            'SELECT * FROM policy_decisions WHERE allowed = 0 ORDER BY created_at DESC LIMIT ?',
        );
        this.countInWindowStmt = db.prepare(
            'SELECT COUNT(*) as cnt FROM policy_decisions WHERE tool_name = ? AND created_at >= ?',
        );
    }

    insert(decision: InsertPolicyDecision): number {
        const result = this.insertStmt.run(
            decision.toolName,
            decision.toolArgsRedacted ?? null,
            decision.source,
            decision.allowed ? 1 : 0,
            decision.ruleCategory ?? null,
            decision.ruleName ?? null,
            decision.reason ?? null,
            nowISO(),
        );
        return Number(result.lastInsertRowid);
    }

    findByTool(toolName: string, limit = 50): readonly PolicyDecisionRow[] {
        return this.findByToolStmt.all(toolName, limit) as PolicyDecisionRow[];
    }

    findDenied(limit = 50): readonly PolicyDecisionRow[] {
        return this.findDeniedStmt.all(limit) as PolicyDecisionRow[];
    }

    /** Count decisions for a tool since a given ISO timestamp. */
    countSince(toolName: string, sinceISO: string): number {
        const row = this.countInWindowStmt.get(toolName, sinceISO) as { cnt: number };
        return row.cnt;
    }
}
