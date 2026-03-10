/**
 * Memory Repositories — CRUD for the 5 memory tiers + session_summaries.
 */
import type Database from 'better-sqlite3';
import { nowISO } from '@web4-agent/core';

// ── Row types ──────────────────────────────────────────────────────────

export interface WorkingMemoryRow {
    id: number;
    session_id: string;
    type: string;
    content: string;
    created_at: string;
}

export interface EpisodicMemoryRow {
    id: number;
    event_type: string;
    content: string;
    importance: number;
    classification: string | null;
    session_id: string | null;
    turn_id: number | null;
    created_at: string;
}

export interface SemanticMemoryRow {
    id: number;
    category: string;
    key: string;
    value: string;
    confidence: number;
    source: string | null;
    created_at: string;
    updated_at: string;
}

export interface ProceduralMemoryRow {
    id: number;
    name: string;
    steps_json: string;
    success_count: number;
    failure_count: number;
    last_used: string | null;
    created_at: string;
}

export interface RelationshipMemoryRow {
    id: number;
    entity_id: string;
    entity_type: string;
    trust_score: number;
    interaction_count: number;
    last_interaction: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
}

export interface SessionSummaryRow {
    id: number;
    session_id: string;
    summary: string;
    outcome: string | null;
    created_at: string;
}

// ── Insert types ───────────────────────────────────────────────────────

export interface InsertWorkingMemory {
    sessionId: string;
    type: string;
    content: string;
}

export interface InsertEpisodicMemory {
    eventType: string;
    content: string;
    importance?: number;
    classification?: string;
    sessionId?: string;
    turnId?: number;
}

export interface UpsertSemanticMemory {
    category: string;
    key: string;
    value: string;
    confidence?: number;
    source?: string;
}

export interface UpsertProceduralMemory {
    name: string;
    stepsJson: string;
}

export interface UpsertRelationship {
    entityId: string;
    entityType: string;
    trustDelta?: number;
    notes?: string;
}

// ── Working Memory Repository ──────────────────────────────────────────

export class WorkingMemoryRepository {
    constructor(private readonly db: Database.Database) { }

    insert(mem: InsertWorkingMemory): number {
        const stmt = this.db.prepare(`
            INSERT INTO working_memory (session_id, type, content, created_at)
            VALUES (?, ?, ?, ?)`);
        const result = stmt.run(mem.sessionId, mem.type, mem.content, nowISO());
        return Number(result.lastInsertRowid);
    }

    findBySession(sessionId: string): WorkingMemoryRow[] {
        return this.db.prepare(
            `SELECT * FROM working_memory WHERE session_id = ? ORDER BY created_at`,
        ).all(sessionId) as WorkingMemoryRow[];
    }

    clearSession(sessionId: string): number {
        const result = this.db.prepare(`DELETE FROM working_memory WHERE session_id = ?`).run(sessionId);
        return result.changes;
    }
}

// ── Episodic Memory Repository ─────────────────────────────────────────

export class EpisodicMemoryRepository {
    constructor(private readonly db: Database.Database) { }

    insert(mem: InsertEpisodicMemory): number {
        const stmt = this.db.prepare(`
            INSERT INTO episodic_memory (event_type, content, importance, classification, session_id, turn_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const result = stmt.run(
            mem.eventType,
            mem.content,
            mem.importance ?? 5,
            mem.classification ?? null,
            mem.sessionId ?? null,
            mem.turnId ?? null,
            nowISO(),
        );
        return Number(result.lastInsertRowid);
    }

    findTopByImportance(limit: number): EpisodicMemoryRow[] {
        return this.db.prepare(
            `SELECT * FROM episodic_memory ORDER BY importance DESC, created_at DESC LIMIT ?`,
        ).all(limit) as EpisodicMemoryRow[];
    }

    findBySession(sessionId: string): EpisodicMemoryRow[] {
        return this.db.prepare(
            `SELECT * FROM episodic_memory WHERE session_id = ? ORDER BY created_at`,
        ).all(sessionId) as EpisodicMemoryRow[];
    }

    delete(id: number): boolean {
        return this.db.prepare(`DELETE FROM episodic_memory WHERE id = ?`).run(id).changes > 0;
    }
}

// ── Semantic Memory Repository ─────────────────────────────────────────

export class SemanticMemoryRepository {
    constructor(private readonly db: Database.Database) { }

    upsert(mem: UpsertSemanticMemory): number {
        const now = nowISO();
        const stmt = this.db.prepare(`
            INSERT INTO semantic_memory (category, key, value, confidence, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, confidence = excluded.confidence, source = excluded.source, updated_at = excluded.updated_at`);
        const result = stmt.run(
            mem.category,
            mem.key,
            mem.value,
            mem.confidence ?? 5,
            mem.source ?? null,
            now,
            now,
        );
        return Number(result.lastInsertRowid);
    }

    findByCategory(category: string): SemanticMemoryRow[] {
        return this.db.prepare(
            `SELECT * FROM semantic_memory WHERE category = ? ORDER BY key`,
        ).all(category) as SemanticMemoryRow[];
    }

    findByKey(category: string, key: string): SemanticMemoryRow | undefined {
        return this.db.prepare(
            `SELECT * FROM semantic_memory WHERE category = ? AND key = ?`,
        ).get(category, key) as SemanticMemoryRow | undefined;
    }

    findAll(): SemanticMemoryRow[] {
        return this.db.prepare(`SELECT * FROM semantic_memory ORDER BY category, key`).all() as SemanticMemoryRow[];
    }

    delete(id: number): boolean {
        return this.db.prepare(`DELETE FROM semantic_memory WHERE id = ?`).run(id).changes > 0;
    }
}

// ── Procedural Memory Repository ───────────────────────────────────────

export class ProceduralMemoryRepository {
    constructor(private readonly db: Database.Database) { }

    upsert(mem: UpsertProceduralMemory): number {
        const now = nowISO();
        const stmt = this.db.prepare(`
            INSERT INTO procedural_memory (name, steps_json, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET steps_json = excluded.steps_json`);
        const result = stmt.run(mem.name, mem.stepsJson, now);
        return Number(result.lastInsertRowid);
    }

    findByName(name: string): ProceduralMemoryRow | undefined {
        return this.db.prepare(`SELECT * FROM procedural_memory WHERE name = ?`).get(name) as ProceduralMemoryRow | undefined;
    }

    recordSuccess(name: string): void {
        this.db.prepare(
            `UPDATE procedural_memory SET success_count = success_count + 1, last_used = ? WHERE name = ?`,
        ).run(nowISO(), name);
    }

    recordFailure(name: string): void {
        this.db.prepare(
            `UPDATE procedural_memory SET failure_count = failure_count + 1, last_used = ? WHERE name = ?`,
        ).run(nowISO(), name);
    }

    findAll(): ProceduralMemoryRow[] {
        return this.db.prepare(`SELECT * FROM procedural_memory ORDER BY name`).all() as ProceduralMemoryRow[];
    }

    delete(id: number): boolean {
        return this.db.prepare(`DELETE FROM procedural_memory WHERE id = ?`).run(id).changes > 0;
    }
}

// ── Relationship Memory Repository ─────────────────────────────────────

export class RelationshipMemoryRepository {
    constructor(private readonly db: Database.Database) { }

    upsert(mem: UpsertRelationship): number {
        const now = nowISO();
        const existing = this.findByEntity(mem.entityId);
        if (existing) {
            const newTrust = Math.max(0, Math.min(100, existing.trust_score + (mem.trustDelta ?? 0)));
            const notes = mem.notes ?? existing.notes;
            this.db.prepare(`
                UPDATE relationship_memory
                SET trust_score = ?, interaction_count = interaction_count + 1,
                    last_interaction = ?, notes = ?, updated_at = ?
                WHERE entity_id = ?`,
            ).run(newTrust, now, notes, now, mem.entityId);
            return existing.id;
        }
        const stmt = this.db.prepare(`
            INSERT INTO relationship_memory (entity_id, entity_type, trust_score, interaction_count, last_interaction, notes, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?)`);
        const result = stmt.run(
            mem.entityId,
            mem.entityType,
            Math.max(0, Math.min(100, 50 + (mem.trustDelta ?? 0))),
            now,
            mem.notes ?? null,
            now,
            now,
        );
        return Number(result.lastInsertRowid);
    }

    findByEntity(entityId: string): RelationshipMemoryRow | undefined {
        return this.db.prepare(`SELECT * FROM relationship_memory WHERE entity_id = ?`).get(entityId) as RelationshipMemoryRow | undefined;
    }

    findAll(): RelationshipMemoryRow[] {
        return this.db.prepare(`SELECT * FROM relationship_memory ORDER BY trust_score DESC`).all() as RelationshipMemoryRow[];
    }

    delete(id: number): boolean {
        return this.db.prepare(`DELETE FROM relationship_memory WHERE id = ?`).run(id).changes > 0;
    }
}

// ── Soul History Repository ────────────────────────────────────────────

export interface SoulHistoryRow {
    id: number;
    content: string;
    content_hash: string;
    alignment_score: number | null;
    created_at: string;
}

export interface InsertSoulHistory {
    content: string;
    contentHash: string;
    alignmentScore?: number;
}

export class SoulHistoryRepository {
    constructor(private readonly db: Database.Database) { }

    insert(entry: InsertSoulHistory): number {
        const stmt = this.db.prepare(`
            INSERT INTO soul_history (content, content_hash, alignment_score, created_at)
            VALUES (?, ?, ?, ?)`);
        const result = stmt.run(
            entry.content,
            entry.contentHash,
            entry.alignmentScore ?? null,
            nowISO(),
        );
        return Number(result.lastInsertRowid);
    }

    getLatest(): SoulHistoryRow | undefined {
        return this.db.prepare(`SELECT * FROM soul_history ORDER BY created_at DESC LIMIT 1`).get() as SoulHistoryRow | undefined;
    }

    findAll(): SoulHistoryRow[] {
        return this.db.prepare(`SELECT * FROM soul_history ORDER BY created_at`).all() as SoulHistoryRow[];
    }

    count(): number {
        const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM soul_history`).get() as { cnt: number };
        return row.cnt;
    }
}

// ── Session Summaries Repository ───────────────────────────────────────

export class SessionSummariesRepository {
    constructor(private readonly db: Database.Database) { }

    upsert(sessionId: string, summary: string, outcome?: string): number {
        const now = nowISO();
        const stmt = this.db.prepare(`
            INSERT INTO session_summaries (session_id, summary, outcome, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary, outcome = excluded.outcome`);
        const result = stmt.run(sessionId, summary, outcome ?? null, now);
        return Number(result.lastInsertRowid);
    }

    findBySession(sessionId: string): SessionSummaryRow | undefined {
        return this.db.prepare(`SELECT * FROM session_summaries WHERE session_id = ?`).get(sessionId) as SessionSummaryRow | undefined;
    }

    findRecent(limit: number): SessionSummaryRow[] {
        return this.db.prepare(`SELECT * FROM session_summaries ORDER BY created_at DESC LIMIT ?`).all(limit) as SessionSummaryRow[];
    }
}
