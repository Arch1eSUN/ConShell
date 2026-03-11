/**
 * `conshell start` — Boot agent + HTTP/WS/Dashboard server.
 */
import type { Command } from 'commander';
import { loadConfig, formatProviderStatus } from '../config.js';
import { bootKernel } from '../kernel.js';
import { createAppServer } from '../server.js';
import { banner, success, label, info, openBrowser, spinner } from '../utils/ui.js';

export function registerStartCommand(program: Command, VERSION: string): void {
    program
        .command('start')
        .description('Boot the agent and start the HTTP/WebSocket server')
        .option('-p, --port <port>', 'HTTP port', '4200')
        .option('--db <path>', 'Database path')
        .option('--env <path>', '.env file path')
        .option('-d, --daemon', 'Run in background (daemon mode)')
        .option('--open', 'Automatically open dashboard in browser')
        .action(async (opts) => {
            const config = loadConfig(opts.env);
            const finalConfig = {
                ...config,
                port: parseInt(opts.port, 10) || config.port,
                dbPath: opts.db || config.dbPath,
            };

            // Daemon mode: fork a detached child process
            if (opts.daemon) {
                const { fork } = await import('node:child_process');
                const child = fork(import.meta.url.replace('file://', ''), ['start', '-p', String(finalConfig.port)], {
                    detached: true,
                    stdio: 'ignore',
                });
                child.unref();
                success(`ConShell daemon started (PID: ${child.pid})`);
                info(`Dashboard: http://localhost:${finalConfig.port}`);
                if (opts.open) await openBrowser(`http://localhost:${finalConfig.port}`);
                process.exit(0);
            }

            banner(VERSION);

            label('Agent', finalConfig.agentName);
            label('Database', finalConfig.dbPath);
            label('Port', String(finalConfig.port));
            label('Budget', `${finalConfig.dailyBudgetCents} cents/day`);
            console.log('');
            console.log(formatProviderStatus(finalConfig));
            console.log('');

            const boot = spinner('Booting agent kernel...');
            boot.start();

            try {
                const agent = await bootKernel(finalConfig);
                boot.succeed('Agent kernel online');

                const server = createAppServer(agent);

                server.httpServer.listen(finalConfig.port, () => {
                    console.log('');
                    success(`Server running at http://localhost:${finalConfig.port}`);
                    success(`WebSocket at ws://localhost:${finalConfig.port}/ws`);
                    success(`Dashboard at http://localhost:${finalConfig.port}`);
                    console.log('');
                    info(`Agent state: ${agent.getState()}`);
                    info('Press Ctrl+C to stop');
                    console.log('');

                    if (opts.open) {
                        openBrowser(`http://localhost:${finalConfig.port}`);
                    }
                });

                // Graceful shutdown
                const shutdown = async () => {
                    console.log('');
                    const s = spinner('Shutting down gracefully...');
                    s.start();
                    await server.close();
                    agent.shutdown();
                    s.succeed('Shutdown complete');
                    process.exit(0);
                };

                process.on('SIGINT', shutdown);
                process.on('SIGTERM', shutdown);

            } catch (err) {
                boot.fail('Failed to start');
                console.error(err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });
}
