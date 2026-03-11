/**
 * Command: soul — SOUL.md self-description system.
 */
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { bootKernel } from '../kernel.js';

export function registerSoulCommand(program: Command): void {
    const soul = program
        .command('soul')
        .description('SOUL.md self-description system');

    soul
        .command('show')
        .description('Display current SOUL.md contents')
        .option('--env <path>', '.env file path')
        .action(async (opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const content = agent.cliAdmin.soulShow?.() ?? 'No SOUL.md found.';
                console.log(content);
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    soul
        .command('history')
        .description('Show SOUL.md evolution history')
        .option('--limit <n>', 'Max entries', '10')
        .option('--env <path>', '.env file path')
        .action(async (opts: { limit: string; env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const entries = agent.cliAdmin.soulHistory?.(parseInt(opts.limit, 10)) ?? [];
                if (entries.length === 0) {
                    console.log('No history entries.');
                } else {
                    for (const e of entries) {
                        console.log(`[${e.timestamp}] v${e.version} — ${e.summary ?? 'no summary'}`);
                    }
                }
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });
}
