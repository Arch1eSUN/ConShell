/**
 * Command: memory — memory layer operations.
 */
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { bootKernel } from '../kernel.js';

export function registerMemoryCommand(program: Command): void {
    const memory = program
        .command('memory')
        .description('Memory layer operations');

    memory
        .command('search <query>')
        .description('Search agent memory')
        .option('--limit <n>', 'Max results', '5')
        .option('--env <path>', '.env file path')
        .action(async (query: string, opts: { limit: string; env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const results = agent.cliAdmin.memorySearch?.(query) ?? [];
                if (results.length === 0) {
                    console.log('No results found.');
                } else {
                    for (const r of results) {
                        console.log(`[${r.score?.toFixed(3) ?? '?'}] ${r.content?.slice(0, 100) ?? '(empty)'}...`);
                    }
                }
                agent.shutdown();
            } catch (err) {
                console.error('Memory search failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    memory
        .command('status')
        .description('Show memory layer statistics')
        .option('--env <path>', '.env file path')
        .action(async (opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const stats = agent.cliAdmin.memoryStatus?.() ?? { layers: [] };
                console.log('Memory Status:');
                for (const layer of stats.layers) {
                    console.log(`  ${layer.name}: ${layer.count} items (${layer.tokens ?? '?'} tokens)`);
                }
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });
}
