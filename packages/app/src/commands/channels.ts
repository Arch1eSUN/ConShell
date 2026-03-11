/**
 * Command: channels — multi-platform channel management.
 */
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { bootKernel } from '../kernel.js';

export function registerChannelsCommand(program: Command): void {
    const channels = program
        .command('channels')
        .description('Multi-platform channel management');

    channels
        .command('add <platform> <token>')
        .description('Add a channel (telegram/discord/slack/webhook)')
        .option('--env <path>', '.env file path')
        .action(async (platform: string, token: string, opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const result = agent.cliAdmin.channelsAdd?.(platform, token) ?? { added: false };
                if (result.added) {
                    console.log(`✓ ${platform} channel added`);
                } else {
                    console.log(`✗ Failed: ${result.error ?? 'unknown'}`);
                }
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    channels
        .command('status')
        .description('Show channel statuses')
        .option('--env <path>', '.env file path')
        .action(async (opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const list = agent.cliAdmin.channelsStatus?.() ?? [];
                if (list.length === 0) {
                    console.log('No channels configured.');
                } else {
                    for (const ch of list) {
                        const icon = ch.connected ? '🟢' : '🔴';
                        console.log(`${icon} [${ch.platform}] ${ch.id} — ${ch.connected ? 'connected' : 'disconnected'}`);
                    }
                }
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    channels
        .command('remove <id>')
        .description('Remove a channel')
        .option('--env <path>', '.env file path')
        .action(async (id: string, opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                agent.cliAdmin.channelsRemove?.(id);
                console.log(`✓ Channel "${id}" removed`);
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });
}
