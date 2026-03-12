/**
 * TaskQueue — Persistent async task system for user-delegated goals.
 *
 * Enables the agent to accept long-running tasks from users (e.g., "register on evomap
 * and notify me"), execute them asynchronously in the background, and report results
 * back via WebSocket push.
 *
 * Tasks flow: pending → running → completed | failed
 */
import type { Logger } from '@conshell/core';
import { EventEmitter } from 'node:events';

/** Minimal DB interface for task persistence */
export interface TaskDb {
    run(sql: string, params?: unknown[]): void;
    all(sql: string, params?: unknown[]): unknown[];
}

// ── Types ─────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentTask {
    readonly id: string;
    readonly goal: string;
    readonly createdAt: number;
    status: TaskStatus;
    progress: string;
    result?: string;
    error?: string;
    startedAt?: number;
    completedAt?: number;
}

export interface TaskQueueEvents {
    'task:created': (task: AgentTask) => void;
    'task:started': (task: AgentTask) => void;
    'task:progress': (task: AgentTask) => void;
    'task:completed': (task: AgentTask) => void;
    'task:failed': (task: AgentTask) => void;
}

// ── TaskQueue ─────────────────────────────────────────────────────────

export class TaskQueue extends EventEmitter {
    private readonly tasks: Map<string, AgentTask> = new Map();
    private counter = 0;

    constructor(
        private readonly logger: Logger,
        private readonly db?: TaskDb,
    ) {
        super();
        this.loadFromDb();
    }

    /**
     * Enqueue a new task from a user goal.
     */
    enqueue(goal: string): AgentTask {
        const id = `task_${Date.now()}_${++this.counter}`;
        const task: AgentTask = {
            id,
            goal,
            createdAt: Date.now(),
            status: 'pending',
            progress: 'Waiting in queue…',
        };
        this.tasks.set(id, task);
        this.persistTask(task);
        this.emit('task:created', task);
        this.logger.info('Task enqueued', { id, goal: goal.slice(0, 80) });
        return task;
    }

    /**
     * Get the next pending task.
     */
    dequeue(): AgentTask | undefined {
        for (const task of this.tasks.values()) {
            if (task.status === 'pending') return task;
        }
        return undefined;
    }

    /**
     * Mark a task as started.
     */
    markRunning(id: string, progress = 'Starting execution…'): void {
        const task = this.tasks.get(id);
        if (!task) return;
        task.status = 'running';
        task.progress = progress;
        task.startedAt = Date.now();
        this.persistTask(task);
        this.emit('task:started', task);
    }

    /**
     * Update task progress.
     */
    updateProgress(id: string, progress: string): void {
        const task = this.tasks.get(id);
        if (!task) return;
        task.progress = progress;
        this.persistTask(task);
        this.emit('task:progress', task);
    }

    /**
     * Mark a task as completed.
     */
    markCompleted(id: string, result: string): void {
        const task = this.tasks.get(id);
        if (!task) return;
        task.status = 'completed';
        task.result = result;
        task.progress = 'Done';
        task.completedAt = Date.now();
        this.persistTask(task);
        this.emit('task:completed', task);
        this.logger.info('Task completed', { id, elapsed: task.completedAt - (task.startedAt ?? task.createdAt) });
    }

    /**
     * Mark a task as failed.
     */
    markFailed(id: string, error: string): void {
        const task = this.tasks.get(id);
        if (!task) return;
        task.status = 'failed';
        task.error = error;
        task.progress = 'Failed';
        task.completedAt = Date.now();
        this.persistTask(task);
        this.emit('task:failed', task);
        this.logger.warn('Task failed', { id, error: error.slice(0, 200) });
    }

    /**
     * Cancel a pending/running task.
     */
    cancel(id: string): boolean {
        const task = this.tasks.get(id);
        if (!task || (task.status !== 'pending' && task.status !== 'running')) return false;
        task.status = 'cancelled';
        task.progress = 'Cancelled by user';
        task.completedAt = Date.now();
        this.persistTask(task);
        return true;
    }

    /**
     * List all tasks (optionally filter by status).
     */
    list(status?: TaskStatus): AgentTask[] {
        const all = [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
        return status ? all.filter(t => t.status === status) : all;
    }

    /**
     * Get a task by ID.
     */
    get(id: string): AgentTask | undefined {
        return this.tasks.get(id);
    }

    /**
     * Number of pending tasks.
     */
    get pendingCount(): number {
        return this.list('pending').length;
    }

    /**
     * Number of running tasks.
     */
    get runningCount(): number {
        return this.list('running').length;
    }

    // ── Persistence ──────────────────────────────────────────────────────

    private persistTask(task: AgentTask): void {
        if (!this.db) return;
        try {
            this.db.run(
                `INSERT OR REPLACE INTO agent_tasks (id, goal, status, progress, result, error, created_at, started_at, completed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [task.id, task.goal, task.status, task.progress, task.result ?? null, task.error ?? null,
                 task.createdAt, task.startedAt ?? null, task.completedAt ?? null],
            );
        } catch {
            // Silently handle — DB may not have the table yet
        }
    }

    private loadFromDb(): void {
        if (!this.db) return;
        try {
            // Ensure table exists
            this.db.run(`
                CREATE TABLE IF NOT EXISTS agent_tasks (
                    id TEXT PRIMARY KEY,
                    goal TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    progress TEXT DEFAULT '',
                    result TEXT,
                    error TEXT,
                    created_at INTEGER NOT NULL,
                    started_at INTEGER,
                    completed_at INTEGER
                )
            `);
            const rows = this.db.all('SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT 100') as Record<string, unknown>[];
            for (const row of rows) {
                const id = row['id'] as string;
                this.tasks.set(id, {
                    id,
                    goal: row['goal'] as string,
                    status: row['status'] as TaskStatus,
                    progress: (row['progress'] as string) ?? '',
                    result: (row['result'] as string) ?? undefined,
                    error: (row['error'] as string) ?? undefined,
                    createdAt: (row['created_at'] as number) ?? Date.now(),
                    startedAt: (row['started_at'] as number) ?? undefined,
                    completedAt: (row['completed_at'] as number) ?? undefined,
                });
            }
            if (this.tasks.size > 0) {
                this.logger.info('Tasks loaded from DB', { count: this.tasks.size });
            }
        } catch {
            // First-run: table doesn't exist yet, that's fine
        }
    }
}
