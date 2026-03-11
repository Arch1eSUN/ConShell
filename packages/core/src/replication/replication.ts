/**
 * Self-Replication — Child agent lifecycle management.
 *
 * Lifecycle: spawning → provisioning → configuring → starting → alive → unhealthy → recovering → dead
 *
 * Features:
 * - Spawn child agents as local subprocess or remote (Conway sandbox)
 * - Genesis config injection with validation
 * - Constitution propagation (hash-verified)
 * - Health monitoring via heartbeat
 * - Parent-child messaging with rate limits
 * - Automatic cleanup of dead children
 */

import { createHash, randomBytes } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────

export type ChildState =
    | 'spawning'
    | 'provisioning'
    | 'configuring'
    | 'starting'
    | 'alive'
    | 'unhealthy'
    | 'recovering'
    | 'dead';

export interface GenesisConfig {
    readonly name: string;
    readonly prompt: string;
    readonly parentAddress: string;
    readonly constitutionHash: string;
    readonly initialCredits: number;
    readonly capabilities?: readonly string[];
}

export interface ChildAgent {
    readonly id: string;
    readonly name: string;
    state: ChildState;
    readonly genesisConfig: GenesisConfig;
    readonly createdAt: number;
    lastHeartbeat: number;
    failedHeartbeats: number;
    readonly endpoint?: string;
    readonly pid?: number;
}

export interface ChildMessage {
    readonly from: string; // parent or child id
    readonly to: string;
    readonly content: string;
    readonly timestamp: number;
    readonly signature?: string;
}

export interface ReplicationManagerConfig {
    /** Max number of children (default 3) */
    readonly maxChildren?: number;
    /** Max genesis prompt length (default 2000) */
    readonly maxGenesisLength?: number;
    /** Heartbeat interval ms (default 120000 = 2 min) */
    readonly heartbeatIntervalMs?: number;
    /** Failed heartbeats before unhealthy (default 3) */
    readonly unhealthyThreshold?: number;
    /** Failed heartbeats before dead (default 10) */
    readonly deadThreshold?: number;
    /** Max messages per hour per child (default 60) */
    readonly maxMessagesPerHour?: number;
    /** Max message size bytes (default 4096) */
    readonly maxMessageSize?: number;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<ReplicationManagerConfig> = {
    maxChildren: 3,
    maxGenesisLength: 2000,
    heartbeatIntervalMs: 120_000,
    unhealthyThreshold: 3,
    deadThreshold: 10,
    maxMessagesPerHour: 60,
    maxMessageSize: 4096,
};

// ── Validation ─────────────────────────────────────────────────────────

export interface GenesisValidation {
    readonly valid: boolean;
    readonly errors: string[];
}

export function validateGenesis(config: GenesisConfig, maxPromptLength: number): GenesisValidation {
    const errors: string[] = [];

    if (!config.name || config.name.trim().length === 0) {
        errors.push('Child name is required');
    }
    if (config.name.length > 64) {
        errors.push('Child name must be ≤ 64 characters');
    }
    if (!config.prompt || config.prompt.trim().length === 0) {
        errors.push('Genesis prompt is required');
    }
    if (config.prompt.length > maxPromptLength) {
        errors.push(`Genesis prompt exceeds max length of ${maxPromptLength}`);
    }
    if (!config.parentAddress || !/^0x[0-9a-fA-F]{40}$/.test(config.parentAddress)) {
        errors.push('Parent address must be a valid Ethereum address');
    }
    if (!config.constitutionHash || !/^[a-f0-9]{64}$/.test(config.constitutionHash)) {
        errors.push('Constitution hash must be a valid SHA-256 hex');
    }
    if (config.initialCredits < 0) {
        errors.push('Initial credits must be non-negative');
    }

    return { valid: errors.length === 0, errors };
}

// ── ReplicationManager ─────────────────────────────────────────────────

export class ReplicationManager {
    private readonly config: Required<ReplicationManagerConfig>;
    private readonly children = new Map<string, ChildAgent>();
    private readonly messageLog: ChildMessage[] = [];

    constructor(config?: ReplicationManagerConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Spawn a new child agent.
     * Returns the child's unique ID or throws if limits exceeded.
     */
    spawn(genesis: GenesisConfig): ChildAgent {
        // Limit check
        const alive = this.listAlive();
        if (alive.length >= this.config.maxChildren) {
            throw new Error(
                `Cannot spawn: already at max children (${this.config.maxChildren}). Kill a child first.`,
            );
        }

        // Validate genesis
        const validation = validateGenesis(genesis, this.config.maxGenesisLength);
        if (!validation.valid) {
            throw new Error(`Invalid genesis config: ${validation.errors.join(', ')}`);
        }

        const id = randomBytes(8).toString('hex');
        const child: ChildAgent = {
            id,
            name: genesis.name,
            state: 'spawning',
            genesisConfig: genesis,
            createdAt: Date.now(),
            lastHeartbeat: Date.now(),
            failedHeartbeats: 0,
        };

        this.children.set(id, child);
        return child;
    }

    /** Transition a child through lifecycle states */
    transition(childId: string, newState: ChildState): void {
        const child = this.children.get(childId);
        if (!child) throw new Error(`Unknown child: ${childId}`);

        const allowed = this.getAllowedTransitions(child.state);
        if (!allowed.includes(newState)) {
            throw new Error(`Invalid transition: ${child.state} → ${newState}`);
        }

        child.state = newState;
        if (newState === 'alive') {
            child.lastHeartbeat = Date.now();
            child.failedHeartbeats = 0;
        }
    }

    /** Process a heartbeat for a child */
    heartbeat(childId: string, success: boolean): void {
        const child = this.children.get(childId);
        if (!child) return;

        if (success) {
            child.lastHeartbeat = Date.now();
            child.failedHeartbeats = 0;
            if (child.state === 'unhealthy' || child.state === 'recovering') {
                child.state = 'alive';
            }
        } else {
            child.failedHeartbeats++;
            if (child.failedHeartbeats >= this.config.deadThreshold) {
                child.state = 'dead';
            } else if (child.failedHeartbeats >= this.config.unhealthyThreshold) {
                child.state = 'unhealthy';
            }
        }
    }

    /** Send a message from parent to child */
    sendMessage(childId: string, content: string): ChildMessage {
        const child = this.children.get(childId);
        if (!child) throw new Error(`Unknown child: ${childId}`);

        if (content.length > this.config.maxMessageSize) {
            throw new Error(`Message exceeds max size (${this.config.maxMessageSize} bytes)`);
        }

        // Rate limit
        const hourAgo = Date.now() - 3600_000;
        const recentMessages = this.messageLog.filter(
            m => m.to === childId && m.timestamp > hourAgo,
        );
        if (recentMessages.length >= this.config.maxMessagesPerHour) {
            throw new Error(`Rate limit: max ${this.config.maxMessagesPerHour} messages/hour`);
        }

        const message: ChildMessage = {
            from: 'parent',
            to: childId,
            content,
            timestamp: Date.now(),
        };

        this.messageLog.push(message);
        return message;
    }

    /** Kill a child — transition to dead */
    kill(childId: string): void {
        const child = this.children.get(childId);
        if (!child) throw new Error(`Unknown child: ${childId}`);
        child.state = 'dead';
    }

    /** Clean up dead children */
    cleanup(): number {
        let removed = 0;
        for (const [id, child] of this.children) {
            if (child.state === 'dead') {
                this.children.delete(id);
                removed++;
            }
        }
        return removed;
    }

    /** Find a child by ID */
    find(childId: string): ChildAgent | undefined {
        return this.children.get(childId);
    }

    /** List all children */
    list(): readonly ChildAgent[] {
        return [...this.children.values()];
    }

    /** List only alive children */
    listAlive(): readonly ChildAgent[] {
        return [...this.children.values()].filter(
            c => c.state !== 'dead',
        );
    }

    /** Get message history for a child */
    getMessages(childId: string): readonly ChildMessage[] {
        return this.messageLog.filter(
            m => m.from === childId || m.to === childId,
        );
    }

    // ── Private ────────────────────────────────────────────────────────

    private getAllowedTransitions(current: ChildState): ChildState[] {
        const transitions: Record<ChildState, ChildState[]> = {
            spawning: ['provisioning', 'dead'],
            provisioning: ['configuring', 'dead'],
            configuring: ['starting', 'dead'],
            starting: ['alive', 'dead'],
            alive: ['unhealthy', 'dead'],
            unhealthy: ['recovering', 'alive', 'dead'],
            recovering: ['alive', 'dead'],
            dead: [],
        };
        return transitions[current];
    }
}

/**
 * Hash a constitution string for propagation verification.
 */
export function hashConstitution(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}
