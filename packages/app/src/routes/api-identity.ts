/**
 * Identity Routes — agent identity, DID, name management.
 *
 * Endpoints:
 *   GET  /api/identity       — current agent identity info
 *   PUT  /api/identity/name  — update agent display name
 */
import type { Request, Response, RouteRegistrar } from './context.js';
import { createHash } from 'node:crypto';

// ── Route Registration ──────────────────────────────────────────────────

export const registerIdentityRoutes: RouteRegistrar = (router, { agent }) => {
    // Get agent identity
    router.get('/api/identity', (_req: Request, res: Response) => {
        const soul = agent.soul.view();
        const agentName = soul.name || agent.config.agentName || 'ConShell Agent';

        // Generate deterministic DID from agent name
        const didHash = createHash('sha256').update(agentName).digest('hex').slice(0, 16);
        const did = `did:web4:${didHash}`;

        // Generate a deterministic public key stub
        const pubKeyHash = createHash('sha256').update(did).digest('hex').slice(0, 40);

        res.json({
            name: agentName,
            did,
            publicKey: `0x${pubKeyHash}`,
            agentCardPublished: false,
            reputation: 0.85,
            state: agent.getState(),
            tier: agent.getTier(),
            capabilities: soul.capabilities ?? [],
            values: soul.values ?? [],
            createdAt: new Date(Date.now() - 86400_000 * 7).toISOString(), // Mock: 7 days ago
        });
    });

    // Update agent name
    router.put('/api/identity/name', (req: Request, res: Response) => {
        const { name } = req.body as { name?: string };
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ error: 'name is required and must be a non-empty string' });
            return;
        }

        const trimmedName = name.trim();

        // Update soul
        const currentSoul = agent.soul.view();
        agent.soul.update({
            name: trimmedName,
            identity: currentSoul.identity.replaceAll(currentSoul.name, trimmedName),
        });

        agent.logger.info('Agent name updated', { from: currentSoul.name, to: trimmedName });
        res.json({ success: true, name: trimmedName });
    });
};
