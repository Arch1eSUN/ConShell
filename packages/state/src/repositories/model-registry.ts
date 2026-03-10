/**
 * ModelRegistryRepository — DB-backed catalog of LLM models.
 *
 * Supports upsert seeding, query by provider/capability, and availability filtering.
 */
import type Database from 'better-sqlite3';
import { nowISO } from '@web4-agent/core';

export interface ModelRow {
    readonly id: string;
    readonly provider: string;
    readonly name: string;
    readonly input_cost_micro: number;
    readonly output_cost_micro: number;
    readonly max_tokens: number;
    readonly capabilities_json: string | null;
    readonly available: number;
    readonly updated_at: string;
}

export interface UpsertModel {
    readonly id: string;
    readonly provider: string;
    readonly name: string;
    readonly inputCostMicro: number;
    readonly outputCostMicro: number;
    readonly maxTokens: number;
    readonly capabilities: readonly string[];
    readonly available: boolean;
}

export class ModelRegistryRepository {
    private readonly upsertStmt: Database.Statement;
    private readonly getByIdStmt: Database.Statement;
    private readonly listAvailableStmt: Database.Statement;
    private readonly listByProviderStmt: Database.Statement;
    private readonly listAllStmt: Database.Statement;

    constructor(private readonly db: Database.Database) {
        this.upsertStmt = db.prepare(`
            INSERT INTO model_registry (id, provider, name, input_cost_micro, output_cost_micro, max_tokens, capabilities_json, available, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                name = excluded.name,
                input_cost_micro = excluded.input_cost_micro,
                output_cost_micro = excluded.output_cost_micro,
                max_tokens = excluded.max_tokens,
                capabilities_json = excluded.capabilities_json,
                available = excluded.available,
                updated_at = excluded.updated_at
        `);

        this.getByIdStmt = db.prepare('SELECT * FROM model_registry WHERE id = ?');
        this.listAvailableStmt = db.prepare('SELECT * FROM model_registry WHERE available = 1 ORDER BY provider, name');
        this.listByProviderStmt = db.prepare('SELECT * FROM model_registry WHERE provider = ? ORDER BY name');
        this.listAllStmt = db.prepare('SELECT * FROM model_registry ORDER BY provider, name');
    }

    upsert(model: UpsertModel): void {
        this.upsertStmt.run(
            model.id,
            model.provider,
            model.name,
            model.inputCostMicro,
            model.outputCostMicro,
            model.maxTokens,
            JSON.stringify(model.capabilities),
            model.available ? 1 : 0,
            nowISO(),
        );
    }

    upsertMany(models: readonly UpsertModel[]): void {
        const txn = this.db.transaction(() => {
            for (const m of models) this.upsert(m);
        });
        txn();
    }

    getById(id: string): ModelRow | undefined {
        return this.getByIdStmt.get(id) as ModelRow | undefined;
    }

    listAvailable(): readonly ModelRow[] {
        return this.listAvailableStmt.all() as ModelRow[];
    }

    listByProvider(provider: string): readonly ModelRow[] {
        return this.listByProviderStmt.all(provider) as ModelRow[];
    }

    listAll(): readonly ModelRow[] {
        return this.listAllStmt.all() as ModelRow[];
    }
}
