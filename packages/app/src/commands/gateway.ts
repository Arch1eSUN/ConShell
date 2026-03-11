/**
 * `conshell gateway` — Gateway management commands.
 */
import type { Command } from 'commander';
import { loadConfig, formatProviderStatus } from '../config.js';
import { bootKernel } from '../kernel.js';
import { createAppServer } from '../server.js';
import { banner, success, info, label, spinner, openBrowser, palette } from '../utils/ui.js';

export function registerGatewayCommand(program: Command, VERSION: string): void {
    const gateway = program
        .command('gateway')
        .description('Manage the ConShell gateway (control plane)');

    gateway
        .command('run')
        .description('Start the gateway (HTTP + WebSocket + Dashboard)')
        .option('-p, --port <port>', 'Gateway port', '4200')
        .option('--bind <mode>', 'Bind mode (loopback | lan)', 'loopback')
        .option('--open', 'Open dashboard in browser')
        .option('--env <path>', '.env file path')
        .action(async (opts) => {
            const config = loadConfig(opts.env);
            const finalConfig = {
                ...config,
                port: parseInt(opts.port, 10) || config.port,
            };

            banner(VERSION);
            label('Mode', 'Gateway');
            label('Bind', opts.bind);
            label('Port', String(finalConfig.port));
            console.log('');

            const boot = spinner('Starting gateway...');
            boot.start();

            try {
                const agent = await bootKernel(finalConfig);
                const server = createAppServer(agent);
                const host = opts.bind === 'lan' ? '0.0.0.0' : '127.0.0.1';

                server.httpServer.listen(finalConfig.port, host, () => {
                    boot.succeed('Gateway online');
                    console.log('');
                    success(`HTTP at http://${host}:${finalConfig.port}`);
                    success(`WebSocket at ws://${host}:${finalConfig.port}/ws`);
                    success(`Dashboard at http://${host}:${finalConfig.port}`);
                    console.log('');
                    info(`Agent state: ${agent.getState()}`);
                    info('Press Ctrl+C to stop');
                    console.log('');

                    if (opts.open) {
                        openBrowser(`http://localhost:${finalConfig.port}`);
                    }
                });

                const shutdown = async () => {
                    console.log('');
                    const s = spinner('Shutting down gateway...');
                    s.start();
                    await server.close();
                    agent.shutdown();
                    s.succeed('Gateway stopped');
                    process.exit(0);
                };
                process.on('SIGINT', shutdown);
                process.on('SIGTERM', shutdown);
            } catch (err) {
                boot.fail('Gateway failed to start');
                console.error(err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    gateway
        .command('status')
        .description('Check gateway status')
        .option('-p, --port <port>', 'Gateway port', '4200')
        .action(async (opts) => {
            const s = spinner('Checking gateway...');
            s.start();
            try {
                const res = await fetch(`http://localhost:${opts.port}/api/health`);
                if (res.ok) {
                    const data = await res.json();
                    s.succeed(`Gateway running on port ${opts.port}`);
                    console.log(JSON.stringify(data, null, 2));
                } else {
                    s.fail(`Gateway returned status ${res.status}`);
                }
            } catch {
                s.fail(`No gateway found on port ${opts.port}`);
            }
        });
}
