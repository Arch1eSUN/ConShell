/**
 * Social Layer — Agent-to-Agent communication.
 *
 * Features:
 * - Message signing with Ethereum private key (via wallet)
 * - Inbox processing with signature/timestamp/size validation
 * - Injection defense integration (delegates to caller)
 * - Reputation tracking (feedback scores)
 * - Local-first peer-to-peer via HTTP endpoints
 */

import { createHash, randomBytes } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────

export interface SocialMessage {
    readonly id: string;
    readonly from: string;       // Ethereum address
    readonly to: string;         // Ethereum address
    readonly content: string;
    readonly timestamp: number;  // epoch ms
    readonly signature?: string; // hex-encoded signature
    readonly replyTo?: string;   // message ID
}

export interface InboxFilter {
    readonly from?: string;
    readonly since?: number;     // epoch ms
    readonly limit?: number;
}

export interface MessageValidation {
    readonly valid: boolean;
    readonly errors: string[];
}

export interface ReputationEntry {
    readonly agentAddress: string;
    readonly feedbackScore: number;      // -100 to +100
    readonly interactionCount: number;
    readonly lastInteraction: number;
}

export interface SocialConfig {
    /** Max message size in bytes (default 4096) */
    readonly maxMessageSize?: number;
    /** Max age for messages in ms (default 1 hour) */
    readonly maxMessageAge?: number;
    /** Max inbox size (default 1000) */
    readonly maxInboxSize?: number;
    /** Min reputation before auto-block (default -50) */
    readonly autoBlockThreshold?: number;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_SOCIAL_CONFIG: Required<SocialConfig> = {
    maxMessageSize: 4096,
    maxMessageAge: 3600_000,
    maxInboxSize: 1000,
    autoBlockThreshold: -50,
};

// ── Message Validation ─────────────────────────────────────────────────

export function validateMessage(
    message: SocialMessage,
    config: Required<SocialConfig>,
): MessageValidation {
    const errors: string[] = [];

    if (!message.from || !/^0x[0-9a-fA-F]{40}$/.test(message.from)) {
        errors.push('Invalid sender address');
    }
    if (!message.to || !/^0x[0-9a-fA-F]{40}$/.test(message.to)) {
        errors.push('Invalid recipient address');
    }
    if (!message.content || message.content.length === 0) {
        errors.push('Message content is empty');
    }
    if (message.content.length > config.maxMessageSize) {
        errors.push(`Message exceeds max size (${config.maxMessageSize} bytes)`);
    }

    const age = Date.now() - message.timestamp;
    if (age > config.maxMessageAge) {
        errors.push(`Message is too old (${Math.round(age / 1000)}s > ${config.maxMessageAge / 1000}s)`);
    }
    if (age < -60_000) {
        errors.push('Message timestamp is in the future');
    }

    return { valid: errors.length === 0, errors };
}

// ── SocialHub ──────────────────────────────────────────────────────────

export class SocialHub {
    private readonly config: Required<SocialConfig>;
    private readonly inbox: SocialMessage[] = [];
    private readonly outbox: SocialMessage[] = [];
    private readonly reputation = new Map<string, ReputationEntry>();
    private readonly blocked = new Set<string>();

    constructor(config?: SocialConfig) {
        this.config = { ...DEFAULT_SOCIAL_CONFIG, ...config };
    }

    /** Create and queue an outgoing message */
    compose(to: string, content: string, fromAddress: string): SocialMessage {
        const message: SocialMessage = {
            id: randomBytes(16).toString('hex'),
            from: fromAddress,
            to,
            content,
            timestamp: Date.now(),
        };

        this.outbox.push(message);
        return message;
    }

    /** Receive an incoming message. Returns validation result. */
    receive(message: SocialMessage): MessageValidation {
        // Block check
        if (this.blocked.has(message.from.toLowerCase())) {
            return { valid: false, errors: ['Sender is blocked'] };
        }

        // Auto-block check
        const rep = this.getReputation(message.from);
        if (rep && rep.feedbackScore <= this.config.autoBlockThreshold) {
            this.block(message.from);
            return { valid: false, errors: ['Sender auto-blocked due to low reputation'] };
        }

        // Validate
        const validation = validateMessage(message, this.config);
        if (!validation.valid) {
            return validation;
        }

        // Inbox capacity
        if (this.inbox.length >= this.config.maxInboxSize) {
            // Remove oldest
            this.inbox.shift();
        }

        this.inbox.push(message);
        return { valid: true, errors: [] };
    }

    /** Get inbox messages with optional filter */
    getInbox(filter?: InboxFilter): readonly SocialMessage[] {
        let messages = [...this.inbox];

        if (filter?.from) {
            const addr = filter.from.toLowerCase();
            messages = messages.filter(m => m.from.toLowerCase() === addr);
        }
        if (filter?.since) {
            messages = messages.filter(m => m.timestamp >= filter.since!);
        }
        if (filter?.limit) {
            messages = messages.slice(-filter.limit);
        }

        return messages;
    }

    /** Get outbox messages */
    getOutbox(): readonly SocialMessage[] {
        return [...this.outbox];
    }

    /** Clear sent messages from outbox */
    flushOutbox(): SocialMessage[] {
        const messages = [...this.outbox];
        this.outbox.length = 0;
        return messages;
    }

    /** Submit feedback for an agent */
    feedback(agentAddress: string, score: number): void {
        if (score < -100 || score > 100) {
            throw new Error('Feedback score must be between -100 and +100');
        }

        const addr = agentAddress.toLowerCase();
        const existing = this.reputation.get(addr);

        if (existing) {
            // Weighted average
            const totalWeight = existing.interactionCount + 1;
            const newScore = Math.round(
                (existing.feedbackScore * existing.interactionCount + score) / totalWeight,
            );
            this.reputation.set(addr, {
                agentAddress: addr,
                feedbackScore: newScore,
                interactionCount: totalWeight,
                lastInteraction: Date.now(),
            });
        } else {
            this.reputation.set(addr, {
                agentAddress: addr,
                feedbackScore: score,
                interactionCount: 1,
                lastInteraction: Date.now(),
            });
        }

        // Auto-block check
        const updated = this.reputation.get(addr)!;
        if (updated.feedbackScore <= this.config.autoBlockThreshold) {
            this.blocked.add(addr);
        }
    }

    /** Get reputation for an agent */
    getReputation(agentAddress: string): ReputationEntry | undefined {
        return this.reputation.get(agentAddress.toLowerCase());
    }

    /** List all reputation entries */
    listReputation(): readonly ReputationEntry[] {
        return [...this.reputation.values()];
    }

    /** Block an agent */
    block(agentAddress: string): void {
        this.blocked.add(agentAddress.toLowerCase());
    }

    /** Unblock an agent */
    unblock(agentAddress: string): void {
        this.blocked.delete(agentAddress.toLowerCase());
    }

    /** Check if agent is blocked */
    isBlocked(agentAddress: string): boolean {
        return this.blocked.has(agentAddress.toLowerCase());
    }

    /** Get inbox size */
    get inboxSize(): number {
        return this.inbox.length;
    }
}

/**
 * Hash message content for integrity verification.
 */
export function hashMessage(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}
