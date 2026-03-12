/**
 * Social Layer Routes — agent discovery, messaging, reputation.
 *
 * Endpoints:
 *   GET  /api/social/agents  — discovered agent peers
 *   GET  /api/social/inbox   — message inbox
 *   GET  /api/social/stats   — network statistics
 *   POST /api/social/send    — send a P2P message
 */
import type { Request, Response, RouteRegistrar } from './context.js';

// ── In-memory social state (will be backed by DB in future) ─────────────

interface PeerAgent {
    id: string;
    name: string;
    lastSeen: string;
    trust: number;
    capabilities: string[];
}

interface Message {
    id: string;
    from: string;
    to: string;
    body: string;
    timestamp: string;
    read: boolean;
}

const peers: PeerAgent[] = [];
const inbox: Message[] = [];
let msgCounter = 0;

// ── Route Registration ──────────────────────────────────────────────────

export const registerSocialRoutes: RouteRegistrar = (router, { agent }) => {
    // Ensure self is discoverable
    if (!peers.find(p => p.id === 'self')) {
        peers.push({
            id: 'self',
            name: agent.config.agentName || 'ConShell Agent',
            lastSeen: new Date().toISOString(),
            trust: 1.0,
            capabilities: ['chat', 'tools', 'mcp'],
        });
    }

    // List discovered agents
    router.get('/api/social/agents', (_req: Request, res: Response) => {
        // Update self lastSeen
        const self = peers.find(p => p.id === 'self');
        if (self) self.lastSeen = new Date().toISOString();

        res.json({
            agents: peers,
            count: peers.length,
        });
    });

    // Message inbox
    router.get('/api/social/inbox', (_req: Request, res: Response) => {
        res.json({
            messages: inbox.slice(-50),
            unread: inbox.filter(m => !m.read).length,
            total: inbox.length,
        });
    });

    // Network statistics
    router.get('/api/social/stats', (_req: Request, res: Response) => {
        res.json({
            totalPeers: peers.length,
            activePeers: peers.filter(p => {
                const last = new Date(p.lastSeen).getTime();
                return Date.now() - last < 300_000; // 5 min
            }).length,
            totalMessages: inbox.length,
            unreadMessages: inbox.filter(m => !m.read).length,
            averageTrust: peers.length > 0
                ? peers.reduce((sum, p) => sum + p.trust, 0) / peers.length
                : 0,
        });
    });

    // Send a message
    router.post('/api/social/send', (req: Request, res: Response) => {
        const { to, body } = req.body as { to?: string; body?: string };
        if (!to || !body) {
            res.status(400).json({ error: 'to and body required' });
            return;
        }

        const msg: Message = {
            id: `msg_${++msgCounter}`,
            from: 'self',
            to,
            body,
            timestamp: new Date().toISOString(),
            read: false,
        };
        inbox.push(msg);

        agent.logger.info('Social message sent', { to, length: body.length });
        res.status(201).json({ sent: true, message: msg });
    });
};
