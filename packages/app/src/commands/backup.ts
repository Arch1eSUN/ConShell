/**
 * Command: backup — backup and restore management.
 */
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { bootKernel } from '../kernel.js';

export function registerBackupCommand(program: Command): void {
    const backup = program
        .command('backup')
        .description('Backup and restore management');

    backup
        .command('create')
        .description('Create a new backup')
        .option('--env <path>', '.env file path')
        .action(async (opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const result = agent.cliAdmin.backupCreate?.() ?? { id: 'n/a' };
                console.log(`✓ Backup created (id: ${result.id})`);
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    backup
        .command('list')
        .description('List available backups')
        .option('--env <path>', '.env file path')
        .action(async (opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const list = agent.cliAdmin.backupList?.() ?? [];
                if (list.length === 0) {
                    console.log('No backups found.');
                } else {
                    for (const b of list) {
                        console.log(`[${b.status}] ${b.id} — ${b.agentName} (${b.timestamp})`);
                    }
                }
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    backup
        .command('verify <id>')
        .description('Verify backup integrity')
        .option('--env <path>', '.env file path')
        .action(async (id: string, opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const result = agent.cliAdmin.backupVerify?.(id) ?? { valid: false };
                if (result.valid) {
                    console.log(`✓ Backup ${id} is valid`);
                } else {
                    console.log(`✗ Backup ${id} is invalid: ${result.error ?? 'checksum mismatch'}`);
                }
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });

    backup
        .command('restore <id>')
        .description('Restore from a backup')
        .option('--env <path>', '.env file path')
        .action(async (id: string, opts: { env?: string }) => {
            const config = loadConfig(opts.env);
            try {
                const agent = await bootKernel(config);
                const result = agent.cliAdmin.backupRestore?.(id) ?? { restored: false };
                if (result.restored) {
                    console.log(`✓ Restored from backup ${id}`);
                } else {
                    console.log(`✗ Restore failed: ${result.error ?? 'unknown'}`);
                }
                agent.shutdown();
            } catch (err) {
                console.error('Failed:', err instanceof Error ? err.message : err);
                process.exit(1);
            }
        });
}
