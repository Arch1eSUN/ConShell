/**
 * Plugins Routes — plugin management (enable/disable/list).
 *
 * Endpoints:
 *   GET  /api/plugins               — list installed plugins with status
 *   POST /api/plugins/:name/enable  — enable a plugin
 *   POST /api/plugins/:name/disable — disable a plugin
 */
import type { Request, Response, RouteRegistrar } from './context.js';

// ── In-memory plugin state ──────────────────────────────────────────────

interface PluginEntry {
    name: string;
    enabled: boolean;
    version: string;
    description: string;
}

// Default built-in plugins
const plugins: Map<string, PluginEntry> = new Map([
    ['mcp-gateway', { name: 'mcp-gateway', enabled: true, version: '1.0.0', description: 'Model Context Protocol gateway for external tool access' }],
    ['x402-payments', { name: 'x402-payments', enabled: true, version: '1.0.0', description: 'x402 payment protocol for monetized API endpoints' }],
    ['heartbeat-daemon', { name: 'heartbeat-daemon', enabled: true, version: '1.0.0', description: 'Autonomous task scheduling and health monitoring' }],
    ['injection-defense', { name: 'injection-defense', enabled: true, version: '1.0.0', description: '8-pattern prompt injection detection engine' }],
    ['web-tools', { name: 'web-tools', enabled: true, version: '1.0.0', description: 'Web search, RSS feed, and URL browsing tools' }],
    ['voice-engine', { name: 'voice-engine', enabled: false, version: '1.0.0', description: 'Voice input/output via Whisper + TTS' }],
    ['canvas-engine', { name: 'canvas-engine', enabled: false, version: '1.0.0', description: 'Collaborative canvas for visual agent interaction' }],
]);

// ── Route Registration ──────────────────────────────────────────────────

export const registerPluginRoutes: RouteRegistrar = (router, { agent }) => {
    // List all plugins
    router.get('/api/plugins', (_req: Request, res: Response) => {
        const list = Array.from(plugins.values());
        res.json({
            plugins: list,
            enabled: list.filter(p => p.enabled).length,
            total: list.length,
        });
    });

    // Enable a plugin
    router.post('/api/plugins/:name/enable', (req: Request, res: Response) => {
        const { name } = req.params;
        const plugin = plugins.get(name);
        if (!plugin) {
            res.status(404).json({ error: `Plugin "${name}" not found` });
            return;
        }
        plugin.enabled = true;
        agent.logger.info('Plugin enabled', { name });
        res.json({ success: true, plugin });
    });

    // Disable a plugin
    router.post('/api/plugins/:name/disable', (req: Request, res: Response) => {
        const { name } = req.params;
        const plugin = plugins.get(name);
        if (!plugin) {
            res.status(404).json({ error: `Plugin "${name}" not found` });
            return;
        }
        plugin.enabled = false;
        agent.logger.info('Plugin disabled', { name });
        res.json({ success: true, plugin });
    });
};
