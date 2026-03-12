/**
 * Social Layer — Relay polling, reputation tracking, and peer messaging.
 *
 * Features:
 * - Social relay polling (discover other agents)
 * - Reputation / trust score management
 * - Peer-to-peer messaging (inbox/outbox)
 * - Agent profile broadcasting
 * - Network topology awareness
 *
 * Conway equivalent: social_relay + reputation_engine + peer_messaging
 */
import type { Logger } from '@conshell/core';

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentProfile {
    readonly address: string;
    readonly name: string;
    readonly description?: string;
    readonly capabilities: readonly string[];
    readonly trustScore: number;
    readonly lastSeen: number;
    readonly metadata?: Record<string, unknown>;
}

export interface PeerMessage {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly content: string;
    readonly signature?: string;
    readonly timestamp: number;
    readonly state: MessageState;
}

export type MessageState = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ReputationEntry {
    readonly agentAddress: string;
    readonly trustScore: number;
    readonly interactionCount: number;
    readonly successCount: number;
    readonly failureCount: number;
    readonly lastInteraction: number;
    readonly notes: string[];
}

export interface SocialLayerConfig {
    /** Relay endpoint URL. */
    relayUrl?: string;
    /** Polling interval in ms (default 60s). */
    pollIntervalMs?: number;
    /** Agent's own address. */
    agentAddress: string;
    /** Agent's display name. */
    agentName: string;
    /** Max discovered agents to cache. */
    maxDiscoveredAgents?: number;
}

// ── Dependencies ───────────────────────────────────────────────────────

export interface SocialLayerDeps {
    query: (sql: string, params?: unknown[]) => unknown[];
    run: (sql: string, params?: unknown[]) => void;
    /** HTTP fetch (for relay polling). */
    fetch?: typeof fetch;
}

// ── Social Layer ───────────────────────────────────────────────────────

export class SocialLayer {
    private readonly logger: Logger;
    private readonly deps: SocialLayerDeps;
    private readonly config: Required<SocialLayerConfig>;
    private readonly knownAgents: Map<string, AgentProfile> = new Map();
    private readonly reputation: Map<string, ReputationEntry> = new Map();
    private pollTimer: ReturnType<typeof setInterval> | null = null;

    constructor(logger: Logger, deps: SocialLayerDeps, config: SocialLayerConfig) {
        this.logger = logger;
        this.deps = deps;
        this.config = {
            relayUrl: config.relayUrl ?? '',
            pollIntervalMs: config.pollIntervalMs ?? 60_000,
            agentAddress: config.agentAddress,
            agentName: config.agentName,
            maxDiscoveredAgents: config.maxDiscoveredAgents ?? 200,
        };
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    start(): void {
        if (this.config.relayUrl) {
            this.pollTimer = setInterval(() => this.pollRelay(), this.config.pollIntervalMs);
            this.logger.info('Social layer started', { relayUrl: this.config.relayUrl });
        } else {
            this.logger.warn('Social layer started without relay URL — discovery disabled');
        }
    }

    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.logger.info('Social layer stopped');
    }

    // ── Agent Discovery ─────────────────────────────────────────────────

    async pollRelay(): Promise<readonly AgentProfile[]> {
        if (!this.config.relayUrl || !this.deps.fetch) return [];

        try {
            const res = await this.deps.fetch(`${this.config.relayUrl}/agents`, {
                headers: { 'X-Agent-Address': this.config.agentAddress },
            });
            if (!res.ok) {
                this.logger.warn('Relay poll failed', { status: res.status });
                return [];
            }

            const agents = (await res.json()) as AgentProfile[];
            for (const agent of agents) {
                if (agent.address !== this.config.agentAddress) {
                    this.knownAgents.set(agent.address, agent);
                }
            }

            // Trim cache
            if (this.knownAgents.size > this.config.maxDiscoveredAgents) {
                const oldest = [...this.knownAgents.entries()]
                    .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
                while (this.knownAgents.size > this.config.maxDiscoveredAgents) {
                    const entry = oldest.shift();
                    if (entry) this.knownAgents.delete(entry[0]);
                }
            }

            this.logger.debug('Relay polled', { discovered: agents.length, total: this.knownAgents.size });
            return agents;
        } catch (err) {
            this.logger.error('Relay poll error', { error: String(err) });
            return [];
        }
    }

    async broadcastProfile(): Promise<boolean> {
        if (!this.config.relayUrl || !this.deps.fetch) return false;

        try {
            const profile: AgentProfile = {
                address: this.config.agentAddress,
                name: this.config.agentName,
                capabilities: [],
                trustScore: 100,
                lastSeen: Date.now(),
            };

            const res = await this.deps.fetch(`${this.config.relayUrl}/agents/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(profile),
            });

            return res.ok;
        } catch {
            return false;
        }
    }

    getDiscoveredAgents(): readonly AgentProfile[] {
        return [...this.knownAgents.values()];
    }

    getAgent(address: string): AgentProfile | undefined {
        return this.knownAgents.get(address);
    }

    // ── Reputation Management ───────────────────────────────────────────

    recordInteraction(agentAddress: string, success: boolean, notes?: string): void {
        const existing = this.reputation.get(agentAddress) ?? {
            agentAddress,
            trustScore: 50,
            interactionCount: 0,
            successCount: 0,
            failureCount: 0,
            lastInteraction: 0,
            notes: [],
        };

        const entry: ReputationEntry = {
            agentAddress,
            interactionCount: existing.interactionCount + 1,
            successCount: existing.successCount + (success ? 1 : 0),
            failureCount: existing.failureCount + (success ? 0 : 1),
            lastInteraction: Date.now(),
            notes: notes ? [...existing.notes.slice(-9), notes] : existing.notes,
            trustScore: this.calculateTrust(
                existing.successCount + (success ? 1 : 0),
                existing.failureCount + (success ? 0 : 1),
            ),
        };

        this.reputation.set(agentAddress, entry);
    }

    getTrust(agentAddress: string): number {
        return this.reputation.get(agentAddress)?.trustScore ?? 50;
    }

    getReputation(agentAddress: string): ReputationEntry | undefined {
        return this.reputation.get(agentAddress);
    }

    getAllReputations(): readonly ReputationEntry[] {
        return [...this.reputation.values()].sort((a, b) => b.trustScore - a.trustScore);
    }

    // ── Messaging ───────────────────────────────────────────────────────

    async sendMessage(to: string, content: string): Promise<PeerMessage> {
        const msg: PeerMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            from: this.config.agentAddress,
            to,
            content,
            timestamp: Date.now(),
            state: 'pending',
        };

        // Try relay delivery
        if (this.config.relayUrl && this.deps.fetch) {
            try {
                const res = await this.deps.fetch(`${this.config.relayUrl}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(msg),
                });
                if (res.ok) {
                    return { ...msg, state: 'sent' };
                }
            } catch {
                // Fall through to store as pending
            }
        }

        // Store locally for later delivery
        this.deps.run(
            `INSERT INTO inbox_messages (id, from_address, content, signature, state, created_at)
             VALUES (?, ?, ?, NULL, 'pending', ?)`,
            [msg.id, msg.to, content, new Date().toISOString()],
        );

        return msg;
    }

    getInbox(limit = 20): readonly PeerMessage[] {
        const rows = this.deps.query(
            `SELECT * FROM inbox_messages WHERE state != 'processed' ORDER BY created_at DESC LIMIT ?`,
            [limit],
        ) as Array<Record<string, unknown>>;

        return rows.map(r => ({
            id: String(r['id']),
            from: String(r['from_address']),
            to: this.config.agentAddress,
            content: String(r['content']),
            signature: r['signature'] ? String(r['signature']) : undefined,
            timestamp: new Date(String(r['created_at'])).getTime(),
            state: (r['state'] as MessageState) ?? 'received',
        }));
    }

    markRead(messageId: string): void {
        this.deps.run(`UPDATE inbox_messages SET state = 'processed', processed_at = ? WHERE id = ?`, [new Date().toISOString(), messageId]);
    }

    // ── Stats ───────────────────────────────────────────────────────────

    stats(): { discoveredAgents: number; reputationEntries: number; pendingMessages: number } {
        const pending = this.deps.query(
            `SELECT COUNT(*) as cnt FROM inbox_messages WHERE state = 'received'`,
            [],
        ) as Array<{ cnt: number }>;

        return {
            discoveredAgents: this.knownAgents.size,
            reputationEntries: this.reputation.size,
            pendingMessages: pending[0]?.cnt ?? 0,
        };
    }

    // ── Private ─────────────────────────────────────────────────────────

    private calculateTrust(successes: number, failures: number): number {
        const total = successes + failures;
        if (total === 0) return 50;
        // Wilson score lower bound (simplified)
        const ratio = successes / total;
        const score = ratio * 100;
        // Confidence factor - more interactions = more reliable
        const confidence = Math.min(1, total / 20);
        return Math.round(50 + (score - 50) * confidence);
    }
}
