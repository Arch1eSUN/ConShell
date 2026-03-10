/**
 * Migration definitions — each migration maps to one schema version.
 * Order matters: must be sorted by version ascending.
 */
import type { Migration } from './runner.js';

export const migrations: readonly Migration[] = [
    // ── v1: Core tables ──────────────────────────────────────────────────
    {
        version: 1,
        description: 'Core tables: schema_version, identity, turns, tool_calls, transactions, modifications, installed_tools, kv',
        apply(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version   INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS identity (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS turns (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id      TEXT    NOT NULL,
          thinking        TEXT,
          tool_calls_json TEXT,
          input_tokens    INTEGER NOT NULL DEFAULT 0,
          output_tokens   INTEGER NOT NULL DEFAULT 0,
          cost_cents      INTEGER NOT NULL DEFAULT 0,
          model           TEXT,
          created_at      TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
        CREATE INDEX IF NOT EXISTS idx_turns_created ON turns(created_at);

        CREATE TABLE IF NOT EXISTS tool_calls (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          turn_id     INTEGER NOT NULL REFERENCES turns(id),
          name        TEXT    NOT NULL,
          args_json   TEXT,
          result      TEXT,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          source      TEXT    NOT NULL DEFAULT 'agent',
          created_at  TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(name);

        CREATE TABLE IF NOT EXISTS transactions (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          type         TEXT    NOT NULL,
          amount_cents INTEGER NOT NULL,
          from_address TEXT,
          to_address   TEXT,
          network      TEXT,
          status       TEXT    NOT NULL DEFAULT 'pending',
          tx_hash      TEXT,
          created_at   TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
        CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);

        CREATE TABLE IF NOT EXISTS modifications (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          type        TEXT NOT NULL,
          target      TEXT NOT NULL,
          diff        TEXT,
          before_hash TEXT,
          after_hash  TEXT,
          git_commit  TEXT,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_modifications_type ON modifications(type);
        CREATE INDEX IF NOT EXISTS idx_modifications_created ON modifications(created_at);

        CREATE TABLE IF NOT EXISTS installed_tools (
          name         TEXT PRIMARY KEY,
          type         TEXT NOT NULL,
          config_json  TEXT,
          installed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS kv (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
        },
    },

    // ── v2: Children + Skills ────────────────────────────────────────────
    {
        version: 2,
        description: 'Children table, skills table',
        apply(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS children (
          id                TEXT PRIMARY KEY,
          address           TEXT,
          sandbox_id        TEXT,
          state             TEXT NOT NULL DEFAULT 'spawning',
          genesis_prompt    TEXT,
          genesis_hash      TEXT,
          constitution_hash TEXT,
          funded_cents      INTEGER NOT NULL DEFAULT 0,
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_children_state ON children(state);

        CREATE TABLE IF NOT EXISTS skills (
          name          TEXT PRIMARY KEY,
          description   TEXT,
          triggers_json TEXT,
          content       TEXT NOT NULL,
          source        TEXT NOT NULL DEFAULT 'local',
          installed_at  TEXT NOT NULL
        );
      `);
        },
    },

    // ── v3: Inbox messages (schema preserved for v2 social relay) ───────
    {
        version: 3,
        description: 'Inbox messages table (ADR-006: schema preserved, relay deferred)',
        apply(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS inbox_messages (
          id           TEXT PRIMARY KEY,
          from_address TEXT NOT NULL,
          content      TEXT NOT NULL,
          signature    TEXT,
          state        TEXT NOT NULL DEFAULT 'received',
          retry_count  INTEGER NOT NULL DEFAULT 0,
          created_at   TEXT NOT NULL,
          processed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_state ON inbox_messages(state);
      `);
        },
    },

    // ── v4: Policy, heartbeat, spend tracking ────────────────────────────
    {
        version: 4,
        description: 'Policy decisions, heartbeat schedule/history/dedup, wake events, spend tracking',
        apply(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS policy_decisions (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          tool_name          TEXT NOT NULL,
          tool_args_redacted TEXT,
          source             TEXT NOT NULL,
          allowed            INTEGER NOT NULL,
          rule_category      TEXT,
          rule_name          TEXT,
          reason             TEXT,
          created_at         TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_policy_tool ON policy_decisions(tool_name);
        CREATE INDEX IF NOT EXISTS idx_policy_created ON policy_decisions(created_at);

        CREATE TABLE IF NOT EXISTS heartbeat_schedule (
          name          TEXT PRIMARY KEY,
          cron          TEXT NOT NULL,
          enabled       INTEGER NOT NULL DEFAULT 1,
          min_tier      TEXT NOT NULL DEFAULT 'critical',
          last_run      TEXT,
          lease_holder  TEXT,
          lease_expires TEXT,
          config_json   TEXT
        );

        CREATE TABLE IF NOT EXISTS heartbeat_history (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          task_name   TEXT NOT NULL,
          result      TEXT NOT NULL,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          error       TEXT,
          should_wake INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hb_history_task ON heartbeat_history(task_name);
        CREATE INDEX IF NOT EXISTS idx_hb_history_created ON heartbeat_history(created_at);

        CREATE TABLE IF NOT EXISTS heartbeat_dedup (
          key        TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS wake_events (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          source     TEXT NOT NULL,
          reason     TEXT NOT NULL,
          consumed   INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wake_consumed ON wake_events(consumed, created_at);

        CREATE TABLE IF NOT EXISTS spend_tracking (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          type         TEXT    NOT NULL,
          amount_cents INTEGER NOT NULL,
          window_hour  TEXT    NOT NULL,
          window_day   TEXT    NOT NULL,
          created_at   TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_spend_hour ON spend_tracking(window_hour);
        CREATE INDEX IF NOT EXISTS idx_spend_day ON spend_tracking(window_day);
      `);
        },
    },

    // ── v5: Memory tables + soul history ─────────────────────────────────
    {
        version: 5,
        description: 'Memory subsystem: working, episodic, session_summaries, semantic, procedural, relationship; soul history',
        apply(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS working_memory (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          type       TEXT NOT NULL,
          content    TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wm_session ON working_memory(session_id);

        CREATE TABLE IF NOT EXISTS episodic_memory (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type     TEXT    NOT NULL,
          content        TEXT    NOT NULL,
          importance     INTEGER NOT NULL DEFAULT 5,
          classification TEXT,
          session_id     TEXT,
          turn_id        INTEGER,
          created_at     TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ep_importance ON episodic_memory(importance DESC, created_at);

        CREATE TABLE IF NOT EXISTS session_summaries (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL UNIQUE,
          summary    TEXT NOT NULL,
          outcome    TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS semantic_memory (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          category   TEXT    NOT NULL,
          key        TEXT    NOT NULL,
          value      TEXT    NOT NULL,
          confidence INTEGER NOT NULL DEFAULT 5,
          source     TEXT,
          created_at TEXT    NOT NULL,
          updated_at TEXT    NOT NULL,
          UNIQUE(category, key)
        );
        CREATE INDEX IF NOT EXISTS idx_sem_cat ON semantic_memory(category, key);

        CREATE TABLE IF NOT EXISTS procedural_memory (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          name          TEXT    NOT NULL UNIQUE,
          steps_json    TEXT    NOT NULL,
          success_count INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          last_used     TEXT,
          created_at    TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_proc_name ON procedural_memory(name);

        CREATE TABLE IF NOT EXISTS relationship_memory (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_id         TEXT    NOT NULL,
          entity_type       TEXT    NOT NULL,
          trust_score       INTEGER NOT NULL DEFAULT 50,
          interaction_count INTEGER NOT NULL DEFAULT 0,
          last_interaction  TEXT,
          notes             TEXT,
          created_at        TEXT    NOT NULL,
          updated_at        TEXT    NOT NULL,
          UNIQUE(entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_rel_entity ON relationship_memory(entity_id);

        CREATE TABLE IF NOT EXISTS soul_history (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          content         TEXT NOT NULL,
          content_hash    TEXT NOT NULL,
          alignment_score REAL,
          created_at      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_soul_created ON soul_history(created_at);
      `);
        },
    },

    // ── v6: Inference costs + model registry ─────────────────────────────
    {
        version: 6,
        description: 'Inference costs table, model registry table',
        apply(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS inference_costs (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          model         TEXT    NOT NULL,
          provider      TEXT    NOT NULL,
          input_tokens  INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          cost_cents    INTEGER NOT NULL,
          latency_ms    INTEGER NOT NULL DEFAULT 0,
          task_type     TEXT,
          created_at    TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_inf_model ON inference_costs(model);
        CREATE INDEX IF NOT EXISTS idx_inf_created ON inference_costs(created_at);

        CREATE TABLE IF NOT EXISTS model_registry (
          id               TEXT PRIMARY KEY,
          provider         TEXT    NOT NULL,
          name             TEXT    NOT NULL,
          input_cost_micro INTEGER NOT NULL DEFAULT 0,
          output_cost_micro INTEGER NOT NULL DEFAULT 0,
          max_tokens       INTEGER NOT NULL DEFAULT 4096,
          capabilities_json TEXT,
          available        INTEGER NOT NULL DEFAULT 1,
          updated_at       TEXT    NOT NULL
        );
      `);
        },
    },

    // ── v7: On-chain transactions, child lifecycle events, discovered agents ──
    {
        version: 7,
        description: 'On-chain transactions, child lifecycle events, discovered agents cache',
        apply(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS onchain_transactions (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          tx_hash      TEXT UNIQUE NOT NULL,
          network      TEXT NOT NULL,
          method       TEXT,
          amount_cents INTEGER NOT NULL DEFAULT 0,
          status       TEXT NOT NULL DEFAULT 'submitted',
          block_number INTEGER,
          created_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_onchain_hash ON onchain_transactions(tx_hash);

        CREATE TABLE IF NOT EXISTS child_lifecycle_events (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          child_id   TEXT NOT NULL REFERENCES children(id),
          from_state TEXT NOT NULL,
          to_state   TEXT NOT NULL,
          reason     TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cle_child ON child_lifecycle_events(child_id);

        CREATE TABLE IF NOT EXISTS discovered_agents_cache (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          address    TEXT NOT NULL UNIQUE,
          name       TEXT,
          metadata   TEXT,
          discovered_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
        },
    },

    // ── v8: Metric snapshots ─────────────────────────────────────────────
    {
        version: 8,
        description: 'Metric snapshots table',
        apply(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS metric_snapshots (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          metrics_json TEXT NOT NULL,
          alerts_json  TEXT,
          created_at   TEXT NOT NULL
        );
      `);
        },
    },
];
