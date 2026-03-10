/**
 * Transactions repository — append-only financial transaction log.
 */
import type Database from 'better-sqlite3';
import {
    type Cents,
    type TransactionType,
    type TransactionStatus,
    nowISO,
} from '@web4-agent/core';

export interface TransactionRow {
    readonly id: number;
    readonly type: string;
    readonly amount_cents: number;
    readonly from_address: string | null;
    readonly to_address: string | null;
    readonly network: string | null;
    readonly status: string;
    readonly tx_hash: string | null;
    readonly created_at: string;
}

export interface InsertTransaction {
    readonly type: TransactionType;
    readonly amountCents: Cents;
    readonly fromAddress?: string;
    readonly toAddress?: string;
    readonly network?: string;
    readonly status?: TransactionStatus;
    readonly txHash?: string;
}

export class TransactionsRepository {
    private readonly insertStmt: Database.Statement;
    private readonly findByTypeStmt: Database.Statement;
    private readonly updateStatusStmt: Database.Statement;
    private readonly sumByTypeStmt: Database.Statement;

    constructor(db: Database.Database) {
        this.insertStmt = db.prepare(`
      INSERT INTO transactions (type, amount_cents, from_address, to_address, network, status, tx_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        this.findByTypeStmt = db.prepare(
            'SELECT * FROM transactions WHERE type = ? ORDER BY created_at DESC LIMIT ?',
        );
        this.updateStatusStmt = db.prepare(
            'UPDATE transactions SET status = ?, tx_hash = COALESCE(?, tx_hash) WHERE id = ?',
        );
        this.sumByTypeStmt = db.prepare(
            "SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions WHERE type = ? AND status = 'confirmed'",
        );
    }

    insert(tx: InsertTransaction): number {
        const result = this.insertStmt.run(
            tx.type,
            tx.amountCents as number,
            tx.fromAddress ?? null,
            tx.toAddress ?? null,
            tx.network ?? null,
            tx.status ?? 'pending',
            tx.txHash ?? null,
            nowISO(),
        );
        return Number(result.lastInsertRowid);
    }

    findByType(type: TransactionType, limit = 50): readonly TransactionRow[] {
        return this.findByTypeStmt.all(type, limit) as TransactionRow[];
    }

    updateStatus(id: number, status: TransactionStatus, txHash?: string): void {
        this.updateStatusStmt.run(status, txHash ?? null, id);
    }

    /** Sum of confirmed transactions by type. */
    sumConfirmedByType(type: TransactionType): Cents {
        const row = this.sumByTypeStmt.get(type) as { total: number };
        return row.total as Cents;
    }
}
