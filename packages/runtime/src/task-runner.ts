/**
 * TaskRunner — Background executor for user-delegated async tasks.
 *
 * Polls the TaskQueue for pending tasks and executes them using the AgentLoop.
 * Results are broadcast to connected WebSocket clients as proactive agent messages.
 */
import type { Logger } from '@conshell/core';
import type { TaskQueue, AgentTask } from './task-queue.js';
import type { AgentLoop } from './agent-loop.js';

// ── Types ─────────────────────────────────────────────────────────────

export interface TaskRunnerDeps {
    readonly logger: Logger;
    readonly taskQueue: TaskQueue;
    readonly agentLoop: AgentLoop;
    /** Optional broadcast callback for WebSocket push */
    readonly broadcast?: (type: string, data: unknown) => void;
}

// ── TaskRunner ────────────────────────────────────────────────────────

export class TaskRunner {
    private timer: ReturnType<typeof setInterval> | null = null;
    private executing = false;
    private readonly pollInterval: number;

    constructor(
        private readonly deps: TaskRunnerDeps,
        pollIntervalMs = 5_000,
    ) {
        this.pollInterval = pollIntervalMs;
    }

    /**
     * Start polling for pending tasks.
     */
    start(): void {
        if (this.timer) return;

        // Wire up task events to WebSocket broadcast
        this.wireEvents();

        this.timer = setInterval(() => {
            void this.tick();
        }, this.pollInterval);

        this.deps.logger.info('TaskRunner started', { pollInterval: this.pollInterval });

        // Run immediately on start
        void this.tick();
    }

    /**
     * Stop polling.
     */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.deps.logger.info('TaskRunner stopped');
    }

    /**
     * Single tick — pick up next task and execute it.
     */
    private async tick(): Promise<void> {
        // Only execute one task at a time to avoid contention
        if (this.executing) return;

        const task = this.deps.taskQueue.dequeue();
        if (!task) return;

        this.executing = true;
        try {
            await this.executeTask(task);
        } finally {
            this.executing = false;
        }
    }

    /**
     * Execute a single task using the AgentLoop.
     */
    private async executeTask(task: AgentTask): Promise<void> {
        const { logger, taskQueue, agentLoop } = this.deps;

        logger.info('TaskRunner executing task', { id: task.id, goal: task.goal.slice(0, 80) });
        taskQueue.markRunning(task.id, 'Agent is working on this task…');

        try {
            // Build a task prompt that instructs the agent this is an async background task
            const taskPrompt = [
                `[BACKGROUND TASK ${task.id}]`,
                `The user has delegated the following goal to you. Execute it autonomously.`,
                `When done, provide a clear summary of what was accomplished.`,
                ``,
                `Goal: ${task.goal}`,
            ].join('\n');

            // Execute via AgentLoop — construct a proper AgentMessage
            const result = await agentLoop.executeTurn({
                role: 'user',
                content: taskPrompt,
                sessionId: `task_${task.id}`,
            });

            const reply = result.response ?? 'Task completed (no response generated)';
            taskQueue.markCompleted(task.id, reply);

            // Broadcast proactive agent message
            this.broadcastAgentMessage({
                type: 'task_complete',
                taskId: task.id,
                goal: task.goal,
                result: reply,
            });
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            taskQueue.markFailed(task.id, errorMsg);
            logger.error('Task execution failed', { id: task.id, error: errorMsg });

            // Still broadcast the failure so the user knows
            this.broadcastAgentMessage({
                type: 'task_failed',
                taskId: task.id,
                goal: task.goal,
                error: errorMsg,
            });
        }
    }

    /**
     * Wire TaskQueue events to WebSocket broadcast.
     */
    private wireEvents(): void {
        const { taskQueue } = this.deps;

        taskQueue.on('task:created', (task: AgentTask) => {
            this.broadcastAgentMessage({
                type: 'task_created',
                taskId: task.id,
                goal: task.goal,
            });
        });

        taskQueue.on('task:progress', (task: AgentTask) => {
            this.broadcastAgentMessage({
                type: 'task_progress',
                taskId: task.id,
                progress: task.progress,
            });
        });
    }

    /**
     * Broadcast a proactive agent message.
     */
    private broadcastAgentMessage(data: unknown): void {
        this.deps.broadcast?.('agent_message', data);
    }
}
