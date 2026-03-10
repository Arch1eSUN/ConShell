#!/usr/bin/env node
/**
 * CLI entry point — Commander-based interface for Conway Automaton.
 *
 * Commands:
 *   web4 start            — Boot agent + start HTTP server
 *   web4 status           — Print agent status
 *   web4 fund <amount>    — Add credits
 *   web4 chat <message>   — One-shot chat message
 */
import { Command } from 'commander';
import { loadConfig, formatProviderStatus } from './config.js';
import { bootKernel } from './kernel.js';
import { createAppServer } from './server.js';
import type { Cents } from '@web4-agent/core';

const VERSION = '0.1.0';

const program = new Command();

program
    .name('web4')
    .description('Conway Automaton — Sovereign AI Agent Runtime')
    .version(VERSION);

// ── start ───────────────────────────────────────────────────────────────

program
    .command('start')
    .description('Boot the agent and start the HTTP/WebSocket server')
    .option('-p, --port <port>', 'HTTP port', '4200')
    .option('--db <path>', 'Database path')
    .option('--env <path>', '.env file path')
    .action(async (opts) => {
        const config = loadConfig(opts.env);
        const finalConfig = {
            ...config,
            port: parseInt(opts.port, 10) || config.port,
            dbPath: opts.db || config.dbPath,
        };

        console.log(`
╔══════════════════════════════════════════╗
║     Conway Automaton  v${VERSION}            ║
║     Sovereign AI Agent Runtime           ║
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

program.parse();
