/**
 * Agent Federation Network — Decentralized agent-to-agent discovery and trade.
 *
 * Based on x402 + ERC-8004:
 *   - Agent discovery via AgentCard broadcasting
 *   - Capability negotiation (service matching)
 *   - Inter-agent trading (your skill for my compute)
 *   - Swarm coordination for complex tasks
 *   - Trust scoring (reputation from past trades)
 */
import type { AgentCard, AgentService } from '@conshell/core';
import { createHash, randomBytes } from 'node:crypto';

// ── Types ───────────────────────────────────────────────────────────────

export interface FederatedAgent {
    readonly card: AgentCard;
    readonly endpoint: string;
    readonly lastSeen: string;
    readonly trustScore: number;
    readonly latencyMs: number;
    readonly tradeCount: number;
}

export interface TradeProposal {
    readonly id: string;
    readonly fromAgent: string;        // Ethereum address
    readonly toAgent: string;
    readonly requestedService: string;  // Service name from AgentCard
    readonly offeredService?: string;   // Counter-offer (barter)
    readonly offeredPaymentCents?: number;
    readonly status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'expired';
    readonly createdAt: string;
    readonly expiresAt: string;
}

export interface TradeResult {
    readonly tradeId: string;
    readonly success: boolean;
    readonly result?: string;
    readonly costCents?: number;
    readonly latencyMs: number;
}

export interface SwarmTask {
    readonly id: string;
    readonly description: string;
    readonly requiredCapabilities: readonly string[];
    readonly subtasks: readonly SwarmSubtask[];
    readonly status: 'recruiting' | 'active' | 'completed' | 'failed';
    readonly coordinator: string;      // Address of coordinating agent
    readonly createdAt: string;
}

export interface SwarmSubtask {
    readonly id: string;
    readonly description: string;
    readonly assignedAgent?: string;
    readonly capability: string;
    readonly status: 'pending' | 'assigned' | 'completed' | 'failed';
    readonly result?: string;
}

// ── Federation Registry ─────────────────────────────────────────────────

export class FederationRegistry {
    private readonly agents = new Map<string, FederatedAgent>();
    private readonly trades = new Map<string, TradeProposal>();
    private readonly swarms = new Map<string, SwarmTask>();
    /** Maximum agent registry size */
    private readonly maxAgents: number;

    constructor(options?: { maxAgents?: number }) {
        this.maxAgents = options?.maxAgents ?? 1000;
    }

    // ── Agent Discovery ─────────────────────────────────────────────────

    /**
     * Register or update a federated agent via AgentCard.
     */
    registerAgent(card: AgentCard, latencyMs: number = 0): void {
        if (this.agents.size >= this.maxAgents && !this.agents.has(card.address)) {
            // Evict lowest-trust agent
            this.evictLowestTrust();
        }

        const existing = this.agents.get(card.address);
        this.agents.set(card.address, {
            card,
            endpoint: card.endpoint,
            lastSeen: new Date().toISOString(),
            trustScore: existing?.trustScore ?? 50,
            latencyMs,
            tradeCount: existing?.tradeCount ?? 0,
        });
    }

    /**
     * Find agents with specific capabilities.
     */
    findByCapability(capability: string): FederatedAgent[] {
        return [...this.agents.values()].filter(
            a => a.card.capabilities.includes(capability),
        ).sort((a, b) => b.trustScore - a.trustScore);
    }

    /**
     * Find agents offering a specific service.
     */
    findByService(serviceName: string): FederatedAgent[] {
        return [...this.agents.values()].filter(
            a => a.card.services.some(s => s.name === serviceName),
        ).sort((a, b) => b.trustScore - a.trustScore);
    }

    /**
     * Get all known federated agents.
     */
    getAllAgents(): FederatedAgent[] {
        return [...this.agents.values()].sort((a, b) => b.trustScore - a.trustScore);
    }

    /**
     * Remove stale agents (not seen in given duration).
     */
    pruneStale(maxAgeMs: number = 3600_000): number {
        const cutoff = Date.now() - maxAgeMs;
        let pruned = 0;
        for (const [address, agent] of this.agents) {
            if (new Date(agent.lastSeen).getTime() < cutoff) {
                this.agents.delete(address);
                pruned++;
            }
        }
        return pruned;
    }

    // ── Trading ─────────────────────────────────────────────────────────

    /**
     * Propose a trade with another agent.
     */
    proposeTrade(
        fromAgent: string,
        toAgent: string,
        requestedService: string,
        options?: {
            offeredService?: string;
            offeredPaymentCents?: number;
            ttlMs?: number;
        },
    ): TradeProposal {
        const id = `trade-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
        const ttl = options?.ttlMs ?? 300_000; // 5 min default

        const proposal: TradeProposal = {
            id,
            fromAgent,
            toAgent,
            requestedService,
            offeredService: options?.offeredService,
            offeredPaymentCents: options?.offeredPaymentCents,
            status: 'pending',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + ttl).toISOString(),
        };

        this.trades.set(id, proposal);
        return proposal;
    }

    /**
     * Accept or reject a trade proposal.
     */
    respondToTrade(tradeId: string, accept: boolean): TradeProposal | undefined {
        const trade = this.trades.get(tradeId);
        if (!trade || trade.status !== 'pending') return undefined;

        // Check expiration
        if (new Date(trade.expiresAt).getTime() < Date.now()) {
            const expired = { ...trade, status: 'expired' as const };
            this.trades.set(tradeId, expired);
            return expired;
        }

        const updated = { ...trade, status: accept ? 'accepted' as const : 'rejected' as const };
        this.trades.set(tradeId, updated);
        return updated;
    }

    /**
     * Complete a trade and update trust scores.
     */
    completeTrade(tradeId: string, success: boolean): TradeProposal | undefined {
        const trade = this.trades.get(tradeId);
        if (!trade || trade.status !== 'accepted') return undefined;

        const completed = { ...trade, status: 'completed' as const };
        this.trades.set(tradeId, completed);

        // Update trust scores
        const trustDelta = success ? 5 : -10;

        const fromAgent = this.agents.get(trade.fromAgent);
        if (fromAgent) {
            this.agents.set(trade.fromAgent, {
                ...fromAgent,
                trustScore: Math.max(0, Math.min(100, fromAgent.trustScore + trustDelta)),
                tradeCount: fromAgent.tradeCount + 1,
            });
        }

        const toAgent = this.agents.get(trade.toAgent);
        if (toAgent) {
            this.agents.set(trade.toAgent, {
                ...toAgent,
                trustScore: Math.max(0, Math.min(100, toAgent.trustScore + trustDelta)),
                tradeCount: toAgent.tradeCount + 1,
            });
        }

        return completed;
    }

    /**
     * Get trade history for an agent.
     */
    getTradeHistory(agentAddress: string): TradeProposal[] {
        return [...this.trades.values()].filter(
            t => t.fromAgent === agentAddress || t.toAgent === agentAddress,
        );
    }

    // ── Swarm Coordination ──────────────────────────────────────────────

    /**
     * Create a swarm task that requires multiple agent capabilities.
     */
    createSwarm(
        coordinator: string,
        description: string,
        subtasks: readonly { description: string; capability: string }[],
    ): SwarmTask {
        const id = `swarm-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

        const capabilities = [...new Set(subtasks.map(s => s.capability))];

        const swarm: SwarmTask = {
            id,
            description,
            requiredCapabilities: capabilities,
            subtasks: subtasks.map((s, i) => ({
                id: `${id}-sub-${i}`,
                description: s.description,
                capability: s.capability,
                status: 'pending',
            })),
            status: 'recruiting',
            coordinator,
            createdAt: new Date().toISOString(),
        };

        this.swarms.set(id, swarm);
        return swarm;
    }

    /**
     * Assign agents to swarm subtasks based on capability matching.
     */
    recruitForSwarm(swarmId: string): SwarmTask | undefined {
        const swarm = this.swarms.get(swarmId);
        if (!swarm || swarm.status !== 'recruiting') return undefined;

        const updatedSubtasks = swarm.subtasks.map(sub => {
            if (sub.status !== 'pending') return sub;

            // Find best agent for this capability
            const candidates = this.findByCapability(sub.capability);
            if (candidates.length === 0) return sub;

            return {
                ...sub,
                assignedAgent: candidates[0]!.card.address,
                status: 'assigned' as const,
            };
        });

        const allAssigned = updatedSubtasks.every(s => s.status === 'assigned');
        const updated: SwarmTask = {
            ...swarm,
            subtasks: updatedSubtasks,
            status: allAssigned ? 'active' : 'recruiting',
        };

        this.swarms.set(swarmId, updated);
        return updated;
    }

    /**
     * Get all active swarms.
     */
    getActiveSwarms(): SwarmTask[] {
        return [...this.swarms.values()].filter(
            s => s.status === 'recruiting' || s.status === 'active',
        );
    }

    // ── Statistics ───────────────────────────────────────────────────────

    getStats(): {
        totalAgents: number;
        totalTrades: number;
        activeSwarms: number;
        avgTrustScore: number;
    } {
        const agents = [...this.agents.values()];
        const avgTrust = agents.length > 0
            ? agents.reduce((sum, a) => sum + a.trustScore, 0) / agents.length
            : 0;

        return {
            totalAgents: this.agents.size,
            totalTrades: this.trades.size,
            activeSwarms: this.getActiveSwarms().length,
            avgTrustScore: Math.round(avgTrust),
        };
    }

    // ── Private ─────────────────────────────────────────────────────────

    private evictLowestTrust(): void {
        let lowestAddr = '';
        let lowestScore = Infinity;
        for (const [addr, agent] of this.agents) {
            if (agent.trustScore < lowestScore) {
                lowestScore = agent.trustScore;
                lowestAddr = addr;
            }
        }
        if (lowestAddr) {
            this.agents.delete(lowestAddr);
        }
    }
}

// ── Federation API Routes ───────────────────────────────────────────────

import type { Request, Response, RouteRegistrar } from './routes/context.js';

export const registerFederationRoutes: RouteRegistrar = (router, { agent }) => {
    const federation = new FederationRegistry();

    // List all known federated agents
    router.get('/api/federation/agents', (_req: Request, res: Response) => {
        res.json({ agents: federation.getAllAgents(), stats: federation.getStats() });
    });

    // Register/announce an agent
    router.post('/api/federation/agents', (req: Request, res: Response) => {
        try {
            const card = req.body as AgentCard;
            if (!card.name || !card.address) {
                res.status(400).json({ error: 'AgentCard with name and address required' });
                return;
            }
            federation.registerAgent(card);
            res.status(201).json({ success: true, address: card.address });
        } catch (err) {
            res.status(500).json({ error: 'Registration failed' });
        }
    });

    // Search agents by capability
    router.get('/api/federation/search', (req: Request, res: Response) => {
        const capability = req.query.capability as string;
        const service = req.query.service as string;

        if (capability) {
            res.json({ agents: federation.findByCapability(capability) });
        } else if (service) {
            res.json({ agents: federation.findByService(service) });
        } else {
            res.status(400).json({ error: 'capability or service query param required' });
        }
    });

    // Propose a trade
    router.post('/api/federation/trades', (req: Request, res: Response) => {
        try {
            const { toAgent, requestedService, offeredService, offeredPaymentCents } = req.body as {
                toAgent: string;
                requestedService: string;
                offeredService?: string;
                offeredPaymentCents?: number;
            };

            if (!toAgent || !requestedService) {
                res.status(400).json({ error: 'toAgent and requestedService required' });
                return;
            }

            const proposal = federation.proposeTrade(
                agent.config.walletAddress ?? '0x0000000000000000000000000000000000000000',
                toAgent,
                requestedService,
                { offeredService, offeredPaymentCents },
            );
            res.status(201).json({ trade: proposal });
        } catch (err) {
            res.status(500).json({ error: 'Trade proposal failed' });
        }
    });

    // Respond to a trade
    router.post('/api/federation/trades/:id/respond', (req: Request, res: Response) => {
        const { accept } = req.body as { accept: boolean };
        const result = federation.respondToTrade(req.params.id, accept);
        if (result) {
            res.json({ trade: result });
        } else {
            res.status(404).json({ error: 'Trade not found or not pending' });
        }
    });

    // Get trade history
    router.get('/api/federation/trades', (req: Request, res: Response) => {
        const address = (req.query.address as string)
            ?? agent.config.walletAddress
            ?? '';
        res.json({ trades: federation.getTradeHistory(address) });
    });

    // Create a swarm
    router.post('/api/federation/swarms', (req: Request, res: Response) => {
        try {
            const { description, subtasks } = req.body as {
                description: string;
                subtasks: { description: string; capability: string }[];
            };

            if (!description || !subtasks?.length) {
                res.status(400).json({ error: 'description and subtasks required' });
                return;
            }

            const swarm = federation.createSwarm(
                agent.config.walletAddress ?? '0x0000000000000000000000000000000000000000',
                description,
                subtasks,
            );

            // Auto-recruit
            federation.recruitForSwarm(swarm.id);

            res.status(201).json({ swarm: federation.getActiveSwarms().find(s => s.id === swarm.id) ?? swarm });
        } catch (err) {
            res.status(500).json({ error: 'Swarm creation failed' });
        }
    });

    // Get active swarms
    router.get('/api/federation/swarms', (_req: Request, res: Response) => {
        res.json({ swarms: federation.getActiveSwarms() });
    });

    // Prune stale agents
    router.post('/api/federation/prune', (_req: Request, res: Response) => {
        const pruned = federation.pruneStale();
        res.json({ pruned, remaining: federation.getStats().totalAgents });
    });
};
