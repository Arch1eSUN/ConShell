#!/usr/bin/env node
/**
 * CLI entry point — Commander-based interface for ConShell.
 *
 * Commands:
 *   conshell                — REPL interactive mode + daemon
 *   conshell start          — Boot agent + start HTTP server
 *   conshell gateway run    — Start gateway (HTTP+WS+Dashboard)
 *   conshell onboard        — First-time setup wizard
 *   conshell configure      — Interactive config editor
 *   conshell doctor         — Health diagnostics
 *   conshell ui             — Open WebUI
 *   conshell chat <message> — One-shot chat message
 */
import { Command } from 'commander';
import { loadConfig, formatProviderStatus } from './config.js';
import { bootKernel } from './kernel.js';
import { createAppServer } from './server.js';
import type { Cents } from '@conshell/core';

const VERSION = '0.1.0';

const program = new Command();

program
    .name('conshell')
    .description('ConShell — Sovereign AI Agent Runtime')
    .version(VERSION);

// ── start ───────────────────────────────────────────────────────────────

program
    .command('start')
    .description('Boot the agent and start the HTTP/WebSocket server')
    .option('-p, --port <port>', 'HTTP port', '4200')
    .option('--db <path>', 'Database path')
    .option('--env <path>', '.env file path')
    .option('-d, --daemon', 'Run in background (daemon mode)')
    .action(async (opts) => {
        const config = loadConfig(opts.env);
        const finalConfig = {
            ...config,
            port: parseInt(opts.port, 10) || config.port,
            dbPath: opts.db || config.dbPath,
        };

        // Daemon mode: fork a detached child process
        if (opts.daemon) {
            const { fork } = await import('node:child_process');
            const child = fork(import.meta.url.replace('file://', ''), ['start', '-p', String(finalConfig.port)], {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
            console.log(`✓ ConShell daemon started (PID: ${child.pid})`);
            console.log(`  Dashboard: http://localhost:${finalConfig.port}`);
            process.exit(0);
        }

        console.log(`
╔══════════════════════════════════════════╗
║       ConShell  v${VERSION}                   ║
║   Sovereign AI Agent Runtime             ║
╚══════════════════════════════════════════╝
`);

        console.log(`Agent:     ${finalConfig.agentName}`);
        console.log(`Database:  ${finalConfig.dbPath}`);
        console.log(`Port:      ${finalConfig.port}`);
        console.log(`Budget:    ${finalConfig.dailyBudgetCents} cents/day`);
        console.log(`\nProviders:`);
        console.log(formatProviderStatus(finalConfig));
        console.log('');

        try {
            const agent = await bootKernel(finalConfig);
            const server = createAppServer(agent);

            server.httpServer.listen(finalConfig.port, () => {
                console.log(`\n✓ Server running at http://localhost:${finalConfig.port}`);
                console.log(`✓ WebSocket at ws://localhost:${finalConfig.port}/ws`);
                console.log(`✓ Dashboard at http://localhost:${finalConfig.port}`);
                console.log(`\nAgent state: ${agent.getState()}`);
                console.log('Press Ctrl+C to stop\n');
            });

            // Graceful shutdown
            const shutdown = async () => {
                console.log('\nShutting down...');
                await server.close();
                agent.shutdown();
                process.exit(0);
            };

            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);

        } catch (err) {
            console.error('Failed to start:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── status ──────────────────────────────────────────────────────────────

program
    .command('status')
    .description('Print agent status')
    .option('--env <path>', '.env file path')
    .action(async (opts) => {
        const config = loadConfig(opts.env);

        try {
            const agent = await bootKernel(config);
            const status = agent.cliAdmin.status();

            console.log(JSON.stringify(status, null, 2));

            agent.shutdown();
        } catch (err) {
            console.error('Failed to get status:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── fund ────────────────────────────────────────────────────────────────

program
    .command('fund <amount>')
    .description('Add credits to the agent (in cents)')
    .option('--env <path>', '.env file path')
    .action(async (amount: string, opts) => {
        const cents = parseInt(amount, 10);
        if (isNaN(cents) || cents <= 0) {
            console.error('Amount must be a positive integer (cents)');
            process.exit(1);
        }

        const config = loadConfig(opts.env);

        try {
            const agent = await bootKernel(config);
            const result = agent.cliAdmin.fund(cents as Cents);

            if (result.success) {
                console.log(`✓ Funded ${cents} cents (tx: ${result.transactionId})`);
            } else {
                console.error(`✗ ${result.error}`);
            }

            agent.shutdown();
        } catch (err) {
            console.error('Failed to fund:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── chat ────────────────────────────────────────────────────────────────

program
    .command('chat <message>')
    .description('Send a one-shot chat message to the agent')
    .option('--session <id>', 'Session ID', `cli-${Date.now()}`)
    .option('--env <path>', '.env file path')
    .action(async (message: string, opts) => {
        const config = loadConfig(opts.env);

        try {
            const agent = await bootKernel(config);

            console.log(`> ${message}\n`);

            const turn = await agent.agentLoop.executeTurn({
                sessionId: opts.session,
                role: 'user' as const,
                content: message,
            });

            console.log(`Agent: ${JSON.stringify(turn, null, 2)}`);

            agent.shutdown();
        } catch (err) {
            console.error('Chat failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── vault ───────────────────────────────────────────────────────────────

const vault = program
    .command('vault')
    .description('Manage encrypted secret vault');

vault
    .command('set <key> <value>')
    .description('Store a secret in the vault')
    .option('--password <password>', 'Vault master password')
    .action(async (key: string, value: string, opts) => {
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
    .action(async (key: string, opts) => {
        const password = opts.password || process.env['CONSHELL_VAULT_PASSWORD'] || '';
        if (!password) {
            console.error('✗ Master password required.');
            process.exit(1);
        }
        const { FileVault } = await import('@conshell/security');
        const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
        const vaultInstance = new FileVault(`${home}/.conshell/vault.enc`, password);
        const value = vaultInstance.getSecret(key);
        if (value) {
            console.log(value);
        } else {
            console.error(`✗ Secret "${key}" not found or decryption failed`);
            process.exit(1);
        }
    });

vault
    .command('list')
    .description('List all stored secret keys')
    .option('--password <password>', 'Vault master password')
    .action(async (opts) => {
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
    .action(async (key: string, opts) => {
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

// ── config ──────────────────────────────────────────────────────────────

const configCmd = program
    .command('config')
    .description('Manage agent configuration');

configCmd
    .command('show')
    .description('Display current configuration')
    .option('--env <path>', '.env file path')
    .action(async (opts) => {
        const config = loadConfig(opts.env);
        // Redact sensitive values
        const display = { ...config };
        for (const key of Object.keys(display) as (keyof typeof display)[]) {
            const val = display[key];
            if (typeof val === 'string' && (
                key.toLowerCase().includes('key') ||
                key.toLowerCase().includes('token') ||
                key.toLowerCase().includes('secret')
            )) {
                (display as any)[key] = val.slice(0, 8) + '…' + val.slice(-4);
            }
        }
        console.log(JSON.stringify(display, null, 2));
    });

// ── stop ────────────────────────────────────────────────────────────────

program
    .command('stop')
    .description('Stop the running agent')
    .option('-p, --port <port>', 'HTTP port of running agent', '4200')
    .action(async (opts) => {
        try {
            const res = await fetch(`http://localhost:${opts.port}/api/health`);
            if (res.ok) {
                // Send shutdown signal
                console.log('Sending shutdown signal...');
                await fetch(`http://localhost:${opts.port}/api/shutdown`, { method: 'POST' });
                console.log('✓ Agent stopped');
            }
        } catch {
            console.log('No running agent found on port ' + opts.port);
        }
    });

// ── ui (WebUI) ──────────────────────────────────────────────────────────

program
    .command('ui')
    .alias('dashboard')
    .description('Open the ConShell WebUI in the browser')
    .option('-p, --port <port>', 'HTTP port', '4200')
    .action(async (opts) => {
        const url = `http://localhost:${opts.port}`;
        console.log(`Opening ConShell WebUI: ${url}`);
        try {
            const { exec } = await import('node:child_process');
            const cmd = process.platform === 'darwin' ? 'open' :
                        process.platform === 'win32' ? 'start' : 'xdg-open';
            exec(`${cmd} ${url}`);
        } catch {
            console.log(`Visit: ${url}`);
        }
    });

// ── security audit ──────────────────────────────────────────────────────

const security = program
    .command('security')
    .description('Security utilities');

security
    .command('audit')
    .description('Run a comprehensive security audit')
    .option('--env <path>', '.env file path')
    .action(async (opts) => {
        console.log(`
╔══════════════════════════════════════════╗
║      Security Audit — ConShell          ║
╚══════════════════════════════════════════╝
`);
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
        const icons = { pass: '✓', warn: '⚠', fail: '✗' };
        const colors = { pass: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m' };
        const reset = '\x1b[0m';

        for (const check of checks) {
            console.log(`  ${colors[check.status]}${icons[check.status]}${reset} ${check.name}: ${check.detail}`);
        }

        const passCount = checks.filter(c => c.status === 'pass').length;
        const warnCount = checks.filter(c => c.status === 'warn').length;
        const failCount = checks.filter(c => c.status === 'fail').length;

        console.log(`\n  Score: ${passCount}/${checks.length} passed, ${warnCount} warnings, ${failCount} failures\n`);
    });

// ── init ────────────────────────────────────────────────────────────────

program
    .command('init')
    .description('Initialize a new ConShell agent workspace')
    .option('--name <name>', 'Agent name', 'conshell-agent')
    .option('--dir <path>', 'Target directory', '.')
    .action(async (opts) => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const targetDir = path.default.resolve(opts.dir);

        console.log(`
╔══════════════════════════════════════════╗
║     ConShell — Initialization           ║
╚══════════════════════════════════════════╝
`);
        console.log(`Directory: ${targetDir}`);
        console.log(`Agent:     ${opts.name}\n`);

        // Create ~/.conshell directory structure
        const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
        const conshellHome = path.default.join(home, '.conshell');
        const dirs = [
            conshellHome,
            path.default.join(conshellHome, 'skills'),
            path.default.join(conshellHome, 'backups'),
            path.default.join(conshellHome, 'plugins'),
            path.default.join(conshellHome, 'logs'),
        ];

        for (const dir of dirs) {
            await fs.default.mkdir(dir, { recursive: true });
            console.log(`  ✓ Created ${dir}`);
        }

        // Create default config.json
        const configPath = path.default.join(conshellHome, 'config.json');
        try {
            await fs.default.access(configPath);
            console.log(`  ⚠ Config already exists: ${configPath}`);
        } catch {
            const defaultConfig = {
                agentName: opts.name,
                port: 4200,
                logLevel: 'info',
                authMode: 'token',
                dailyBudgetCents: 5000,
                dbPath: path.default.join(conshellHome, 'state.db'),
                providers: {},
            };
            await fs.default.writeFile(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf-8');
            console.log(`  ✓ Created ${configPath}`);
        }

        // Create .env template
        const envPath = path.default.join(targetDir, '.env');
        try {
            await fs.default.access(envPath);
            console.log(`  ⚠ .env already exists: ${envPath}`);
        } catch {
            const envTemplate = [
                '# ConShell Agent Configuration',
                `AGENT_NAME=${opts.name}`,
                `AGENT_HOME=${conshellHome}`,
                `PORT=4200`,
                `LOG_LEVEL=info`,
                `DB_PATH=${path.default.join(conshellHome, 'state.db')}`,
                '',
                '# Authentication (token | password | none)',
                'CONSHELL_AUTH_MODE=token',
                '# CONSHELL_AUTH_SECRET=your-secret-here',
                '',
                '# LLM Providers (uncomment and fill)',
                '# OLLAMA_URL=http://localhost:11434',
                '# OPENAI_API_KEY=sk-...',
                '# ANTHROPIC_API_KEY=sk-ant-...',
                '# GEMINI_API_KEY=...',
                '',
                '# Daily budget in cents',
                'DAILY_BUDGET_CENTS=5000',
                '',
            ].join('\n');
            await fs.default.writeFile(envPath, envTemplate, 'utf-8');
            console.log(`  ✓ Created ${envPath}`);
        }

        console.log(`\n✓ Initialization complete!\n`);
        console.log(`Next steps:`);
        console.log(`  1. Edit ${envPath} with your API keys`);
        console.log(`  2. Run: conshell start`);
        console.log(`  3. Open: http://localhost:4200`);
    });

// ── config get/set ──────────────────────────────────────────────────────

configCmd
    .command('get <key>')
    .description('Get a configuration value')
    .action(async (key: string) => {
        const fs = await import('node:fs');
        const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
        const configPath = `${home}/.conshell/config.json`;

        if (!fs.existsSync(configPath)) {
            console.error('✗ Config not found. Run `conshell init` first.');
            process.exit(1);
        }

        const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const value = configData[key];
        if (value === undefined) {
            console.error(`✗ Key "${key}" not found in config`);
            process.exit(1);
        }
        console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
    });

configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key: string, value: string) => {
        const fs = await import('node:fs');
        const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
        const configPath = `${home}/.conshell/config.json`;

        let configData: Record<string, unknown> = {};
        if (fs.existsSync(configPath)) {
            configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }

        // Auto-coerce types
        let parsed: unknown;
        if (value === 'true') parsed = true;
        else if (value === 'false') parsed = false;
        else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);
        else parsed = value;

        configData[key] = parsed;
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf-8');
        console.log(`✓ Set ${key} = ${JSON.stringify(parsed)}`);
    });

// ── restart ─────────────────────────────────────────────────────────────

program
    .command('restart')
    .description('Restart the running agent (stop + start)')
    .option('-p, --port <port>', 'HTTP port', '4200')
    .option('--env <path>', '.env file path')
    .action(async (opts) => {
        console.log('Restarting agent...');
        try {
            // Stop existing instance
            await fetch(`http://localhost:${opts.port}/api/shutdown`, { method: 'POST' });
            console.log('✓ Stopped existing instance');

            // Wait for port to free
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch {
            console.log('No running instance found, starting fresh...');
        }

        // Re-execute start command
        const config = loadConfig(opts.env);
        const finalConfig = {
            ...config,
            port: parseInt(opts.port, 10) || config.port,
        };

        try {
            const agent = await bootKernel(finalConfig);
            const server = createAppServer(agent);

            server.httpServer.listen(finalConfig.port, () => {
                console.log(`✓ Agent restarted at http://localhost:${finalConfig.port}`);
            });

            const shutdown = async () => {
                await server.close();
                agent.shutdown();
                process.exit(0);
            };
            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);
        } catch (err) {
            console.error('Restart failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── privacy ─────────────────────────────────────────────────────────────

const privacy = program
    .command('privacy')
    .description('PII detection and data privacy tools');

privacy
    .command('scan <text>')
    .description('Scan text for PII (email, phone, credit card, SSN, etc.)')
    .action(async (text: string) => {
        const { detectPII, hasPII } = await import('@conshell/security');
        const matches = detectPII(text);

        if (!hasPII(text)) {
            console.log('✓ No PII detected.');
            return;
        }

        console.log(`⚠ Found ${matches.length} PII match(es):\n`);
        for (const match of matches) {
            console.log(`  • ${match.type}: "${match.value}" (at index ${match.index})`);
        }
    });

privacy
    .command('redact <text>')
    .description('Redact PII from text')
    .action(async (text: string) => {
        const { redactPII, detectPII } = await import('@conshell/security');
        const matches = detectPII(text);
        const redacted = redactPII(text);

        if (matches.length === 0) {
            console.log(text);
            console.log('\n✓ No PII to redact.');
            return;
        }

        console.log(redacted);
        console.log(`\n✓ Redacted ${matches.length} PII item(s).`);
    });

// ── constitution ────────────────────────────────────────────────────────

program
    .command('constitution')
    .description('Print the Three Laws constitution')
    .action(async () => {
        const { getConstitutionText } = await import('@conshell/core');
        console.log(getConstitutionText());
    });

// ── memory ──────────────────────────────────────────────────────────────

const memory = program
    .command('memory')
    .description('Memory system management');

memory
    .command('search <query>')
    .description('Search across all memory layers')
    .option('--env <path>', '.env file path')
    .action(async (query: string, opts: { env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const results = agent.cliAdmin.memorySearch?.(query) ?? [];
            if (results.length === 0) {
                console.log('No memories found.');
            } else {
                for (const r of results) {
                    console.log(`[${r.layer}] ${r.content} (score: ${r.score ?? 'n/a'})`);
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

// ── soul ────────────────────────────────────────────────────────────────

const soul = program
    .command('soul')
    .description('SOUL.md self-description system');

soul
    .command('show')
    .description('Display current SOUL.md contents')
    .option('--env <path>', '.env file path')
    .action(async (opts: { env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const content = agent.cliAdmin.soulShow?.() ?? 'No SOUL.md found.';
            console.log(content);
            agent.shutdown();
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

soul
    .command('history')
    .description('Show SOUL.md evolution history')
    .option('--limit <n>', 'Max entries', '10')
    .option('--env <path>', '.env file path')
    .action(async (opts: { limit: string; env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const entries = agent.cliAdmin.soulHistory?.(parseInt(opts.limit, 10)) ?? [];
            if (entries.length === 0) {
                console.log('No history entries.');
            } else {
                for (const e of entries) {
                    console.log(`[${e.timestamp}] v${e.version} — ${e.summary ?? 'no summary'}`);
                }
            }
            agent.shutdown();
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── metrics / alerts ────────────────────────────────────────────────────

program
    .command('metrics')
    .description('Show agent performance metrics')
    .option('--env <path>', '.env file path')
    .action(async (opts: { env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const metrics = agent.cliAdmin.metrics?.() ?? {};
            console.log(JSON.stringify(metrics, null, 2));
            agent.shutdown();
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

const alerts = program
    .command('alerts')
    .description('Alert management');

alerts
    .command('list')
    .description('List active alerts')
    .option('--env <path>', '.env file path')
    .action(async (opts: { env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const list = agent.cliAdmin.alertsList?.() ?? [];
            if (list.length === 0) {
                console.log('✓ No active alerts.');
            } else {
                for (const a of list) {
                    console.log(`⚠ [${a.severity}] ${a.message}`);
                }
            }
            agent.shutdown();
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── credits ─────────────────────────────────────────────────────────────

program
    .command('credits')
    .description('Show credit balance and tier')
    .option('--env <path>', '.env file path')
    .action(async (opts: { env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const info = agent.cliAdmin.credits?.() ?? { balance: 0, tier: 'unknown' };
            console.log(`Balance: ${info.balance} cents`);
            console.log(`Tier:    ${info.tier}`);
            agent.shutdown();
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── identity ────────────────────────────────────────────────────────────

const identity = program
    .command('identity')
    .description('On-chain agent identity');

identity
    .command('show')
    .description('Display agent identity card')
    .option('--env <path>', '.env file path')
    .action(async (opts: { env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const card = agent.cliAdmin.identityShow?.() ?? { name: config.agentName, address: 'not configured' };
            console.log(`Name:    ${card.name}`);
            console.log(`Address: ${card.address}`);
            if (card.capabilities) console.log(`Capabilities: ${card.capabilities.join(', ')}`);
            agent.shutdown();
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── children ────────────────────────────────────────────────────────────

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
            console.log(`✓ Spawned child "${opts.name}" (id: ${result.id})`);
            agent.shutdown();
        } catch (err) {
            console.error('Spawn failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

children
    .command('status <id>')
    .description('Get child agent status')
    .option('--env <path>', '.env file path')
    .action(async (id: string, opts: { env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const status = agent.cliAdmin.childrenStatus?.(id) ?? { state: 'unknown' };
            console.log(JSON.stringify(status, null, 2));
            agent.shutdown();
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── social ──────────────────────────────────────────────────────────────

const social = program
    .command('social')
    .description('Agent-to-agent social layer');

social
    .command('inbox')
    .description('View social inbox')
    .option('--limit <n>', 'Max messages', '20')
    .option('--env <path>', '.env file path')
    .action(async (opts: { limit: string; env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const messages = agent.cliAdmin.socialInbox?.(parseInt(opts.limit, 10)) ?? [];
            if (messages.length === 0) {
                console.log('Inbox is empty.');
            } else {
                for (const m of messages) {
                    console.log(`[${m.timestamp}] From: ${m.from}`);
                    console.log(`  ${m.content}\n`);
                }
            }
            agent.shutdown();
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

social
    .command('send <agent> <message>')
    .description('Send a message to another agent')
    .option('--env <path>', '.env file path')
    .action(async (agentAddr: string, message: string, opts: { env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const result = agent.cliAdmin.socialSend?.(agentAddr, message) ?? { sent: false };
            if (result.sent) {
                console.log(`✓ Message sent to ${agentAddr}`);
            } else {
                console.log(`✗ Failed to send: ${result.error ?? 'unknown'}`);
            }
            agent.shutdown();
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── plugins ─────────────────────────────────────────────────────────────

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
                    console.log(`[${p.state}] ${p.name} v${p.version}`);
                }
            }
            agent.shutdown();
        } catch (err) {
            console.error('Failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

plugins
    .command('install <url>')
    .description('Install a plugin from URL')
    .option('--env <path>', '.env file path')
    .action(async (url: string, opts: { env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const result = agent.cliAdmin.pluginsInstall?.(url) ?? { installed: false };
            if (result.installed) {
                console.log(`✓ Plugin installed from ${url}`);
            } else {
                console.log(`✗ Install failed: ${result.error ?? 'unknown'}`);
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

// ── channels ────────────────────────────────────────────────────────────

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

// ── backup ──────────────────────────────────────────────────────────────

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
    .description('Restore from backup')
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

// ── doctor ──────────────────────────────────────────────────────────────

program
    .command('doctor')
    .description('Run system health diagnostics')
    .option('--fix', 'Auto-fix issues where possible')
    .option('--env <path>', '.env file path')
    .action(async (opts: { fix?: boolean; env?: string }) => {
        const config = loadConfig(opts.env);
        try {
            const agent = await bootKernel(config);
            const report = await agent.cliAdmin.doctor(opts.fix ?? false);
            const formatted = await agent.cliAdmin.formatDoctor(report);
            console.log(formatted);

            agent.shutdown();
        } catch (err) {
            console.error('Doctor failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── update ──────────────────────────────────────────────────────────────

program
    .command('update')
    .description('Pull latest code from GitHub and rebuild')
    .option('--dry-run', 'Check for updates only, do not install')
    .action(async (opts: { dryRun?: boolean }) => {
        const { execSync } = await import('node:child_process');
        const path = await import('node:path');
        const fs = await import('node:fs');

        // Find the source directory (where the repo lives)
        // Priority: CONSHELL_SOURCE_DIR > ~/.conshell/source > ancestor with .git
        const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
        const candidates = [
            process.env['CONSHELL_SOURCE_DIR'],
            path.default.join(home, '.conshell', 'source'),
            // Walk up from current binary location
            path.default.resolve(new URL(import.meta.url).pathname, '..', '..', '..'),
        ].filter(Boolean) as string[];

        let sourceDir: string | null = null;
        for (const dir of candidates) {
            if (fs.existsSync(path.default.join(dir, '.git')) &&
                fs.existsSync(path.default.join(dir, 'packages', 'app', 'package.json'))) {
                sourceDir = dir;
                break;
            }
        }

        if (!sourceDir) {
            console.error('✗ Cannot find ConShell source directory.');
            console.error('  Expected at: ~/.conshell/source/');
            console.error('  Or set CONSHELL_SOURCE_DIR environment variable.');
            console.error('  Re-install: git clone git@github.com:Arch1eSUN/WEB4.0.git && cd WEB4.0 && bash scripts/install.sh');
            process.exit(1);
        }

        console.log(`\n🐚 ConShell Update\n`);
        console.log(`  Source: ${sourceDir}`);

        // Check for updates (git fetch + compare)
        try {
            execSync('git fetch origin', { cwd: sourceDir, stdio: 'pipe' });
            const local = execSync('git rev-parse HEAD', { cwd: sourceDir, encoding: 'utf-8' }).trim();
            const remote = execSync('git rev-parse origin/main', { cwd: sourceDir, encoding: 'utf-8' }).trim();

            if (local === remote) {
                console.log(`  Status: ✓ Already up to date (${local.slice(0, 8)})`);
                return;
            }

            // Show what's new
            const log = execSync(`git log --oneline ${local}..${remote}`, { cwd: sourceDir, encoding: 'utf-8' }).trim();
            const commitCount = log.split('\n').length;
            console.log(`  Status: ${commitCount} new commit(s) available`);
            console.log(`  Current: ${local.slice(0, 8)}`);
            console.log(`  Latest:  ${remote.slice(0, 8)}`);
            console.log(`\n  Changes:`);
            for (const line of log.split('\n').slice(0, 10)) {
                console.log(`    ${line}`);
            }
            if (commitCount > 10) {
                console.log(`    ... and ${commitCount - 10} more`);
            }

            if (opts.dryRun) {
                console.log('\n  (dry-run — no changes applied)');
                return;
            }

            // Pull + rebuild
            console.log('\n  Pulling updates...');
            execSync('git pull --rebase origin main', { cwd: sourceDir, stdio: 'inherit' });

            console.log('\n  Installing dependencies...');
            execSync('pnpm install', { cwd: sourceDir, stdio: 'inherit' });

            console.log('\n  Building...');
            execSync('pnpm -r build', { cwd: sourceDir, stdio: 'inherit' });

            console.log('\n  Re-linking...');
            execSync('npm link', { cwd: path.default.join(sourceDir, 'packages', 'app'), stdio: 'inherit' });

            const newHash = execSync('git rev-parse HEAD', { cwd: sourceDir, encoding: 'utf-8' }).trim();
            console.log(`\n✓ Updated to ${newHash.slice(0, 8)}`);
            console.log('  Restart any running ConShell instances to apply changes.');

        } catch (err) {
            console.error('✗ Update failed:', err instanceof Error ? err.message : err);
            console.error('  Try manually: cd ' + sourceDir + ' && git pull && pnpm build');
            process.exit(1);
        }
    });

// ── onboard ─────────────────────────────────────────────────────────────

program
    .command('onboard')
    .description('First-time setup wizard (interactive)')
    .option('--defaults', 'Use default values (non-interactive)')
    .action(async (opts: { defaults?: boolean }) => {
        try {
            const { runOnboard } = await import('@conshell/cli');
            await runOnboard({ defaults: opts.defaults });
        } catch (err) {
            console.error('Onboard failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

// ── tui ─────────────────────────────────────────────────────────────────

program
    .command('tui')
    .description('Launch terminal UI dashboard')
    .option('--env <path>', '.env file path')
    .action(async (_opts: { env?: string }) => {
        const { TuiRenderer } = await import('@conshell/core');
        const tui = new TuiRenderer({ width: process.stdout.columns || 80, height: process.stdout.rows || 24 });

        tui.addPanel('status', 'Status', 4);
        tui.addPanel('logs', 'Logs', 10);
        tui.addPanel('chat', 'Chat', 6);

        tui.appendToPanel('status', `Agent: Conway Automaton v${VERSION}`);
        tui.appendToPanel('status', `State: starting...`);
        tui.setStatus('Running');

        tui.registerKeybinding('q', 'Quit', () => process.exit(0));
        tui.registerKeybinding('s', 'Status', () => tui.setActivePanel('status'));
        tui.registerKeybinding('l', 'Logs', () => tui.setActivePanel('logs'));

        process.stdout.write(tui.render());

        console.log('\n\nTUI mode (basic). For full interactive TUI, a future update will add readline support.');
        console.log('Press Ctrl+C to exit.');
    });

// ── configure (interactive config editor) ───────────────────────────────

program
    .command('configure')
    .description('Interactive configuration editor')
    .action(async () => {
        const fsSync = await import('node:fs');
        const pathMod = await import('node:path');
        const readlineM = await import('node:readline');

        const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
        const configPath = pathMod.default.join(home, '.conshell', 'config.json');

        let configData: Record<string, unknown> = {};
        if (fsSync.existsSync(configPath)) {
            configData = JSON.parse(fsSync.readFileSync(configPath, 'utf-8'));
        }

        console.log(`
╔══════════════════════════════════════════╗
║     ConShell — Configuration Editor     ║
╚══════════════════════════════════════════╝
`);
        console.log('Current config:');
        for (const [k, v] of Object.entries(configData)) {
            const display = (typeof v === 'string' && (k.includes('key') || k.includes('secret') || k.includes('token')))
                ? v.slice(0, 8) + '…' : JSON.stringify(v);
            console.log(`  ${k} = ${display}`);
        }

        const rl = readlineM.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, a => r(a.trim())));

        console.log('\nEdit settings (press Enter to keep current value):');

        const editableKeys = ['agentName', 'port', 'logLevel', 'authMode', 'dailyBudgetCents'];
        for (const key of editableKeys) {
            const current = configData[key] ?? '';
            const answer = await ask(`  ${key} [${current}]: `);
            if (answer) {
                configData[key] = /^\d+$/.test(answer) ? parseInt(answer, 10) : answer;
            }
        }

        rl.close();

        fsSync.mkdirSync(pathMod.default.dirname(configPath), { recursive: true });
        fsSync.writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf-8');
        console.log(`\n✓ Config saved to ${configPath}`);
    });

// ── gateway ─────────────────────────────────────────────────────────────

const gateway = program
    .command('gateway')
    .description('Manage the ConShell gateway (control plane)');

gateway
    .command('run')
    .description('Start the gateway (HTTP + WebSocket + Dashboard)')
    .option('-p, --port <port>', 'Gateway port', '4200')
    .option('--bind <mode>', 'Bind mode (loopback | lan)', 'loopback')
    .option('--env <path>', '.env file path')
    .action(async (opts) => {
        const config = loadConfig(opts.env);
        const finalConfig = {
            ...config,
            port: parseInt(opts.port, 10) || config.port,
        };

        console.log(`
╔══════════════════════════════════════════╗
║     ConShell Gateway  v${VERSION}             ║
╚══════════════════════════════════════════╝
`);

        try {
            const agent = await bootKernel(finalConfig);
            const server = createAppServer(agent);
            const host = opts.bind === 'lan' ? '0.0.0.0' : '127.0.0.1';

            server.httpServer.listen(finalConfig.port, host, () => {
                console.log(`✓ Gateway running at http://${host}:${finalConfig.port}`);
                console.log(`✓ WebSocket at ws://${host}:${finalConfig.port}/ws`);
                console.log(`✓ Dashboard at http://${host}:${finalConfig.port}`);
                console.log(`✓ Bind mode: ${opts.bind}`);
                console.log(`\nAgent state: ${agent.getState()}`);
                console.log('Press Ctrl+C to stop\n');
            });

            const shutdown = async () => {
                console.log('\nShutting down gateway...');
                await server.close();
                agent.shutdown();
                process.exit(0);
            };
            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);
        } catch (err) {
            console.error('Gateway failed:', err instanceof Error ? err.message : err);
            process.exit(1);
        }
    });

gateway
    .command('status')
    .description('Check gateway status')
    .option('-p, --port <port>', 'Gateway port', '4200')
    .action(async (opts) => {
        try {
            const res = await fetch(`http://localhost:${opts.port}/api/health`);
            if (res.ok) {
                const data = await res.json();
                console.log(`✓ Gateway is running on port ${opts.port}`);
                console.log(JSON.stringify(data, null, 2));
            } else {
                console.log(`✗ Gateway returned status ${res.status}`);
            }
        } catch {
            console.log(`✗ No gateway found on port ${opts.port}`);
        }
    });

// ── Default action: REPL mode ───────────────────────────────────────────

if (process.argv.length <= 2) {
    // No subcommand provided — launch REPL
    (async () => {
        const { startRepl } = await import('./repl.js');
        await startRepl(VERSION);
    })();
} else {
    program.parse();
}

