/**
 * AgentRegistry — local agent discovery cache with ERC-8004 registration flow.
 *
 * Features:
 *   - In-memory agent card storage
 *   - Capability and service search
 *   - Full ERC-8004 registration workflow
 *   - Agent Card discovery protocol
 *   - Registration validation pipeline
 *   - Expiry management for stale agents
 */
import type { AgentCard } from './agent-card.js';
import { validateCard } from './agent-card.js';

// ── Registration Types ─────────────────────────────────────────────────

export interface RegistrationRequest {
    readonly card: AgentCard;
    readonly signature?: string;       // EIP-191 or EIP-712 signature
    readonly proofOfWork?: string;     // Optional PoW nonce
}

export interface RegistrationResult {
    readonly success: boolean;
    readonly registrationId?: string;
    readonly errors: readonly string[];
    readonly timestamp: string;
}

export interface RegistrationRecord {
    readonly card: AgentCard;
    readonly registeredAt: string;
    readonly lastSeen: string;
    readonly verified: boolean;
    readonly ttlMs: number;
}

// ── AgentRegistry ──────────────────────────────────────────────────────

export class AgentRegistry {
    private readonly agents = new Map<string, RegistrationRecord>();
    private readonly defaultTtlMs: number;

    constructor(options?: { defaultTtlMs?: number }) {
        this.defaultTtlMs = options?.defaultTtlMs ?? 3600_000; // 1 hour default
    }

    /**
     * Full ERC-8004 registration flow:
     * 1. Validate AgentCard schema
     * 2. Verify signature (if provided)
     * 3. Create registration record
     */
    registerFull(request: RegistrationRequest): RegistrationResult {
        const now = new Date().toISOString();

        // Step 1: Validate card schema
        const validation = validateCard(request.card);
        if (!validation.valid) {
            return { success: false, errors: validation.errors, timestamp: now };
        }

        // Step 2: Signature verification (placeholder — real impl needs viem/ethers)
        const verified = request.signature ? request.signature.length > 0 : false;

        // Step 3: Create registration record
        const record: RegistrationRecord = {
            card: request.card,
            registeredAt: now,
            lastSeen: now,
            verified,
            ttlMs: this.defaultTtlMs,
        };

        this.agents.set(request.card.address.toLowerCase(), record);

        return {
            success: true,
            registrationId: `reg-${Date.now().toString(36)}`,
            errors: [],
            timestamp: now,
        };
    }

    /** Register or update an agent card (simple mode) */
    register(card: AgentCard): void {
        const now = new Date().toISOString();
        const existing = this.agents.get(card.address.toLowerCase());
        this.agents.set(card.address.toLowerCase(), {
            card,
            registeredAt: existing?.registeredAt ?? now,
            lastSeen: now,
            verified: existing?.verified ?? false,
            ttlMs: this.defaultTtlMs,
        });
    }

    /** Update last-seen timestamp for an agent */
    heartbeat(address: string): boolean {
        const record = this.agents.get(address.toLowerCase());
        if (!record) return false;
        this.agents.set(address.toLowerCase(), {
            ...record,
            lastSeen: new Date().toISOString(),
        });
        return true;
    }

    /** Find an agent by Ethereum address */
    find(address: string): AgentCard | undefined {
        return this.agents.get(address.toLowerCase())?.card;
    }

    /** Find an agent with full registration info */
    findRecord(address: string): RegistrationRecord | undefined {
        return this.agents.get(address.toLowerCase());
    }

    /** Find agents that advertise a given capability */
    findByCapability(capability: string): readonly AgentCard[] {
        const results: AgentCard[] = [];
        for (const record of this.agents.values()) {
            if (record.card.capabilities.includes(capability)) {
                results.push(record.card);
            }
        }
        return results;
    }

    /** Find agents that offer a service by name */
    findByService(serviceName: string): readonly AgentCard[] {
        const results: AgentCard[] = [];
        for (const record of this.agents.values()) {
            if (record.card.services.some(s => s.name === serviceName)) {
                results.push(record.card);
            }
        }
        return results;
    }

    /** List all registered agents */
    list(): readonly AgentCard[] {
        return [...this.agents.values()].map(r => r.card);
    }

    /** List all registration records */
    listRecords(): readonly RegistrationRecord[] {
        return [...this.agents.values()];
    }

    /** Remove an agent by address */
    remove(address: string): boolean {
        return this.agents.delete(address.toLowerCase());
    }

    /** Prune expired agents (not seen within TTL) */
    pruneExpired(): number {
        const now = Date.now();
        let pruned = 0;
        for (const [address, record] of this.agents) {
            const lastSeen = new Date(record.lastSeen).getTime();
            if (now - lastSeen > record.ttlMs) {
                this.agents.delete(address);
                pruned++;
            }
        }
        return pruned;
    }

    /** Number of registered agents */
    get size(): number {
        return this.agents.size;
    }

    /** Get verified-only agents */
    listVerified(): readonly AgentCard[] {
        return [...this.agents.values()]
            .filter(r => r.verified)
            .map(r => r.card);
    }
}
