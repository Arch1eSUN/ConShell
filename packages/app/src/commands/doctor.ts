/**
 * `conshell doctor` — Health diagnostics with styled output.
 */
import type { Command } from 'commander';
import { palette, miniBanner, success, warn, fail, label } from '../utils/ui.js';

interface Check {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
}

export function registerDoctorCommand(program: Command): void {
    program
        .command('doctor')
        .description('Run health diagnostics')
        .action(async () => {
            const fs = await import('node:fs');
            const path = await import('node:path');
            const { execSync } = await import('node:child_process');

            miniBanner('ConShell Doctor', 'Health diagnostics');

            const checks: Check[] = [];
            const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
            const conshellHome = path.default.join(home, '.conshell');

            // 1. Config file
            const configPath = path.default.join(conshellHome, 'config.json');
            if (fs.existsSync(configPath)) {
                checks.push({ name: 'Config File', status: 'pass', detail: configPath });
            } else {
                checks.push({ name: 'Config File', status: 'fail', detail: 'Not found — run `conshell onboard`' });
            }

            // 2. Node.js version
            const nodeVer = process.version;
            const major = parseInt(nodeVer.slice(1), 10);
            if (major >= 18) {
                checks.push({ name: 'Node.js', status: 'pass', detail: nodeVer });
            } else {
                checks.push({ name: 'Node.js', status: 'fail', detail: `${nodeVer} (need ≥ 18)` });
            }

            // 3. Ollama
            try {
                execSync('which ollama', { stdio: 'pipe' });
                try {
                    const resp = execSync('curl -sf http://localhost:11434/api/tags 2>/dev/null', {
                        encoding: 'utf-8',
                        timeout: 3000,
                    });
                    const data = JSON.parse(resp) as { models?: { name: string }[] };
                    const count = data.models?.length ?? 0;
                    checks.push({
                        name: 'Ollama',
                        status: count > 0 ? 'pass' : 'warn',
                        detail: count > 0 ? `Running, ${count} model(s)` : 'Running, no models pulled',
                    });
                } catch {
                    checks.push({ name: 'Ollama', status: 'warn', detail: 'Installed but not running' });
                }
            } catch {
                checks.push({ name: 'Ollama', status: 'warn', detail: 'Not installed (optional)' });
            }

            // 4. Wallet file
            const walletPath = path.default.join(conshellHome, 'wallet.json');
            if (fs.existsSync(walletPath)) {
                const stat = fs.statSync(walletPath);
                const mode = (stat.mode & 0o777).toString(8);
                checks.push({
                    name: 'Wallet',
                    status: mode === '600' ? 'pass' : 'warn',
                    detail: mode === '600' ? 'Encrypted, permissions OK' : `Permissions: 0${mode} (should be 0600)`,
                });
            } else {
                checks.push({ name: 'Wallet', status: 'pass', detail: 'Not configured (optional)' });
            }

            // 5. Auth mode
            let authMode = 'none';
            try {
                const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                authMode = cfg.authMode || 'none';
            } catch { /* no config */ }
            checks.push({
                name: 'Auth Mode',
                status: authMode === 'none' ? 'warn' : 'pass',
                detail: authMode,
            });

            // 6. Database
            const dbPath = path.default.join(conshellHome, 'state.db');
            if (fs.existsSync(dbPath)) {
                const size = fs.statSync(dbPath).size;
                const sizeKB = Math.round(size / 1024);
                checks.push({ name: 'Database', status: 'pass', detail: `${sizeKB} KB` });
            } else {
                checks.push({ name: 'Database', status: 'pass', detail: 'Will be created on first run' });
            }

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
