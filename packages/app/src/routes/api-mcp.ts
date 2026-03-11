/**
 * MCP Routes — JSON-RPC 2.0 gateway, SSE transport, and discovery.
 */
import type { Request, Response, RouteRegistrar } from './context.js';

export const registerMcpRoutes: RouteRegistrar = (router, { agent }) => {
    router.post('/api/mcp', async (req: Request, res: Response) => {
        try {
            const jsonRpcRequest = req.body;

            if (!jsonRpcRequest?.jsonrpc || !jsonRpcRequest?.method) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    id: jsonRpcRequest?.id ?? null,
                    error: { code: -32600, message: 'Invalid JSON-RPC request' },
                });
                return;
            }

            if (jsonRpcRequest.method === 'tools/call' && jsonRpcRequest.params?.name) {
                const toolPath = `/api/mcp/tool/${jsonRpcRequest.params.name}`;
                const paymentResult = await agent.x402Server.evaluatePayment({
                    method: 'POST',
                    url: toolPath,
                    headers: {
                        'x-payment': (req.headers['x-payment'] as string) ?? '',
                        'x-payment-signature': (req.headers['x-payment-signature'] as string) ?? '',
                    },
                });

                if ('response' in paymentResult && paymentResult.gated) {
                    const paymentResponse = paymentResult.response;
                    res.status(paymentResponse.status);
                    for (const [key, value] of Object.entries(paymentResponse.headers)) {
                        res.setHeader(key, String(value));
                    }
                    res.send(paymentResponse.body);
                    return;
                }
            }

            const response = await agent.mcpGateway.handleRequest(jsonRpcRequest);
            res.json(response);
        } catch (err) {
            agent.logger.error('MCP endpoint failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            res.status(500).json({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32603, message: 'Internal server error' },
            });
        }
    });

    router.get('/api/mcp/sse', (_req: Request, res: Response) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        res.write(`data: ${JSON.stringify({ type: 'connected', server: agent.config.agentName, version: '0.1.0' })}\n\n`);

        const keepAlive = setInterval(() => {
            res.write(': keepalive\n\n');
        }, 30_000);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (res as any).on('close', () => {
            clearInterval(keepAlive);
        });
    });

    router.get('/.well-known/mcp', (_req: Request, res: Response) => {
        res.json({
            name: agent.config.agentName,
            version: '0.1.0',
            description: 'Conway Automaton — Sovereign AI Agent',
            endpoints: {
                rpc: '/api/mcp',
                sse: '/api/mcp/sse',
            },
        });
    });
};
