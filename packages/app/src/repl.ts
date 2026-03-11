/**
 * REPL — Interactive terminal mode for ConShell.
 *
 * When user runs `conshell` with no subcommand, this module launches:
 *   1. An interactive readline-based chat loop
 *   2. Background heartbeat daemon
 *
 * Supports slash commands: /status, /soul, /memory, /help, /quit
 */

import * as readline from 'node:readline';
import { loadConfig, formatProviderStatus } from './config.js';
import { bootKernel } from './kernel.js';

type KernelInstance = Awaited<ReturnType<typeof bootKernel>>;

// ── Slash Commands ──────────────────────────────────────────────────────

const SLASH_COMMANDS: Record<string, { desc: string; handler: (agent: KernelInstance) => void | Promise<void> }> = {
    '/help': {
        desc: 'Show available commands',
        handler() {
            console.log('\n  Available commands:');
            for (const [cmd, { desc }] of Object.entries(SLASH_COMMANDS)) {
                console.log(`    ${cmd.padEnd(12)} — ${desc}`);
            }
            console.log('    (free text) — Chat with the agent\n');
        },
    },
    '/status': {
        desc: 'Show agent status',
        handler(agent) {
            const s = agent.cliAdmin.status();
            console.log(`\n  State:   ${s.agentState}`);
            console.log(`  Tier:    ${s.survivalTier}`);
            console.log(`  Balance: ${s.financial.netBalanceCents} cents`);
            console.log(`  Tasks:   ${s.heartbeatTasks.length} heartbeat tasks`);
            console.log(`  Children: ${s.aliveChildren}\n`);
        },
    },
    '/soul': {
        desc: 'Show SOUL.md summary',
        handler(agent) {
            const soul = agent.cliAdmin.soulInspect?.();
            if (!soul) {
                console.log('\n  No SOUL.md loaded.\n');
                return;
            }
            console.log(`\n  Name:     ${soul.name}`);
            console.log(`  Version:  ${soul.version}`);
            console.log(`  Values:   ${soul.valuesCount}`);
            console.log(`  Goals:    ${soul.goalsCount}`);
            console.log(`  Hash:     ${soul.currentHash.slice(0, 16)}…\n`);
        },
    },
    '/memory': {
        desc: 'Show memory statistics',
        handler(agent) {
            const stats = agent.cliAdmin.memoryStats?.() ?? { tiers: [], totalEntries: 0 };
            console.log(`\n  Memory: ${stats.totalEntries} total entries`);
            for (const t of stats.tiers) {
                console.log(`    ${t.tier}: ${t.count} entries`);
            }
            console.log('');
        },
    },
    '/credits': {
        desc: 'Show credit balance',
        handler(agent) {
            const c = agent.cliAdmin.credits?.() ?? { balance: 0, tier: 'unknown' };
            console.log(`\n  Balance: ${c.balance} cents`);
            console.log(`  Tier:    ${c.tier}\n`);
        },
    },
    '/quit': {
        desc: 'Exit ConShell',
        handler() {
            // Handled separately in main loop
        },
    },
};

// ── Main REPL ───────────────────────────────────────────────────────────

export async function startRepl(version: string): Promise<void> {
    console.log(`
╔══════════════════════════════════════════╗
║      🐚 ConShell  v${version}                 ║
║   Sovereign AI Agent Runtime — REPL     ║
╚══════════════════════════════════════════╝
`);

    const config = loadConfig();

    console.log(`Agent:     ${config.agentName}`);
    console.log(`Providers:`);
    console.log(formatProviderStatus(config));
    console.log('\nBooting agent...');

    let agent: KernelInstance;
    try {
        agent = await bootKernel(config);
    } catch (err) {
        console.error('Failed to boot:', err instanceof Error ? err.message : err);
        console.error('\nTip: Run `conshell doctor` to diagnose issues.');
        process.exit(1);
    }

    console.log(`✓ Agent online (state: ${agent.getState()})`);
    console.log('Type /help for commands, or start chatting.\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'conshell > ',
    });

    rl.prompt();

    const sessionId = `repl-${Date.now()}`;

    rl.on('line', async (line) => {
        const input = line.trim();

        if (!input) {
            rl.prompt();
            return;
        }

        // Handle slash commands
        if (input.startsWith('/')) {
            const cmd = input.split(' ')[0]!.toLowerCase();

            if (cmd === '/quit' || cmd === '/exit') {
                console.log('\nShutting down agent...');
                agent.shutdown();
                rl.close();
                process.exit(0);
            }

            const handler = SLASH_COMMANDS[cmd];
            if (handler) {
                await handler.handler(agent);
            } else {
                console.log(`  Unknown command: ${cmd}. Type /help for available commands.\n`);
            }
            rl.prompt();
            return;
        }

        // Chat with agent
        try {
            const turn = await agent.agentLoop.executeTurn({
                sessionId,
                role: 'user' as const,
                content: input,
            });

            // Extract response text
            const response = typeof turn === 'string'
                ? turn
                : (turn as any)?.content ?? (turn as any)?.response ?? JSON.stringify(turn, null, 2);

            console.log(`\n  🤖 ${response}\n`);
        } catch (err) {
            console.error(`  ✗ Error: ${err instanceof Error ? err.message : err}\n`);
        }

        rl.prompt();
    });

    rl.on('close', () => {
        console.log('\nGoodbye!');
        agent.shutdown();
        process.exit(0);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nShutting down...');
        agent.shutdown();
        process.exit(0);
    });
}
