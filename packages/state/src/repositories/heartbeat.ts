/**
 * Heartbeat repository — schedule, history, dedup, wake events.
 */
import type Database from 'better-sqlite3';
import { type HeartbeatResult, nowISO } from '@web4-agent/core';

// ── Schedule ───────────────────────────────────────────────────────────

export interface HeartbeatScheduleRow {
    readonly name: string;
    readonly cron: string;
    readonly enabled: number;
    readonly min_tier: string;
    readonly last_run: string | null;
    readonly lease_holder: string | null;
    readonly lease_expires: string | null;
    readonly config_json: string | null;
}

export interface UpsertHeartbeatSchedule {
    readonly name: string;
    readonly cron: string;
    readonly enabled?: boolean;
    readonly minTier?: string;
    readonly configJson?: string;
}

// ── History ────────────────────────────────────────────────────────────

export interface HeartbeatHistoryRow {
    readonly id: number;
    readonly task_name: string;
    readonly result: string;
    readonly duration_ms: number;
    readonly error: string | null;
    readonly should_wake: number;
    readonly created_at: string;
}

// ── Wake Events ────────────────────────────────────────────────────────

export interface WakeEventRow {
    readonly id: number;
    readonly source: string;
    readonly reason: string;
    readonly consumed: number;
    readonly created_at: string;
}

export class HeartbeatRepository {
    // Schedule
    private readonly upsertScheduleStmt: Database.Statement;
    private readonly findScheduleStmt: Database.Statement;
    private readonly listEnabledStmt: Database.Statement;
    private readonly acquireLeaseStmt: Database.Statement;
    private readonly releaseLeaseStmt: Database.Statement;
    private readonly updateLastRunStmt: Database.Statement;

    // History
    private readonly insertHistoryStmt: Database.Statement;
    private readonly findHistoryStmt: Database.Statement;
    private readonly pruneHistoryStmt: Database.Statement;

    // Dedup
    private readonly checkDedupStmt: Database.Statement;
    private readonly insertDedupStmt: Database.Statement;
    private readonly pruneExpiredDedupStmt: Database.Statement;

    // Wake events
    private readonly insertWakeStmt: Database.Statement;
    private readonly findUnconsumedStmt: Database.Statement;
    private readonly consumeWakeStmt: Database.Statement;

    constructor(db: Database.Database) {
        // Schedule
        this.upsertScheduleStmt = db.prepare(`
      INSERT INTO heartbeat_schedule (name, cron, enabled, min_tier, config_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET cron=excluded.cron, enabled=excluded.enabled, min_tier=excluded.min_tier, config_json=excluded.config_json
    `);
        this.findScheduleStmt = db.prepare('SELECT * FROM heartbeat_schedule WHERE name = ?');
        this.listEnabledStmt = db.prepare('SELECT * FROM heartbeat_schedule WHERE enabled = 1');
        this.acquireLeaseStmt = db.prepare(`
      UPDATE heartbeat_schedule
      SET lease_holder = ?, lease_expires = ?
      WHERE name = ? AND (lease_holder IS NULL OR lease_expires < ?)
    `);
        this.releaseLeaseStmt = db.prepare(
            'UPDATE heartbeat_schedule SET lease_holder = NULL, lease_expires = NULL WHERE name = ? AND lease_holder = ?',
        );
        this.updateLastRunStmt = db.prepare(
            'UPDATE heartbeat_schedule SET last_run = ? WHERE name = ?',
        );

        // History
        this.insertHistoryStmt = db.prepare(`
      INSERT INTO heartbeat_history (task_name, result, duration_ms, error, should_wake, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        this.findHistoryStmt = db.prepare(
            'SELECT * FROM heartbeat_history WHERE task_name = ? ORDER BY created_at DESC LIMIT ?',
        );
        this.pruneHistoryStmt = db.prepare(
            'DELETE FROM heartbeat_history WHERE created_at < ?',
        );

        // Dedup
        this.checkDedupStmt = db.prepare(
            'SELECT 1 FROM heartbeat_dedup WHERE key = ? AND expires_at > ?',
        );
        this.insertDedupStmt = db.prepare(
            'INSERT OR REPLACE INTO heartbeat_dedup (key, created_at, expires_at) VALUES (?, ?, ?)',
        );
        this.pruneExpiredDedupStmt = db.prepare(
            'DELETE FROM heartbeat_dedup WHERE expires_at <= ?',
        );

        // Wake events
        this.insertWakeStmt = db.prepare(
            'INSERT INTO wake_events (source, reason, created_at) VALUES (?, ?, ?)',
        );
        this.findUnconsumedStmt = db.prepare(
            'SELECT * FROM wake_events WHERE consumed = 0 ORDER BY created_at ASC',
        );
        this.consumeWakeStmt = db.prepare('UPDATE wake_events SET consumed = 1 WHERE id = ?');
    }

    // ── Schedule Methods ─────────────────────────────────────────────────

    upsertSchedule(schedule: UpsertHeartbeatSchedule): void {
        this.upsertScheduleStmt.run(
            schedule.name,
            schedule.cron,
            schedule.enabled === false ? 0 : 1,
            schedule.minTier ?? 'critical',
            schedule.configJson ?? null,
        );
    }

    findSchedule(name: string): HeartbeatScheduleRow | undefined {
        return this.findScheduleStmt.get(name) as HeartbeatScheduleRow | undefined;
    }

    listEnabled(): readonly HeartbeatScheduleRow[] {
        return this.listEnabledStmt.all() as HeartbeatScheduleRow[];
    }

    acquireLease(taskName: string, holderId: string, expiresAt: string): boolean {
        const now = nowISO();
        const result = this.acquireLeaseStmt.run(holderId, expiresAt, taskName, now);
        return result.changes > 0;
    }

    releaseLease(taskName: string, holderId: string): void {
        this.releaseLeaseStmt.run(taskName, holderId);
    }

    updateLastRun(taskName: string): void {
        this.updateLastRunStmt.run(nowISO(), taskName);
    }

    // ── History Methods ──────────────────────────────────────────────────

    insertHistory(
        taskName: string,
        result: HeartbeatResult,
        durationMs: number,
        error?: string,
        shouldWake = false,
    ): number {
        const res = this.insertHistoryStmt.run(
            taskName,
            result,
            durationMs,
            error ?? null,
            shouldWake ? 1 : 0,
            nowISO(),
        );
        return Number(res.lastInsertRowid);
    }

    findHistory(taskName: string, limit = 20): readonly HeartbeatHistoryRow[] {
        return this.findHistoryStmt.all(taskName, limit) as HeartbeatHistoryRow[];
    }

    pruneHistory(olderThanISO: string): number {
        const result = this.pruneHistoryStmt.run(olderThanISO);
        return result.changes;
    }

    // ── Dedup Methods ────────────────────────────────────────────────────

    isDuplicate(key: string): boolean {
        const now = nowISO();
        return this.checkDedupStmt.get(key, now) !== undefined;
    }

    setDedup(key: string, expiresAt: string): void {
        this.insertDedupStmt.run(key, nowISO(), expiresAt);
    }

    pruneExpiredDedup(): number {
        const result = this.pruneExpiredDedupStmt.run(nowISO());
        return result.changes;
    }

    // ── Wake Event Methods ───────────────────────────────────────────────

    insertWakeEvent(source: string, reason: string): number {
        const result = this.insertWakeStmt.run(source, reason, nowISO());
        return Number(result.lastInsertRowid);
    }

    findUnconsumedWakeEvents(): readonly WakeEventRow[] {
        return this.findUnconsumedStmt.all() as WakeEventRow[];
    }

    consumeWakeEvent(id: number): void {
        this.consumeWakeStmt.run(id);
    }
}
