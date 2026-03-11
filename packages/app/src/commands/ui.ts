/**
 * `conshell ui` — Open dashboard in browser.
 */
import type { Command } from 'commander';
import { success, info, warn, spinner, openBrowser } from '../utils/ui.js';

export function registerUiCommand(program: Command): void {
    program
        .command('ui')
        .description('Open the ConShell dashboard in your browser')
        .option('-p, --port <port>', 'Dashboard port', '4200')
        .action(async (opts) => {
            const url = `http://localhost:${opts.port}`;

            // First check if the server is running
            const s = spinner('Checking server...');
            s.start();

            try {
                const res = await fetch(`${url}/api/health`);
                if (res.ok) {
                    s.succeed('Server is running');
                    info(`Opening ${url}...`);
                    await openBrowser(url);
                    success('Dashboard opened in browser');
                } else {
                    s.warn(`Server returned ${res.status}`);
                    info('Start the server first: conshell start');
                }
            } catch {
                s.warn('Server not running');
                info(`Start server first: conshell start -p ${opts.port}`);
                console.log('');

                // Offer to start and open
                const { confirm } = await import('@inquirer/prompts');
                const start = await confirm({
                    message: 'Start server and open dashboard?',
                    default: true,
                });

                if (start) {
                    const startSpin = spinner('Starting server...');
                    startSpin.start();
                    try {
                        const { fork } = await import('node:child_process');
                        const child = fork(process.argv[1]!, ['start', '-p', opts.port], {
                            detached: true,
                            stdio: 'ignore',
                        });
                        child.unref();

                        // Wait for server
                        await new Promise(r => setTimeout(r, 3000));
                        startSpin.succeed(`Server started (PID: ${child.pid})`);
                        await openBrowser(url);
                        success('Dashboard opened');
                    } catch {
                        startSpin.fail('Could not start server');
                    }
                }
            }
            console.log('');
        });
}
