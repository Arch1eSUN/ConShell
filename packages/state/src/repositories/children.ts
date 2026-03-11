/**
 * Children repository — tracks child agent lifecycle state.
 */
import type Database from 'better-sqlite3';
import { type Cents, type ChildLifecycleState, nowISO } from '@conshell/core';

export interface ChildRow {
    readonly id: string;
    readonly address: string | null;
    readonly sandbox_id: string | null;
    readonly state: string;
    readonly genesis_prompt: string | null;
    readonly genesis_hash: string | null;
    readonly constitution_hash: string | null;
    readonly funded_cents: number;
    readonly created_at: string;
    readonly updated_at: string;
}

export interface InsertChild {
    readonly id: string;
    readonly genesisPrompt?: string;
    readonly genesisHash?: string;
    readonly constitutionHash?: string;
    readonly fundedCents?: Cents;
}

export interface ChildLifecycleEventRow {
    readonly id: number;
    readonly child_id: string;
    readonly from_state: string;
    readonly to_state: string;
    readonly reason: string | null;
    readonly created_at: string;
}

export class ChildrenRepository {
    private readonly insertStmt: Database.Statement;
    private readonly findByIdStmt: Database.Statement;
    private readonly findByStateStmt: Database.Statement;
    private readonly listAllStmt: Database.Statement;
    private readonly updateStateStmt: Database.Statement;
    private readonly updateSandboxStmt: Database.Statement;
    private readonly updateAddressStmt: Database.Statement;
    private readonly addFundingStmt: Database.Statement;
    private readonly countAliveStmt: Database.Statement;
    private readonly insertLifecycleStmt: Database.Statement;
    private readonly findLifecycleStmt: Database.Statement;

    constructor(private readonly db: Database.Database) {
        this.insertStmt = db.prepare(`
      INSERT INTO children (id, state, genesis_prompt, genesis_hash, constitution_hash, funded_cents, created_at, updated_at)
      VALUES (?, 'spawning', ?, ?, ?, ?, ?, ?)
    `);
        this.findByIdStmt = db.prepare('SELECT * FROM children WHERE id = ?');
        this.findByStateStmt = db.prepare(
            'SELECT * FROM children WHERE state = ?',
        );
        this.listAllStmt = db.prepare('SELECT * FROM children ORDER BY created_at DESC');
        this.updateStateStmt = db.prepare(
            'UPDATE children SET state = ?, updated_at = ? WHERE id = ?',
        );
        this.updateSandboxStmt = db.prepare(
            'UPDATE children SET sandbox_id = ?, updated_at = ? WHERE id = ?',
        );
        this.updateAddressStmt = db.prepare(
            'UPDATE children SET address = ?, updated_at = ? WHERE id = ?',
        );
        this.addFundingStmt = db.prepare(
            'UPDATE children SET funded_cents = funded_cents + ?, updated_at = ? WHERE id = ?',
        );
        this.countAliveStmt = db.prepare(
            "SELECT COUNT(*) as cnt FROM children WHERE state NOT IN ('dead')",
        );

        // Lifecycle events
        this.insertLifecycleStmt = db.prepare(`
      INSERT INTO child_lifecycle_events (child_id, from_state, to_state, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
        this.findLifecycleStmt = db.prepare(
            'SELECT * FROM child_lifecycle_events WHERE child_id = ? ORDER BY created_at ASC',
        );
    }

    insert(child: InsertChild): void {
        const now = nowISO();
        this.insertStmt.run(
            child.id,
            child.genesisPrompt ?? null,
            child.genesisHash ?? null,
            child.constitutionHash ?? null,
            (child.fundedCents ?? 0) as number,
            now,
            now,
        );
    }

    findById(id: string): ChildRow | undefined {
        return this.findByIdStmt.get(id) as ChildRow | undefined;
    }

    findByState(state: ChildLifecycleState): readonly ChildRow[] {
        return this.findByStateStmt.all(state) as ChildRow[];
    }

    listAll(): readonly ChildRow[] {
        return this.listAllStmt.all() as ChildRow[];
    }

    /**
     * Transition a child's lifecycle state.
     * Also records the transition in child_lifecycle_events.
     */
    transitionState(
        id: string,
        fromState: ChildLifecycleState,
        toState: ChildLifecycleState,
        reason?: string,
    ): void {
        const now = nowISO();
        const txn = this.db.transaction(() => {
            this.updateStateStmt.run(toState, now, id);
            this.insertLifecycleStmt.run(id, fromState, toState, reason ?? null, now);
        });
        txn();
    }

    setSandboxId(id: string, sandboxId: string): void {
        this.updateSandboxStmt.run(sandboxId, nowISO(), id);
    }

    setAddress(id: string, address: string): void {
        this.updateAddressStmt.run(address, nowISO(), id);
    }

    addFunding(id: string, amountCents: Cents): void {
        this.addFundingStmt.run(amountCents as number, nowISO(), id);
    }

    /** Count children in any state except dead. */
    countAlive(): number {
        const row = this.countAliveStmt.get() as { cnt: number };
        return row.cnt;
    }

    findLifecycleEvents(childId: string): readonly ChildLifecycleEventRow[] {
        return this.findLifecycleStmt.all(childId) as ChildLifecycleEventRow[];
    }
}
