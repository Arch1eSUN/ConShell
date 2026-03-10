/**
 * Spend tracking repository — append-only spend entries for rate limiting.
 */
import type Database from 'better-sqlite3';
import { type Cents, type SpendType, nowISO } from '@web4-agent/core';

export interface SpendRow {
    readonly id: number;
    readonly type: string;
    readonly amount_cents: number;
    readonly window_hour: string;
    readonly window_day: string;
    readonly created_at: string;
}

export interface InsertSpend {
    readonly type: SpendType;
    readonly amountCents: Cents;
}

/**
 * Get the current hour bucket in ISO format (e.g., "2024-01-15T14").
 */
function currentHourBucket(): string {
    return new Date().toISOString().slice(0, 13);
}

/**
 * Get the current day bucket in ISO format (e.g., "2024-01-15").
 */
function currentDayBucket(): string {
    return new Date().toISOString().slice(0, 10);
}

export class SpendRepository {
    private readonly insertStmt: Database.Statement;
    private readonly sumByHourStmt: Database.Statement;
    private readonly sumByDayStmt: Database.Statement;
    private readonly sumByTypeHourStmt: Database.Statement;
    private readonly sumByTypeDayStmt: Database.Statement;
    private readonly pruneStmt: Database.Statement;

    constructor(db: Database.Database) {
        this.insertStmt = db.prepare(`
      INSERT INTO spend_tracking (type, amount_cents, window_hour, window_day, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
        this.sumByHourStmt = db.prepare(
            'SELECT COALESCE(SUM(amount_cents), 0) as total FROM spend_tracking WHERE window_hour = ?',
        );
        this.sumByDayStmt = db.prepare(
            'SELECT COALESCE(SUM(amount_cents), 0) as total FROM spend_tracking WHERE window_day = ?',
        );
        this.sumByTypeHourStmt = db.prepare(
            'SELECT COALESCE(SUM(amount_cents), 0) as total FROM spend_tracking WHERE type = ? AND window_hour = ?',
        );
        this.sumByTypeDayStmt = db.prepare(
            'SELECT COALESCE(SUM(amount_cents), 0) as total FROM spend_tracking WHERE type = ? AND window_day = ?',
        );
        this.pruneStmt = db.prepare(
            'DELETE FROM spend_tracking WHERE created_at < ?',
        );
    }

    record(entry: InsertSpend): number {
        const result = this.insertStmt.run(
            entry.type,
            entry.amountCents as number,
            currentHourBucket(),
            currentDayBucket(),
            nowISO(),
        );
        return Number(result.lastInsertRowid);
    }

    /** Total spend in the current hour, all types. */
    totalCurrentHour(): Cents {
        const row = this.sumByHourStmt.get(currentHourBucket()) as { total: number };
        return row.total as Cents;
    }

    /** Total spend in the current day, all types. */
    totalCurrentDay(): Cents {
        const row = this.sumByDayStmt.get(currentDayBucket()) as { total: number };
        return row.total as Cents;
    }

    /** Total spend for a specific type in the current hour. */
    totalByTypeCurrentHour(type: SpendType): Cents {
        const row = this.sumByTypeHourStmt.get(type, currentHourBucket()) as { total: number };
        return row.total as Cents;
    }

    /** Total spend for a specific type in the current day. */
    totalByTypeCurrentDay(type: SpendType): Cents {
        const row = this.sumByTypeDayStmt.get(type, currentDayBucket()) as { total: number };
        return row.total as Cents;
    }

    /** Remove entries older than the given ISO timestamp. */
    prune(olderThanISO: string): number {
        const result = this.pruneStmt.run(olderThanISO);
        return result.changes;
    }
}
