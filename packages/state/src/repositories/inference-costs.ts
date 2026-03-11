/**
 * InferenceCostsRepository — records every LLM inference call with cost and latency.
 */
import type Database from 'better-sqlite3';
import { nowISO } from '@conshell/core';

export interface InferenceCostRow {
    readonly id: number;
    readonly model: string;
    readonly provider: string;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cost_cents: number;
    readonly latency_ms: number;
    readonly task_type: string | null;
    readonly created_at: string;
}

export interface InsertInferenceCost {
    readonly model: string;
    readonly provider: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costCents: number;
    readonly latencyMs: number;
    readonly taskType?: string;
}

export class InferenceCostsRepository {
    private readonly insertStmt: Database.Statement;
    private readonly dailyCostStmt: Database.Statement;
    private readonly hourlyCostStmt: Database.Statement;
    private readonly listRecentStmt: Database.Statement;

    constructor(db: Database.Database) {
        this.insertStmt = db.prepare(`
            INSERT INTO inference_costs (model, provider, input_tokens, output_tokens, cost_cents, latency_ms, task_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // Sum costs for a given day (YYYY-MM-DD prefix filter)
        this.dailyCostStmt = db.prepare(`
            SELECT COALESCE(SUM(cost_cents), 0) as total
            FROM inference_costs
            WHERE created_at >= ? AND created_at < ?
        `);

        // Sum costs for a given hour
        this.hourlyCostStmt = db.prepare(`
            SELECT COALESCE(SUM(cost_cents), 0) as total
            FROM inference_costs
            WHERE created_at >= ? AND created_at < ?
        `);

        this.listRecentStmt = db.prepare(`
            SELECT * FROM inference_costs ORDER BY created_at DESC LIMIT ?
        `);
    }

    insert(cost: InsertInferenceCost): void {
        this.insertStmt.run(
            cost.model,
            cost.provider,
            cost.inputTokens,
            cost.outputTokens,
            cost.costCents,
            cost.latencyMs,
            cost.taskType ?? null,
            nowISO(),
        );
    }

    getDailyCost(dayStart: string, dayEnd: string): number {
        const row = this.dailyCostStmt.get(dayStart, dayEnd) as { total: number };
        return row.total;
    }

    getHourlyCost(hourStart: string, hourEnd: string): number {
        const row = this.hourlyCostStmt.get(hourStart, hourEnd) as { total: number };
        return row.total;
    }

    listRecent(limit: number = 10): readonly InferenceCostRow[] {
        return this.listRecentStmt.all(limit) as InferenceCostRow[];
    }
}
