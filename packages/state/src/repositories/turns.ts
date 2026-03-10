/**
 * Turns repository — append-only record of LLM interaction turns.
 */
import type Database from 'better-sqlite3';
import { type Cents, nowISO } from '@web4-agent/core';

export interface TurnRow {
    readonly id: number;
    readonly session_id: string;
    readonly thinking: string | null;
    readonly tool_calls_json: string | null;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cost_cents: number;
    readonly model: string | null;
    readonly created_at: string;
}

export interface InsertTurn {
    readonly sessionId: string;
    readonly thinking?: string;
    readonly toolCallsJson?: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costCents: Cents;
    readonly model?: string;
}

export class TurnsRepository {
    private readonly insertStmt: Database.Statement;
    private readonly findBySessionStmt: Database.Statement;
    private readonly findByIdStmt: Database.Statement;
    private readonly countBySessionStmt: Database.Statement;

    constructor(db: Database.Database) {
        this.insertStmt = db.prepare(`
      INSERT INTO turns (session_id, thinking, tool_calls_json, input_tokens, output_tokens, cost_cents, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        this.findBySessionStmt = db.prepare(
            'SELECT * FROM turns WHERE session_id = ? ORDER BY created_at ASC',
        );
        this.findByIdStmt = db.prepare('SELECT * FROM turns WHERE id = ?');
        this.countBySessionStmt = db.prepare(
            'SELECT COUNT(*) as cnt FROM turns WHERE session_id = ?',
        );
    }

    insert(turn: InsertTurn): number {
        const result = this.insertStmt.run(
            turn.sessionId,
            turn.thinking ?? null,
            turn.toolCallsJson ?? null,
            turn.inputTokens,
            turn.outputTokens,
            turn.costCents as number,
            turn.model ?? null,
            nowISO(),
        );
        return Number(result.lastInsertRowid);
    }

    findBySession(sessionId: string): readonly TurnRow[] {
        return this.findBySessionStmt.all(sessionId) as TurnRow[];
    }

    findById(id: number): TurnRow | undefined {
        return this.findByIdStmt.get(id) as TurnRow | undefined;
    }

    countBySession(sessionId: string): number {
        const row = this.countBySessionStmt.get(sessionId) as { cnt: number };
        return row.cnt;
    }
}
