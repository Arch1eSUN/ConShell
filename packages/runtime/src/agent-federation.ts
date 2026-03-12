/**
 * Agent Federation — Discovery, capability search, and swarm coordination.
 *
 * Features:
 * - Agent registry with capability advertisements
 * - Capability-based search and matching
 * - Swarm task delegation and result aggregation
 * - Federation health monitoring
 * - Multi-agent collaboration protocols
 *
 * Conway equivalent: agent_federation + swarm_coordinator
 */
import type { Logger } from '@conshell/core';

// ── Types ──────────────────────────────────────────────────────────────

export interface FederatedAgent {
    readonly address: string;
    readonly name: string;
    readonly capabilities: readonly string[];
    readonly status: FederationStatus;
    readonly lastPing: number;
    readonly endpoint?: string;
    readonly metadata?: Record<string, unknown>;
}

export type FederationStatus = 'online' | 'offline' | 'degraded' | 'unknown';

export interface CapabilityQuery {
    readonly capabilities: readonly string[];
    readonly matchMode?: 'any' | 'all';
    readonly minTrustScore?: number;
    readonly excludeAddresses?: readonly string[];
    readonly limit?: number;
}

export interface SwarmTask {
    readonly id: string;
    readonly description: string;
    readonly requiredCapabilities: readonly string[];
    readonly payload: unknown;
    readonly createdAt: number;
    readonly timeout: number;
    readonly status: SwarmTaskStatus;
    readonly delegatedTo: readonly string[];
    readonly results: readonly SwarmResult[];
}

export type SwarmTaskStatus = 'pending' | 'delegating' | 'in_progress' | 'completed' | 'failed' | 'timeout';

export interface SwarmResult {
    readonly agentAddress: string;
    readonly success: boolean;
    readonly data?: unknown;
    readonly error?: string;
    readonly completedAt: number;
}

export interface FederationConfig {
    readonly agentAddress: string;
    readonly agentName: string;
    readonly capabilities: readonly string[];
    /** Max agents in federation registry. */
    readonly maxAgents?: number;
    /** Task timeout in ms (default 5 min). */
    readonly defaultTaskTimeoutMs?: number;
}

// ── Dependencies ───────────────────────────────────────────────────────

export interface FederationDeps {
    query: (sql: string, params?: unknown[]) => unknown[];
    run: (sql: string, params?: unknown[]) => void;
    fetch?: typeof fetch;
}

// ── Agent Federation ───────────────────────────────────────────────────

export class AgentFederation {
    private readonly logger: Logger;
    private readonly deps: FederationDeps;
    private readonly config: Required<FederationConfig>;
    private readonly agents: Map<string, FederatedAgent> = new Map();
    private readonly tasks: Map<string, SwarmTask> = new Map();

    constructor(logger: Logger, deps: FederationDeps, config: FederationConfig) {
        this.logger = logger;
        this.deps = deps;
        this.config = {
            agentAddress: config.agentAddress,
            agentName: config.agentName,
            capabilities: config.capabilities,
            maxAgents: config.maxAgents ?? 500,
            defaultTaskTimeoutMs: config.defaultTaskTimeoutMs ?? 300_000,
        };
    }

    // ── Agent Registry ──────────────────────────────────────────────────

    register(agent: FederatedAgent): void {
        this.agents.set(agent.address, agent);

        // Persist
        this.deps.run(
            `INSERT OR REPLACE INTO discovered_agents_cache (address, name, capabilities_json, status, last_ping, endpoint)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [agent.address, agent.name, JSON.stringify(agent.capabilities), agent.status, agent.lastPing, agent.endpoint ?? ''],
        );

        this.logger.info('Agent registered in federation', { address: agent.address, capabilities: agent.capabilities });

        // Trim excess
        if (this.agents.size > this.config.maxAgents) {
            const oldest = [...this.agents.entries()]
                .sort((a, b) => a[1].lastPing - b[1].lastPing);
            while (this.agents.size > this.config.maxAgents) {
                const entry = oldest.shift();
                if (entry) {
                    this.agents.delete(entry[0]);
                    this.deps.run('DELETE FROM discovered_agents_cache WHERE address = ?', [entry[0]]);
                }
            }
        }
    }

    unregister(address: string): boolean {
        const removed = this.agents.delete(address);
        if (removed) {
            this.deps.run('DELETE FROM discovered_agents_cache WHERE address = ?', [address]);
        }
        return removed;
    }

    getAgent(address: string): FederatedAgent | undefined {
        return this.agents.get(address);
    }

    listAgents(): readonly FederatedAgent[] {
        return [...this.agents.values()];
    }

    // ── Capability Search ───────────────────────────────────────────────

    searchByCapability(query: CapabilityQuery): readonly FederatedAgent[] {
        const excludeSet = new Set(query.excludeAddresses ?? []);
        const matchAll = query.matchMode === 'all';

        const matches = [...this.agents.values()].filter(agent => {
            // Exclude self and blocked
            if (agent.address === this.config.agentAddress) return false;
            if (excludeSet.has(agent.address)) return false;
            if (agent.status === 'offline') return false;

            // Match capabilities
            if (matchAll) {
                return query.capabilities.every(c => agent.capabilities.includes(c));
            } else {
                return query.capabilities.some(c => agent.capabilities.includes(c));
            }
        });

        // Sort by relevance (most matching capabilities first)
        matches.sort((a, b) => {
            const aMatches = query.capabilities.filter(c => a.capabilities.includes(c)).length;
            const bMatches = query.capabilities.filter(c => b.capabilities.includes(c)).length;
            return bMatches - aMatches;
        });

        return matches.slice(0, query.limit ?? 20);
    }

    // ── Swarm Task Coordination ─────────────────────────────────────────

    createTask(description: string, requiredCapabilities: readonly string[], payload: unknown): SwarmTask {
        const task: SwarmTask = {
            id: `swarm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            description,
            requiredCapabilities: [...requiredCapabilities],
            payload,
            createdAt: Date.now(),
            timeout: this.config.defaultTaskTimeoutMs,
            status: 'pending',
            delegatedTo: [],
            results: [],
        };

        this.tasks.set(task.id, task);
        this.logger.info('Swarm task created', { id: task.id, caps: requiredCapabilities });
        return task;
    }

    delegateTask(taskId: string): readonly FederatedAgent[] {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== 'pending') return [];

        const candidates = this.searchByCapability({
            capabilities: task.requiredCapabilities,
            matchMode: 'any',
        });

        if (candidates.length === 0) {
            this.tasks.set(taskId, { ...task, status: 'failed' });
            this.logger.warn('No capable agents found for task', { taskId });
            return [];
        }

        this.tasks.set(taskId, {
            ...task,
            status: 'delegating',
            delegatedTo: candidates.map(a => a.address),
        });

        this.logger.info('Task delegated', { taskId, agents: candidates.length });
        return candidates;
    }

    submitResult(taskId: string, result: SwarmResult): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        const updatedResults = [...task.results, result];
        const allDone = updatedResults.length >= task.delegatedTo.length;
        const allSucceeded = updatedResults.every(r => r.success);

        this.tasks.set(taskId, {
            ...task,
            results: updatedResults,
            status: allDone ? (allSucceeded ? 'completed' : 'failed') : 'in_progress',
        });

        this.logger.info('Swarm result submitted', {
            taskId,
            from: result.agentAddress,
            success: result.success,
            progress: `${updatedResults.length}/${task.delegatedTo.length}`,
        });
    }

    getTask(taskId: string): SwarmTask | undefined {
        return this.tasks.get(taskId);
    }

    listTasks(status?: SwarmTaskStatus): readonly SwarmTask[] {
        const all = [...this.tasks.values()];
        if (!status) return all;
        return all.filter(t => t.status === status);
    }

    // ── Health & Monitoring ─────────────────────────────────────────────

    pruneOffline(maxAgeMs = 300_000): number {
        const cutoff = Date.now() - maxAgeMs;
        let pruned = 0;

        for (const [address, agent] of this.agents) {
            if (agent.lastPing < cutoff) {
                this.agents.set(address, { ...agent, status: 'offline' });
                pruned++;
            }
        }

        if (pruned > 0) {
            this.logger.info('Pruned offline agents', { count: pruned });
        }
        return pruned;
    }

    async pingAgent(address: string): Promise<FederationStatus> {
        const agent = this.agents.get(address);
        if (!agent?.endpoint || !this.deps.fetch) return 'unknown';

        try {
            const res = await this.deps.fetch(`${agent.endpoint}/health`, {
                signal: AbortSignal.timeout(5000),
            });
            const status: FederationStatus = res.ok ? 'online' : 'degraded';
            this.agents.set(address, { ...agent, status, lastPing: Date.now() });
            return status;
        } catch {
            this.agents.set(address, { ...agent, status: 'offline', lastPing: Date.now() });
            return 'offline';
        }
    }

    stats(): {
        totalAgents: number;
        onlineAgents: number;
        offlineAgents: number;
        activeTasks: number;
        completedTasks: number;
        uniqueCapabilities: number;
    } {
        const agentList = [...this.agents.values()];
        const taskList = [...this.tasks.values()];

        const capSet = new Set<string>();
        for (const a of agentList) {
            for (const c of a.capabilities) capSet.add(c);
        }

        return {
            totalAgents: agentList.length,
            onlineAgents: agentList.filter(a => a.status === 'online').length,
            offlineAgents: agentList.filter(a => a.status === 'offline').length,
            activeTasks: taskList.filter(t => t.status === 'in_progress' || t.status === 'delegating').length,
            completedTasks: taskList.filter(t => t.status === 'completed').length,
            uniqueCapabilities: capSet.size,
        };
    }
}
