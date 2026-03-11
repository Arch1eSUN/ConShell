/**
 * AgentRegistry — local agent discovery cache.
 *
 * In-memory registry for discovered agents. On-chain ERC-8004
 * integration deferred to a later wave.
 */
import type { AgentCard } from './agent-card.js';

// ── AgentRegistry ──────────────────────────────────────────────────────

export class AgentRegistry {
    private readonly agents = new Map<string, AgentCard>();

    /** Register or update an agent card */
    register(card: AgentCard): void {
        this.agents.set(card.address.toLowerCase(), card);
    }

    /** Find an agent by Ethereum address */
    find(address: string): AgentCard | undefined {
        return this.agents.get(address.toLowerCase());
    }

    /** Find agents that advertise a given capability */
    findByCapability(capability: string): readonly AgentCard[] {
        const results: AgentCard[] = [];
        for (const card of this.agents.values()) {
            if (card.capabilities.includes(capability)) {
                results.push(card);
            }
        }
        return results;
    }

    /** Find agents that offer a service by name */
    findByService(serviceName: string): readonly AgentCard[] {
        const results: AgentCard[] = [];
        for (const card of this.agents.values()) {
            if (card.services.some(s => s.name === serviceName)) {
                results.push(card);
            }
        }
        return results;
    }

    /** List all registered agents */
    list(): readonly AgentCard[] {
        return [...this.agents.values()];
    }

    /** Remove an agent by address */
    remove(address: string): boolean {
        return this.agents.delete(address.toLowerCase());
    }

    /** Number of registered agents */
    get size(): number {
        return this.agents.size;
    }
}
