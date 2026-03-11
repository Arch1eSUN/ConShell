/**
 * `conshell configure` — Interactive config editor using @inquirer/prompts.
 */
import type { Command } from 'commander';
import { input, select } from '@inquirer/prompts';
import { miniBanner, success, label, palette } from '../utils/ui.js';

export function registerConfigureCommand(program: Command): void {
    program
        .command('configure')
        .description('Interactive configuration editor')
        .action(async () => {
            const fsSync = await import('node:fs');
            const pathMod = await import('node:path');

            const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
            const configPath = pathMod.default.join(home, '.conshell', 'config.json');

            let configData: Record<string, unknown> = {};
            if (fsSync.existsSync(configPath)) {
                configData = JSON.parse(fsSync.readFileSync(configPath, 'utf-8'));
            }

            miniBanner('ConShell Configuration', 'Interactive settings editor');

            // Show current values
            console.log(`  ${palette.muted('Current settings:')}\n`);
            for (const [k, v] of Object.entries(configData)) {
                const display = (typeof v === 'string' && (k.includes('key') || k.includes('secret') || k.includes('token')))
                    ? v.slice(0, 8) + '…' : JSON.stringify(v);
                label(k, String(display));
            }
            console.log('');

            // Edit agent name
            const agentName = await input({
                message: 'Agent name',
                default: String(configData['agentName'] || 'conshell-agent'),
            });
            configData['agentName'] = agentName;

            // Edit port
            const port = await input({
                message: 'Port',
                default: String(configData['port'] || '4200'),
                validate: (v) => /^\d+$/.test(v) ? true : 'Must be a number',
            });
            configData['port'] = parseInt(port, 10);

            // Edit log level
            const logLevel = await select({
                message: 'Log level',
                choices: [
                    { name: 'info', value: 'info' },
                    { name: 'debug', value: 'debug' },
                    { name: 'warn', value: 'warn' },
                    { name: 'error', value: 'error' },
                ],
                default: String(configData['logLevel'] || 'info'),
            });
            configData['logLevel'] = logLevel;

            // Edit auth mode
            const authMode = await select({
                message: 'Authentication mode',
                choices: [
                    { name: '🔓 None — Open access (local dev)', value: 'none' },
                    { name: '🔑 Token — Bearer token auth', value: 'token' },
                    { name: '🔐 Password — Password auth', value: 'password' },
                ],
                default: String(configData['authMode'] || 'none'),
            });
            configData['authMode'] = authMode;

            // Edit daily budget
            const budget = await input({
                message: 'Daily budget (cents)',
                default: String(configData['dailyBudgetCents'] || '5000'),
                validate: (v) => /^\d+$/.test(v) ? true : 'Must be a number',
            });
            configData['dailyBudgetCents'] = parseInt(budget, 10);

            // Save
            fsSync.mkdirSync(pathMod.default.dirname(configPath), { recursive: true });
            fsSync.writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf-8');
            console.log('');
            success(`Config saved to ${configPath}`);
            console.log('');
        });
}
