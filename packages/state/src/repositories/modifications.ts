/**
 * Modifications repository — append-only audit of all self-modifications.
 */
import type Database from 'better-sqlite3';
import { type ModificationType, type SHA256Hash, nowISO } from '@conshell/core';

export interface ModificationRow {
    readonly id: number;
    readonly type: string;
    readonly target: string;
    readonly diff: string | null;
    readonly before_hash: string | null;
    readonly after_hash: string | null;
    readonly git_commit: string | null;
    readonly created_at: string;
}

export interface InsertModification {
    readonly type: ModificationType;
    readonly target: string;
    readonly diff?: string;
    readonly beforeHash?: SHA256Hash;
    readonly afterHash?: SHA256Hash;
    readonly gitCommit?: string;
}

export class ModificationsRepository {
    private readonly insertStmt: Database.Statement;
    private readonly findByTypeStmt: Database.Statement;
    private readonly findRecentStmt: Database.Statement;
    private readonly countInWindowStmt: Database.Statement;

    constructor(db: Database.Database) {
        this.insertStmt = db.prepare(`
      INSERT INTO modifications (type, target, diff, before_hash, after_hash, git_commit, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        this.findByTypeStmt = db.prepare(
            'SELECT * FROM modifications WHERE type = ? ORDER BY created_at DESC LIMIT ?',
        );
        this.findRecentStmt = db.prepare(
            'SELECT * FROM modifications ORDER BY created_at DESC LIMIT ?',
        );
        this.countInWindowStmt = db.prepare(
            'SELECT COUNT(*) as cnt FROM modifications WHERE created_at >= ?',
        );
    }

    insert(mod: InsertModification): number {
        const result = this.insertStmt.run(
            mod.type,
            mod.target,
            mod.diff ?? null,
            mod.beforeHash ?? null,
            mod.afterHash ?? null,
            mod.gitCommit ?? null,
            nowISO(),
        );
        return Number(result.lastInsertRowid);
    }

    findByType(type: ModificationType, limit = 50): readonly ModificationRow[] {
        return this.findByTypeStmt.all(type, limit) as ModificationRow[];
    }

    findRecent(limit = 20): readonly ModificationRow[] {
        return this.findRecentStmt.all(limit) as ModificationRow[];
    }

    /** Count modifications since a given ISO timestamp (for rate limiting). */
    countSince(sinceISO: string): number {
        const row = this.countInWindowStmt.get(sinceISO) as { cnt: number };
        return row.cnt;
    }
}
