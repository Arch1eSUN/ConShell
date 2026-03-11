/**
 * Smoke test — verifies app module structure.
 */
import { describe, it, expect } from 'vitest';

describe('@conshell/app', () => {
    it('exports loadConfig', async () => {
        const config = await import('./config.js');
        expect(config.loadConfig).toBeDefined();
        expect(typeof config.loadConfig).toBe('function');
    });

    it('exports bootKernel', async () => {
        const kernel = await import('./kernel.js');
        expect(kernel.bootKernel).toBeDefined();
        expect(typeof kernel.bootKernel).toBe('function');
    });

    it('exports createAppServer', async () => {
        const server = await import('./server.js');
        expect(server.createAppServer).toBeDefined();
        expect(typeof server.createAppServer).toBe('function');
    });

    it('exports WsManager', async () => {
        const ws = await import('./ws.js');
        expect(ws.WsManager).toBeDefined();
    });
});
