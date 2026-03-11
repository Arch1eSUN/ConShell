/**
 * Command: security — security audit utilities.
 */
import { Command } from 'commander';
import { loadConfig } from '../config.js';

export function registerSecurityCommand(program: Command): void {
    const security = program
        .command('security')
        .description('Security utilities');

    security
        .command('audit')
        .description('Run a comprehensive security audit')
        .option('--env <path>', '.env file path')
        .action(async (opts: { env?: string }) => {
            const { miniBanner, success, warn, fail, palette } = await import('../utils/ui.js');

            miniBanner('Security Audit', 'Comprehensive security scan');

            const checks: { name: string; status: 'pass' | 'warn' | 'fail'; detail: string }[] = [];
            const fs = await import('node:fs');
            const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';

            // 1. Check vault exists
            const vaultPath = `${home}/.conshell/vault.enc`;
            if (fs.existsSync(vaultPath)) {
                const stat = fs.statSync(vaultPath);
                const mode = (stat.mode & 0o777).toString(8);
                checks.push({
                    name: 'Vault File',
                    status: mode === '600' ? 'pass' : 'warn',
                    detail: mode === '600' ? 'Exists, permissions OK (0600)' : `Permissions: 0${mode} (should be 0600)`,
                });
            } else {
                checks.push({ name: 'Vault File', status: 'warn', detail: 'Not found — run `conshell vault set` to create' });
            }

            // 2. Check .env for plaintext secrets
            const config = loadConfig(opts.env);
            const envSecrets = Object.entries(config)
                .filter(([k]) =>
                    k.toLowerCase().includes('key') ||
                    k.toLowerCase().includes('token') ||
                    k.toLowerCase().includes('secret')
                )
                .filter(([_, v]) => typeof v === 'string' && v.length > 0);

            if (envSecrets.length > 0) {
                checks.push({
                    name: 'Plaintext Secrets',
                    status: 'warn',
                    detail: `${envSecrets.length} secrets in .env — consider migrating to vault`,
                });
            } else {
                checks.push({ name: 'Plaintext Secrets', status: 'pass', detail: 'No plaintext secrets in .env' });
            }

            // 3. Check wallet file
            const walletPath = `${home}/.conshell/wallet.json`;
            if (fs.existsSync(walletPath)) {
                const stat = fs.statSync(walletPath);
                const mode = (stat.mode & 0o777).toString(8);
                checks.push({
                    name: 'Wallet File',
                    status: mode === '600' ? 'pass' : 'warn',
                    detail: mode === '600' ? 'Encrypted, permissions OK' : `Permissions: 0${mode} (should be 0600)`,
                });
            } else {
                checks.push({ name: 'Wallet File', status: 'pass', detail: 'Not found (will be created on first use)' });
            }

            // 4. Check auth mode
            checks.push({
                name: 'API Authentication',
                status: config.authMode === 'none' ? 'warn' : 'pass',
                detail: `Mode: ${config.authMode || 'none'}`,
            });

            // Print results
            for (const check of checks) {
                const fn = check.status === 'pass' ? success : check.status === 'warn' ? warn : fail;
                fn(`${palette.bold(check.name)}: ${check.detail}`);
            }

            const passCount = checks.filter(c => c.status === 'pass').length;
            const warnCount = checks.filter(c => c.status === 'warn').length;
            const failCount = checks.filter(c => c.status === 'fail').length;

            console.log('');
            const scoreColor = failCount > 0 ? palette.error : warnCount > 0 ? palette.warning : palette.success;
            console.log(`  ${scoreColor(`${passCount}/${checks.length} passed`)}, ${palette.warning(`${warnCount} warnings`)}, ${palette.error(`${failCount} failures`)}`);
            console.log('');
        });
}
