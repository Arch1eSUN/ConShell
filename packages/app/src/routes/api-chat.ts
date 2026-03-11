/**
 * Chat Routes — SSE streaming chat, session management, abort.
 */
import type { Request, Response, RouteRegistrar } from './context.js';

export const registerChatRoutes: RouteRegistrar = (router, { agent, wsManager }) => {
    const activeAbortControllers = new Map<string, AbortController>();

    router.post('/api/chat', async (req: Request, res: Response) => {
        req.setTimeout(300_000);
        res.setTimeout(300_000);
        try {
            const { message, sessionId } = req.body as {
                message?: string;
                sessionId?: string;
            };

            if (!message) {
                res.status(400).json({ error: 'message (string) required' });
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });

            const sid = sessionId || `session-${Date.now()}`;
            const abortController = new AbortController();
            activeAbortControllers.set(sid, abortController);

            (res as unknown as NodeJS.EventEmitter).on('close', () => {
                abortController.abort();
                activeAbortControllers.delete(sid);
            });

            try {
                const turn = await agent.agentLoop.executeTurn({
                    role: 'user' as const,
                    content: message,
                    sessionId: sid,
                    signal: abortController.signal,
                });

                res.write(`data: ${JSON.stringify({ type: 'turn', data: turn })}\n\n`);
                wsManager.broadcast('new_turn', { sessionId: sid, turn });
            } catch (loopErr) {
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    data: { error: loopErr instanceof Error ? loopErr.message : String(loopErr) },
                })}\n\n`);
            }

            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
            activeAbortControllers.delete(sid);
        } catch (err) {
            agent.logger.error('Chat endpoint failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            if (!res.headersSent) {
                res.status(500).json({ error: 'Chat failed' });
            }
        }
    });

    router.get('/api/chat/sessions', (_req: Request, res: Response) => {
        try {
            const sessions = agent.repos.turns.listSessions();
            res.json({ sessions });
        } catch (err) {
            agent.logger.error('Failed to list sessions', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to list sessions' });
        }
    });

    router.get('/api/chat/sessions/:id', (req: Request, res: Response) => {
        try {
            const sessionId = req.params.id;
            const turns = agent.repos.turns.findBySession(sessionId);
            const messages = turns.map(t => ({
                role: t.role,
                content: t.content || t.thinking || '',
                timestamp: t.created_at,
                model: t.model,
            }));
            res.json({ sessionId, messages, count: messages.length });
        } catch (err) {
            agent.logger.error('Failed to get session history', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to get session history' });
        }
    });

    router.post('/api/chat/abort', (req: Request, res: Response) => {
        try {
            const { sessionId } = req.body as { sessionId?: string };
            if (!sessionId) {
                res.status(400).json({ error: 'sessionId required' });
                return;
            }
            const controller = activeAbortControllers.get(sessionId);
            if (controller) {
                controller.abort();
                activeAbortControllers.delete(sessionId);
                res.json({ success: true, message: 'Generation aborted' });
            } else {
                res.json({ success: false, message: 'No active generation for this session' });
            }
        } catch (err) {
            agent.logger.error('Failed to abort generation', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({ error: 'Failed to abort' });
        }
    });
};
