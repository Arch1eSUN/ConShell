/**
 * RoutingConfigRepository — DB-backed dynamic routing matrix.
 *
 * Stores auto-generated or user-customized routing preferences per tier × taskType.
 * Overrides the static ROUTING_MATRIX from routing.ts when entries exist.
 */
import type Database from 'better-sqlite3';

export interface RoutingConfigRow {
    readonly id: number;
    readonly tier: string;
    readonly task_type: string;
    readonly model_id: string;
    readonly priority: number;
    readonly is_custom: number;
}

export interface InsertRoutingEntry {
    readonly tier: string;
    readonly taskType: string;
    readonly modelId: string;
    readonly priority: number;
    readonly isCustom?: boolean;
}

export class RoutingConfigRepository {
    private readonly upsertStmt: Database.Statement;
    private readonly listByTierTaskStmt: Database.Statement;
    private readonly listAllStmt: Database.Statement;
    private readonly clearTierTaskStmt: Database.Statement;
    private readonly clearAllStmt: Database.Statement;

    constructor(private readonly db: Database.Database) {
        this.upsertStmt = db.prepare(`
            INSERT INTO routing_config (tier, task_type, model_id, priority, is_custom)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(tier, task_type, model_id) DO UPDATE SET
                priority = excluded.priority,
                is_custom = excluded.is_custom
        `);

        this.listByTierTaskStmt = db.prepare(
            'SELECT * FROM routing_config WHERE tier = ? AND task_type = ? ORDER BY priority ASC',
        );
        this.listAllStmt = db.prepare('SELECT * FROM routing_config ORDER BY tier, task_type, priority ASC');
        this.clearTierTaskStmt = db.prepare('DELETE FROM routing_config WHERE tier = ? AND task_type = ?');
        this.clearAllStmt = db.prepare('DELETE FROM routing_config');
    }

    upsert(entry: InsertRoutingEntry): void {
        this.upsertStmt.run(
            entry.tier,
            entry.taskType,
            entry.modelId,
            entry.priority,
            entry.isCustom ? 1 : 0,
        );
    }

    upsertMany(entries: readonly InsertRoutingEntry[]): void {
        const txn = this.db.transaction(() => {
            for (const e of entries) this.upsert(e);
        });
        txn();
    }

    /** Replace all entries for a tier × taskType combination. */
    replaceTierTask(tier: string, taskType: string, entries: readonly InsertRoutingEntry[]): void {
        const txn = this.db.transaction(() => {
            this.clearTierTaskStmt.run(tier, taskType);
            for (const e of entries) this.upsert(e);
        });
        txn();
    }

    /** Replace entire routing config (used by auto-generate). */
    replaceAll(entries: readonly InsertRoutingEntry[]): void {
        const txn = this.db.transaction(() => {
            this.clearAllStmt.run();
            for (const e of entries) this.upsert(e);
        });
        txn();
    }

    listByTierTask(tier: string, taskType: string): readonly RoutingConfigRow[] {
        return this.listByTierTaskStmt.all(tier, taskType) as RoutingConfigRow[];
    }

    listAll(): readonly RoutingConfigRow[] {
        return this.listAllStmt.all() as RoutingConfigRow[];
    }

    clearAll(): void {
        this.clearAllStmt.run();
    }

    hasEntries(): boolean {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM routing_config').get() as { count: number };
        return row.count > 0;
    }
}
