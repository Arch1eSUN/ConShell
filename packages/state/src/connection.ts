/**
 * SQLite connection manager.
 *
 * Manages the database lifecycle: opens in WAL mode with foreign keys,
 * runs migrations on init, and provides a typed query surface.
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';
import {
    DB_FILENAME,
    type Logger,
    DatabaseCorruptionError,
} from '@conshell/core';
import { runMigrations } from './migrations/runner.js';

export interface DatabaseOptions {
    /** Path to the agent home directory containing state.db */
    readonly agentHome: string;
    /** Logger instance */
    readonly logger: Logger;
    /** Optional: path override for testing */
    readonly dbPath?: string;
}

/**
 * Open (or create) the agent database and run pending migrations.
 *
 * - WAL mode for concurrent reads
 * - Foreign keys enforced
 * - Synchronous NORMAL for durability/performance balance
 */
export function openDatabase(options: DatabaseOptions): Database.Database {
    const { logger } = options;
    const dbPath = options.dbPath ?? join(options.agentHome, DB_FILENAME);
    const log = logger.child('sqlite-state');

    log.info('Opening database', { path: dbPath });

    const db = new Database(dbPath);

    // Enable WAL mode for concurrent read access
    db.pragma('journal_mode = WAL');
    // Enforce foreign key constraints
    db.pragma('foreign_keys = ON');
    // NORMAL synchronous: good perf with acceptable crash safety
    db.pragma('synchronous = NORMAL');
    // Busy timeout: wait up to 5 seconds for locks
    db.pragma('busy_timeout = 5000');

    // Verify integrity on first open
    const integrityCheck = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrityCheck.length !== 1 || integrityCheck[0]?.integrity_check !== 'ok') {
        throw new DatabaseCorruptionError(
            `Integrity check failed: ${JSON.stringify(integrityCheck)}`,
        );
    }

    // Run pending migrations
    runMigrations(db, log);

    log.info('Database ready');
    return db;
}

/**
 * Open an in-memory database for testing with migrations applied.
 */
export function openTestDatabase(logger: Logger): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    const log = logger.child('sqlite-state');
    runMigrations(db, log);

    return db;
}
