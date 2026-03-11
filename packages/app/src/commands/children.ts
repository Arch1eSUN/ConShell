/**
 * Command: children — child agent management.
 */
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { bootKernel } from '../kernel.js';

export function registerChildrenCommand(program: Command): void {
    const children = program
        .command('children')
        .description('Child agent management');

    children
        .command('list')
        .description('List child agents')
        .option('--env <path>', '.env file path')
        .action(async (opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const list = agent.cliAdmin.childrenList?.() ?? [];
                if (list.length === 0) {
                    console.log('No children.');
                } else {
                    for (const c of list) {
                        console.log(`[${c.state}] ${c.name} (id: ${c.id})`);
                    }
                }
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    children
        .command('spawn')
        .description('Spawn a new child agent')
        .requiredOption('--name <name>', 'Child agent name')
        .option('--genesis <prompt>', 'Genesis prompt')
        .option('--env <path>', '.env file path')
        .action(async (opts: { name: string; genesis?: string; env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const result = agent.cliAdmin.childrenSpawn?.(opts.name, opts.genesis ?? '') ?? { id: 'n/a' };
                console.log(`✓ Child "${opts.name}" spawned (id: ${result.id})`);
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });
}
