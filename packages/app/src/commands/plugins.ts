/**
 * Command: plugins — plugin management.
 */
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { bootKernel } from '../kernel.js';

export function registerPluginsCommand(program: Command): void {
    const plugins = program
        .command('plugins')
        .description('Plugin management');

    plugins
        .command('list')
        .description('List installed plugins')
        .option('--env <path>', '.env file path')
        .action(async (opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const list = agent.cliAdmin.pluginsList?.() ?? [];
                if (list.length === 0) {
                    console.log('No plugins installed.');
                } else {
                    for (const p of list) {
                        const icon = p.state === 'active' ? '🟢' : '🔴';
                        console.log(`${icon} ${p.name} v${p.version} — ${p.state}`);
                    }
                }
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    plugins
        .command('enable <name>')
        .description('Enable a plugin')
        .option('--env <path>', '.env file path')
        .action(async (name: string, opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                agent.cliAdmin.pluginsEnable?.(name);
                console.log(`✓ Plugin "${name}" enabled`);
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    plugins
        .command('disable <name>')
        .description('Disable a plugin')
        .option('--env <path>', '.env file path')
        .action(async (name: string, opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                agent.cliAdmin.pluginsDisable?.(name);
                console.log(`✓ Plugin "${name}" disabled`);
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });
}
