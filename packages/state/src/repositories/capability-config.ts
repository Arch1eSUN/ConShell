/**
 * CapabilityConfigRepository — Persists capability permissions in SQLite kv table.
 *
 * Uses the existing `kv` table with key = 'capability_config'.
 */
import type Database from 'better-sqlite3';
import { nowISO } from '@conshell/core';

/** Mirrors CapabilityConfig from @conshell/policy (inlined to avoid cross-dep). */
export interface CapabilityConfigData {
    readonly godMode: boolean;
    readonly capabilities: Readonly<Record<string, boolean>>;
}
const KV_KEY = 'capability_config';

export class CapabilityConfigRepository {
    private readonly getStmt: Database.Statement;
    private readonly upsertStmt: Database.Statement;

    constructor(db: Database.Database) {
        this.getStmt = db.prepare('SELECT value FROM kv WHERE key = ?');
        this.upsertStmt = db.prepare(`
            INSERT INTO kv (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `);
    }

    load(defaultConfig: CapabilityConfigData): CapabilityConfigData {
        const row = this.getStmt.get(KV_KEY) as { value: string } | undefined;
        if (!row) return defaultConfig;
        try {
            return JSON.parse(row.value) as CapabilityConfigData;
        } catch {
            return defaultConfig;
        }
    }

    save(config: CapabilityConfigData): void {
        this.upsertStmt.run(KV_KEY, JSON.stringify(config), nowISO());
    }
}
