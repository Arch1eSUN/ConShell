/**
 * Command: vault — secret management.
 */
import { Command } from 'commander';

export function registerVaultCommand(program: Command): void {
    const vault = program
        .command('vault')
        .description('Manage encrypted secret vault');

    vault
        .command('set <key> <value>')
        .description('Store a secret in the vault')
        .option('--password <password>', 'Vault master password')
        .action(async (key: string, value: string, opts: { password?: string }) => {
            const password = opts.password || process.env['CONSHELL_VAULT_PASSWORD'] || '';
            if (!password) {
                console.error('✗ Master password required. Use --password or CONSHELL_VAULT_PASSWORD env var.');
                process.exit(1);
            }
            const { FileVault } = await import('@conshell/security');
            const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
            const vaultInstance = new FileVault(`${home}/.conshell/vault.enc`, password);
            vaultInstance.setSecret(key, value);
            console.log(`✓ Secret "${key}" stored in vault`);
        });

    vault
        .command('get <key>')
        .description('Retrieve a secret from the vault')
        .option('--password <password>', 'Vault master password')
        .action(async (key: string, opts: { password?: string }) => {
            const password = opts.password || process.env['CONSHELL_VAULT_PASSWORD'] || '';
            if (!password) {
                console.error('✗ Master password required.');
                process.exit(1);
            }
            const { FileVault } = await import('@conshell/security');
            const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
            const vaultInstance = new FileVault(`${home}/.conshell/vault.enc`, password);
            const val = vaultInstance.getSecret(key);
            if (val) {
                console.log(val);
            } else {
                console.error(`✗ Secret "${key}" not found or decryption failed`);
                process.exit(1);
            }
        });

    vault
        .command('list')
        .description('List all stored secret keys')
        .option('--password <password>', 'Vault master password')
        .action(async (opts: { password?: string }) => {
            const password = opts.password || process.env['CONSHELL_VAULT_PASSWORD'] || '';
            if (!password) {
                console.error('✗ Master password required.');
                process.exit(1);
            }
            const { FileVault } = await import('@conshell/security');
            const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
            const vaultInstance = new FileVault(`${home}/.conshell/vault.enc`, password);
            const keys = vaultInstance.listKeys();
            if (keys.length === 0) {
                console.log('No secrets stored.');
            } else {
                console.log(`Stored secrets (${keys.length}):`);
                keys.forEach((k: string) => console.log(`  • ${k}`));
            }
        });

    vault
        .command('delete <key>')
        .description('Delete a secret from the vault')
        .option('--password <password>', 'Vault master password')
        .action(async (key: string, opts: { password?: string }) => {
            const password = opts.password || process.env['CONSHELL_VAULT_PASSWORD'] || '';
            if (!password) {
                console.error('✗ Master password required.');
                process.exit(1);
            }
            const { FileVault } = await import('@conshell/security');
            const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
            const vaultInstance = new FileVault(`${home}/.conshell/vault.enc`, password);
            if (vaultInstance.deleteSecret(key)) {
                console.log(`✓ Secret "${key}" deleted`);
            } else {
                console.error(`✗ Secret "${key}" not found`);
            }
        });
}
