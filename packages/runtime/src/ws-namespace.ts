/**
 * WsGateway Namespace Isolation — Adds channel-based namespace isolation
 * to the existing WsGateway for multi-instance agent communication.
 *
 * Each namespace gets its own:
 * - Client Set (isolated broadcasting)
 * - Event buffer
 * - Subscription state
 *
 * WsNamespaceManager works alongside the existing WsGateway as a decorator.
 */


import type { Logger } from '@conshell/core';

// ── Types ──────────────────────────────────────────────────────────────

export interface NamespaceConfig {
    /** Namespace identifier (typically the channelId from ChannelRouter). */
    readonly id: string;
    /** Human-readable label. */
    readonly label: string;
    /** Maximum clients per namespace. */
    readonly maxClients?: number;
    /** Whether this namespace is isolated (no cross-namespace events). */
    readonly isolated?: boolean;
    /** Workspace directory for this namespace. */
    readonly workspaceDir?: string;
}

export interface NamespaceInfo {
    readonly id: string;
    readonly label: string;
    readonly clientCount: number;
    readonly isolated: boolean;
    readonly createdAt: number;
    readonly lastEventAt: number;
    readonly eventCount: number;
}

export interface NamespaceEvent {
    readonly namespace: string;
    readonly type: string;
    readonly data: unknown;
    readonly timestamp: number;
    readonly sourceClientId?: string;
}

interface NamespaceState {
    readonly config: NamespaceConfig;
    readonly clients: Set<string>;
    readonly createdAt: number;
    lastEventAt: number;
    eventCount: number;
    readonly eventBuffer: NamespaceEvent[];
}

// ── Namespace Manager ──────────────────────────────────────────────────

export class WsNamespaceManager {
    private readonly namespaces = new Map<string, NamespaceState>();
    private readonly clientNamespaces = new Map<string, Set<string>>(); // clientId → Set<namespaceId>
    private readonly logger: Logger;
    private readonly maxEventBuffer: number;

    constructor(logger: Logger, opts?: { maxEventBuffer?: number }) {
        this.logger = logger;
        this.maxEventBuffer = opts?.maxEventBuffer ?? 100;
    }

    // ── Namespace Lifecycle ─────────────────────────────────────────────

    /**
     * Create a new namespace.
     */
    createNamespace(config: NamespaceConfig): string {
        if (this.namespaces.has(config.id)) {
            this.logger.warn('Namespace already exists', { id: config.id });
            return config.id;
        }

        this.namespaces.set(config.id, {
            config,
            clients: new Set(),
            createdAt: Date.now(),
            lastEventAt: 0,
            eventCount: 0,
            eventBuffer: [],
        });

        this.logger.info('Namespace created', { id: config.id, label: config.label });
        return config.id;
    }

    /**
     * Remove a namespace and disconnect all its clients.
     */
    removeNamespace(id: string): boolean {
        const ns = this.namespaces.get(id);
        if (!ns) return false;

        // Remove clients from this namespace
        for (const clientId of ns.clients) {
            const nsSet = this.clientNamespaces.get(clientId);
            nsSet?.delete(id);
            if (nsSet?.size === 0) this.clientNamespaces.delete(clientId);
        }

        this.namespaces.delete(id);
        this.logger.info('Namespace removed', { id });
        return true;
    }

    // ── Client Management ───────────────────────────────────────────────

    /**
     * Join a client to a namespace.
     */
    joinNamespace(clientId: string, namespaceId: string): boolean {
        const ns = this.namespaces.get(namespaceId);
        if (!ns) return false;

        const maxClients = ns.config.maxClients ?? 50;
        if (ns.clients.size >= maxClients) {
            this.logger.warn('Namespace full', { namespaceId, maxClients });
            return false;
        }

        ns.clients.add(clientId);

        if (!this.clientNamespaces.has(clientId)) {
            this.clientNamespaces.set(clientId, new Set());
        }
        this.clientNamespaces.get(clientId)!.add(namespaceId);

        this.logger.info('Client joined namespace', { clientId, namespaceId });
        return true;
    }

    /**
     * Remove a client from a namespace.
     */
    leaveNamespace(clientId: string, namespaceId: string): boolean {
        const ns = this.namespaces.get(namespaceId);
        if (!ns) return false;

        ns.clients.delete(clientId);
        const nsSet = this.clientNamespaces.get(clientId);
        nsSet?.delete(namespaceId);
        if (nsSet?.size === 0) this.clientNamespaces.delete(clientId);

        this.logger.info('Client left namespace', { clientId, namespaceId });
        return true;
    }

    /**
     * Remove a client from all namespaces (on disconnect).
     */
    removeClient(clientId: string): void {
        const nsIds = this.clientNamespaces.get(clientId);
        if (!nsIds) return;

        for (const nsId of nsIds) {
            const ns = this.namespaces.get(nsId);
            ns?.clients.delete(clientId);
        }
        this.clientNamespaces.delete(clientId);
    }

    // ── Event Distribution ──────────────────────────────────────────────

    /**
     * Get client IDs in a namespace that should receive an event.
     * For isolated namespaces, only clients in that namespace receive events.
     */
    getTargetClients(namespaceId: string): readonly string[] {
        const ns = this.namespaces.get(namespaceId);
        if (!ns) return [];
        return [...ns.clients];
    }

    /**
     * Record an event in the namespace buffer.
     */
    recordEvent(namespaceId: string, event: Omit<NamespaceEvent, 'namespace'>): void {
        const ns = this.namespaces.get(namespaceId);
        if (!ns) return;

        const nsEvent: NamespaceEvent = { ...event, namespace: namespaceId };
        ns.eventCount++;
        ns.lastEventAt = Date.now();

        if (ns.eventBuffer.length >= this.maxEventBuffer) {
            ns.eventBuffer.shift();
        }
        ns.eventBuffer.push(nsEvent);
    }

    /**
     * Get the namespaces a client belongs to.
     */
    getClientNamespaces(clientId: string): readonly string[] {
        return [...(this.clientNamespaces.get(clientId) ?? [])];
    }

    // ── Queries ─────────────────────────────────────────────────────────

    /**
     * List all namespaces with stats.
     */
    listNamespaces(): readonly NamespaceInfo[] {
        return [...this.namespaces.values()].map(ns => ({
            id: ns.config.id,
            label: ns.config.label,
            clientCount: ns.clients.size,
            isolated: ns.config.isolated ?? false,
            createdAt: ns.createdAt,
            lastEventAt: ns.lastEventAt,
            eventCount: ns.eventCount,
        }));
    }

    /**
     * Get recent events from a namespace.
     */
    getRecentEvents(namespaceId: string, limit = 50): readonly NamespaceEvent[] {
        const ns = this.namespaces.get(namespaceId);
        if (!ns) return [];
        return ns.eventBuffer.slice(-limit);
    }

    /**
     * Check if a namespace exists.
     */
    hasNamespace(id: string): boolean {
        return this.namespaces.has(id);
    }

    /**
     * Get namespace count.
     */
    get size(): number {
        return this.namespaces.size;
    }
}
