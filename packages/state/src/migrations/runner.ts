/**
 * Migration runner.
 *
 * Migrations are forward-only and incremental. Each migration is a function
 * that receives the database handle. The runner tracks applied versions in
 * the `schema_version` table and applies pending migrations in order.
 */
import type Database from 'better-sqlite3';
import { type Logger, MigrationError, nowISO } from '@conshell/core';
import { migrations } from './definitions.js';

export interface Migration {
    readonly version: number;
    readonly description: string;
    apply(db: Database.Database): void;
}

/**
 * Get the current schema version, or 0 if no migrations have run.
 */
function getCurrentVersion(db: Database.Database): number {
    // Check if schema_version table exists
    const tableExists = db
        .prepare(
            "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='schema_version'",
        )
        .get() as { cnt: number };

    if (tableExists.cnt === 0) {
        return 0;
    }

    const row = db
        .prepare('SELECT MAX(version) as version FROM schema_version')
        .get() as { version: number | null } | undefined;

    return row?.version ?? 0;
}

/**
 * Run all pending migrations inside a transaction.
 * Each migration version runs in its own transaction for atomicity.
 */
export function runMigrations(db: Database.Database, logger: Logger): void {
    const currentVersion = getCurrentVersion(db);
    const pending = migrations.filter((m) => m.version > currentVersion);

    if (pending.length === 0) {
        logger.debug('No pending migrations', { currentVersion });
        return;
    }

    logger.info('Running migrations', {
        currentVersion,
        pendingCount: pending.length,
        targetVersion: pending[pending.length - 1]!.version,
    });

    for (const migration of pending) {
        const applyOne = db.transaction(() => {
            try {
                migration.apply(db);

                // Ensure schema_version table exists (created by v1 migration)
                db.prepare(
                    'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
                ).run(migration.version, nowISO());

                logger.info('Applied migration', {
                    version: migration.version,
                    description: migration.description,
                });
            } catch (err) {
                throw new MigrationError(
                    migration.version,
                    err instanceof Error ? err : new Error(String(err)),
                );
            }
        });

        applyOne();
    }
}
