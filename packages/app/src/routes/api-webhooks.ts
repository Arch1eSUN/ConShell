/**
 * Webhook Inbound Engine — HTTP → Agent action trigger.
 *
 * Supports:
 *   - Generic incoming webhooks (POST /api/webhooks/:id)
 *   - Typed webhook definitions with validation
 *   - Event-based trigger routing to heartbeat tasks or agent loop
 *   - HMAC signature verification for secure webhooks
 *   - Rate limiting per webhook endpoint
 */
import type { Request, Response, RouteRegistrar } from './context.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Types ───────────────────────────────────────────────────────────────

export interface WebhookDefinition {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    /** Secret for HMAC-SHA256 signature verification */
    readonly secret?: string;
    /** Header name containing the signature (default: X-Webhook-Signature) */
    readonly signatureHeader?: string;
    /** Action to trigger: 'chat' sends to agent loop, 'event' fires a named event */
    readonly action: 'chat' | 'event';
    /** For 'event' action: the event name to fire */
    readonly eventName?: string;
    /** Whether the webhook is currently active */
    readonly enabled: boolean;
    readonly createdAt: string;
}

export interface WebhookStore {
    list(): WebhookDefinition[];
    get(id: string): WebhookDefinition | undefined;
    create(def: Omit<WebhookDefinition, 'createdAt'>): WebhookDefinition;
    delete(id: string): boolean;
    update(id: string, updates: Partial<Pick<WebhookDefinition, 'name' | 'enabled' | 'secret' | 'action' | 'eventName'>>): WebhookDefinition | undefined;
}

// ── In-memory store (upgradeable to SQLite later) ───────────────────────

class InMemoryWebhookStore implements WebhookStore {
    private readonly hooks = new Map<string, WebhookDefinition>();

    list(): WebhookDefinition[] {
        return [...this.hooks.values()];
    }

    get(id: string): WebhookDefinition | undefined {
        return this.hooks.get(id);
    }

    create(def: Omit<WebhookDefinition, 'createdAt'>): WebhookDefinition {
        const full: WebhookDefinition = { ...def, createdAt: new Date().toISOString() };
        this.hooks.set(def.id, full);
        return full;
    }

    delete(id: string): boolean {
        return this.hooks.delete(id);
    }

    update(id: string, updates: Partial<Pick<WebhookDefinition, 'name' | 'enabled' | 'secret' | 'action' | 'eventName'>>): WebhookDefinition | undefined {
        const existing = this.hooks.get(id);
        if (!existing) return undefined;
        const updated = { ...existing, ...updates };
        this.hooks.set(id, updated);
        return updated;
    }
}

export const webhookStore = new InMemoryWebhookStore();

// ── Signature verification ──────────────────────────────────────────────

function verifySignature(payload: string, secret: string, signature: string): boolean {
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    try {
        return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
}

// ── Rate limiting (per webhook) ─────────────────────────────────────────

const webhookCallCounts = new Map<string, { count: number; resetAt: number }>();
const MAX_CALLS_PER_MINUTE = 30;

function isRateLimited(webhookId: string): boolean {
    const now = Date.now();
    const entry = webhookCallCounts.get(webhookId);

    if (!entry || now > entry.resetAt) {
        webhookCallCounts.set(webhookId, { count: 1, resetAt: now + 60_000 });
        return false;
    }

    entry.count++;
    return entry.count > MAX_CALLS_PER_MINUTE;
}

// ── Route registration ──────────────────────────────────────────────────

export const registerWebhookRoutes: RouteRegistrar = (router, { agent, wsManager }) => {

    // List all webhooks
    router.get('/api/webhooks', (_req: Request, res: Response) => {
        const hooks = webhookStore.list().map(h => ({
            ...h,
            secret: h.secret ? '***' : undefined, // Redact secret
        }));
        res.json({ webhooks: hooks, count: hooks.length });
    });

    // Create a new webhook
    router.post('/api/webhooks', (req: Request, res: Response) => {
        try {
            const { name, action, eventName, secret } = req.body as {
                name?: string;
                action?: 'chat' | 'event';
                eventName?: string;
                secret?: string;
            };

            if (!name || !action) {
                res.status(400).json({ error: 'name and action required' });
                return;
            }

            const id = `wh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            const hook = webhookStore.create({
                id,
                name,
                action,
                eventName: action === 'event' ? (eventName ?? name) : undefined,
                secret,
                enabled: true,
                description: `Webhook: ${name}`,
            });

            res.status(201).json({ webhook: { ...hook, secret: hook.secret ? '***' : undefined } });
        } catch (err) {
            res.status(500).json({ error: 'Failed to create webhook' });
        }
    });

    // Delete a webhook
    router.delete('/api/webhooks/:id', (req: Request, res: Response) => {
        const deleted = webhookStore.delete(req.params.id);
        if (deleted) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Webhook not found' });
        }
    });

    // Inbound webhook trigger endpoint
    router.post('/api/webhooks/:id/trigger', async (req: Request, res: Response) => {
        const hook = webhookStore.get(req.params.id);
        if (!hook) {
            res.status(404).json({ error: 'Webhook not found' });
            return;
        }

        if (!hook.enabled) {
            res.status(403).json({ error: 'Webhook is disabled' });
            return;
        }

        // Rate limiting
        if (isRateLimited(hook.id)) {
            res.status(429).json({ error: 'Rate limit exceeded (30/min)' });
            return;
        }

        // Signature verification
        if (hook.secret) {
            const sigHeader = hook.signatureHeader ?? 'x-webhook-signature';
            const signature = req.headers[sigHeader] as string | undefined;
            if (!signature) {
                res.status(401).json({ error: 'Missing signature header' });
                return;
            }

            const rawBody = JSON.stringify(req.body);
            if (!verifySignature(rawBody, hook.secret, signature)) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
        }

        try {
            if (hook.action === 'chat') {
                // Route to agent loop as a chat message
                const message = (req.body as Record<string, unknown>).message
                    || (req.body as Record<string, unknown>).text
                    || JSON.stringify(req.body);

                const turn = await agent.agentLoop.executeTurn({
                    sessionId: `webhook-${hook.id}`,
                    role: 'user' as const,
                    content: String(message),
                });

                wsManager.broadcast('new_turn', { source: 'webhook', webhookId: hook.id, turn });
                res.json({ success: true, turnId: 'ok' });

            } else if (hook.action === 'event') {
                // Fire a named event via WebSocket
                const eventName = hook.eventName ?? hook.name;
                wsManager.broadcast(eventName, {
                    source: 'webhook',
                    webhookId: hook.id,
                    payload: req.body,
                    timestamp: new Date().toISOString(),
                });
                res.json({ success: true, event: eventName });
            }
        } catch (err) {
            agent.logger.error('Webhook trigger failed', {
                webhookId: hook.id,
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Webhook execution failed' });
        }
    });
};
