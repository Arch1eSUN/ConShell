#!/usr/bin/env node
/**
 * CLI entry point — Commander-based interface for ConShell.
 *
 * Commands:
 *   conshell                — REPL interactive mode
 *   conshell start          — Boot agent + start HTTP server
 *   conshell gateway run    — Start gateway (HTTP+WS+Dashboard)
 *   conshell onboard        — First-time setup wizard (interactive)
 *   conshell login          — Connect AI provider accounts (OAuth)
 *   conshell daemon         — Manage the background daemon
 *   conshell configure      — Interactive config editor
 *   conshell doctor         — Health diagnostics
 *   conshell ui             — Open WebUI in browser
 *   conshell update         — Self-update from git
 */
import { Command } from 'commander';

// ── Modular command imports ─────────────────────────────────────────────
import { registerStartCommand } from './commands/start.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerConfigureCommand } from './commands/configure.js';
import { registerGatewayCommand } from './commands/gateway.js';
import { registerUpdateCommand } from './commands/update.js';
import { registerUiCommand } from './commands/ui.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerVaultCommand } from './commands/vault.js';
import { registerSecurityCommand } from './commands/security.js';
import { registerMemoryCommand } from './commands/memory.js';
import { registerSoulCommand } from './commands/soul.js';
import { registerChildrenCommand } from './commands/children.js';
import { registerPluginsCommand } from './commands/plugins.js';
import { registerChannelsCommand } from './commands/channels.js';
import { registerBackupCommand } from './commands/backup.js';
import { registerLoginCommand } from './commands/login.js';

const VERSION = '0.1.0';

const program = new Command();

program
    .name('conshell')
    .description('ConShell — Sovereign AI Agent Runtime')
    .version(VERSION);

// ── Register all command modules ────────────────────────────────────────
registerStartCommand(program, VERSION);
registerGatewayCommand(program, VERSION);
registerDoctorCommand(program);
registerConfigureCommand(program);
registerUpdateCommand(program);
registerUiCommand(program);
registerAgentCommands(program);
registerVaultCommand(program);
registerSecurityCommand(program);
registerMemoryCommand(program);
registerSoulCommand(program);
registerChildrenCommand(program);
registerPluginsCommand(program);
registerChannelsCommand(program);
registerBackupCommand(program);
registerLoginCommand(program);

// ── onboard (lazy-loaded from @conshell/cli) ────────────────────────────
program
    .command('onboard')
    .description('First-time setup wizard (interactive)')
    .option('--defaults', 'Use default values (non-interactive)')
    .option('--install-daemon', 'Also install the background daemon service')
    .action(async (opts: { defaults?: boolean; installDaemon?: boolean }) => {
        try {
            const { runOnboard } = await import('@conshell/cli');
            await runOnboard({ defaults: opts.defaults, installDaemon: opts.installDaemon });
        } catch (err) {
            console.error('Onboard failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── daemon management ───────────────────────────────────────────────────
const daemonCmd = program
    .command('daemon')
    .description('Manage the ConShell background daemon');

daemonCmd
    .command('install')
    .description('Install daemon (launchd on macOS, systemd on Linux)')
    .option('-p, --port <port>', 'Server port', '4200')
    .action(async (opts: { port: string }) => {
        try {
            const { installDaemon } = await import('@conshell/cli');
            const status = installDaemon({ port: parseInt(opts.port, 10) });
            console.log(`✅ Daemon installed (${status.platform})`);
            if (status.servicePath) console.log(`   Service: ${status.servicePath}`);
            if (status.running) console.log('   Status: running');
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

daemonCmd
    .command('uninstall')
    .description('Uninstall the ConShell daemon service')
    .action(async () => {
        try {
            const { uninstallDaemon } = await import('@conshell/cli');
            uninstallDaemon();
            console.log('✅ Daemon uninstalled');
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

daemonCmd
    .command('status')
    .description('Check daemon status')
    .action(async () => {
        try {
            const { getDaemonStatus } = await import('@conshell/cli');
            const s = getDaemonStatus();
            console.log(`  Platform:  ${s.platform}`);
            console.log(`  Installed: ${s.installed ? '✅ yes' : '❌ no'}`);
            console.log(`  Running:   ${s.running ? '✅ yes' : '❌ no'}`);
            if (s.pid) console.log(`  PID:       ${s.pid}`);
            if (s.servicePath) console.log(`  Service:   ${s.servicePath}`);
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });



// ── Default action: REPL mode ───────────────────────────────────────────
if (process.argv.length <= 2) {
    (async () => {
        const { startRepl } = await import('./repl.js');
        await startRepl(VERSION);
    })();
} else {
    program.parse();
}
