/**
 * AgentCard — JSON-LD agent descriptor per ERC-8004.
 *
 * Describes an agent's identity, capabilities, services, and endpoint
 * in a machine-readable format for agent discovery.
 */
import { createHash } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentCard {
    readonly '@context': 'https://schema.org/';
    readonly '@type': 'SoftwareAgent';
    readonly name: string;
    readonly address: string; // Ethereum address
    readonly capabilities: readonly string[];
    readonly services: readonly AgentService[];
    readonly endpoint: string; // HTTP(S) URL for agent communication
    readonly version: string;
    readonly created: string; // ISO 8601
    readonly description?: string;
}

export interface AgentService {
    readonly name: string;
    readonly description: string;
    readonly pricePerCallCents?: number;
    readonly inputSchema?: Record<string, unknown>;
}

export interface AgentCardValidation {
    readonly valid: boolean;
    readonly errors: string[];
}

// ── Factory ────────────────────────────────────────────────────────────

export interface CreateCardOptions {
    readonly name: string;
    readonly address: string;
    readonly capabilities?: readonly string[];
    readonly services?: readonly AgentService[];
    readonly endpoint?: string;
    readonly version?: string;
    readonly description?: string;
}

/**
 * Create a new AgentCard from options.
 */
export function createCard(opts: CreateCardOptions): AgentCard {
    return {
        '@context': 'https://schema.org/',
        '@type': 'SoftwareAgent',
        name: opts.name,
        address: opts.address,
        capabilities: opts.capabilities ?? [],
        services: opts.services ?? [],
        endpoint: opts.endpoint ?? '',
        version: opts.version ?? '1.0.0',
        created: new Date().toISOString(),
        description: opts.description,
    };
}

// ── Validation ─────────────────────────────────────────────────────────

/**
 * Validate an AgentCard. Returns errors for missing/invalid fields.
 */
export function validateCard(card: AgentCard): AgentCardValidation {
    const errors: string[] = [];

    if (!card.name || card.name.trim().length === 0) {
        errors.push('name is required');
    }
    if (!card.address || !/^0x[0-9a-fA-F]{40}$/.test(card.address)) {
        errors.push('address must be a valid Ethereum address (0x + 40 hex chars)');
    }
    if (!card['@context'] || card['@context'] !== 'https://schema.org/') {
        errors.push('@context must be https://schema.org/');
    }
    if (!card['@type'] || card['@type'] !== 'SoftwareAgent') {
        errors.push('@type must be SoftwareAgent');
    }
    if (!Array.isArray(card.capabilities)) {
        errors.push('capabilities must be an array');
    }
    if (!Array.isArray(card.services)) {
        errors.push('services must be an array');
    }

    return { valid: errors.length === 0, errors };
}

// ── Serialization ──────────────────────────────────────────────────────

/**
 * Serialize an AgentCard to a canonical JSON string.
 */
export function serializeCard(card: AgentCard): string {
    // Sort keys for deterministic serialization
    return JSON.stringify(card, Object.keys(card).sort(), 2);
}

/**
 * Hash an AgentCard (SHA-256 of canonical serialization).
 */
export function hashCard(card: AgentCard): string {
    return createHash('sha256').update(serializeCard(card)).digest('hex');
}
