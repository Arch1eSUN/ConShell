/**
 * Command: agent — status, fund, chat, stop, metrics, credits, alerts, identity.
 *
 * Groups the core operational commands that interact with the running agent.
 */
import { Command } from 'commander';
import type { Cents } from '@conshell/core';
import { loadConfig } from '../config.js';
import { bootKernel } from '../kernel.js';

export function registerAgentCommands(program: Command): void {
    // ── status ──
    program
        .command('status')
        .description('Print agent status')
        .option('--env <path>', '.env file path')
        .action(async (opts: { env?: string }) => {
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

    // ── fund ──
    program
        .command('fund <amount>')
        .description('Add credits to the agent (in cents)')
        .option('--env <path>', '.env file path')
        .action(async (amount: string, opts: { env?: string }) => {
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

    // ── chat ──
    program
        .command('chat <message>')
        .description('Send a one-shot chat message to the agent')
        .option('--session <id>', 'Session ID', `cli-${Date.now()}`)
        .option('--env <path>', '.env file path')
        .action(async (message: string, opts: { session: string; env?: string }) => {
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

    // ── stop ──
    program
        .command('stop')
        .description('Stop the running agent')
        .option('-p, --port <port>', 'HTTP port of running agent', '4200')
        .action(async (opts: { port: string }) => {
            try {
                const res = await fetch(`http://localhost:${opts.port}/api/health`);
                if (res.ok) {
                    console.log('Sending shutdown signal...');
                    await fetch(`http://localhost:${opts.port}/api/shutdown`, { method: 'POST' });
                    console.log('✓ Agent stopped');
                }
            } catch {
                console.log('No running agent found on port ' + opts.port);
            }
        });

    // ── metrics ──
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

    // ── credits ──
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

    // ── alerts ──
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

    // ── identity ──
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

    // ── config show ──
    const configCmd = program
        .command('config')
        .description('Manage agent configuration');

    configCmd
        .command('show')
        .description('Display current configuration')
        .option('--env <path>', '.env file path')
        .action(async (opts: { env?: string }) => {
            const config = loadConfig(opts.env);
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
}
