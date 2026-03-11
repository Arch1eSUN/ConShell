/**
 * REPL — Clean terminal chat for ConShell.
 *
 * Matches the WebUI terminal style:
 *   $ user message      (blue prompt)
 *   > agent response    (green prompt)
 *   █ blinking cursor   (while thinking)
 *
 * All kernel logs are suppressed — only the conversation is shown.
 */

import * as readline from 'node:readline';
import { loadConfig } from './config.js';
import { bootKernel } from './kernel.js';
import { SECURITY_TIER_PRESETS, detectTier } from '@conshell/policy';

type KernelInstance = Awaited<ReturnType<typeof bootKernel>>;

// ── Direct stdout/stderr writer (immune to console.log suppression) ─────

const stdout = process.stdout;

function write(text: string): void {
    stdout.write(text);
}

function writeln(text: string = ''): void {
    stdout.write(text + '\n');
}

// ── ANSI codes ──────────────────────────────────────────────────────────

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const GREEN = `${ESC}32m`;
const BLUE = `${ESC}34m`;
const CYAN = `${ESC}36m`;
const MAGENTA = `${ESC}35m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const WHITE = `${ESC}37m`;

// ── Log suppression ─────────────────────────────────────────────────────

function suppressConsoleLogs(): void {
    const noop = () => {};
    console.log = noop;
    console.warn = noop;
    console.info = noop;
    console.debug = noop;
    // Keep console.error but filter kernel-formatted lines
    const origError = console.error;
    console.error = (...args: unknown[]) => {
        const first = String(args[0] ?? '');
        if (first.startsWith('[') && first.includes(']')) return;
        origError(...args);
    };
}

// ── Blinking cursor (like WebUI's █) ────────────────────────────────────

function startCursor(): { stop: () => void } {
    let visible = true;
    const interval = setInterval(() => {
        if (visible) {
            write(`\r  ${GREEN}█${RESET} `);
        } else {
            write(`\r    `);
        }
        visible = !visible;
    }, 500);

    // Show initial cursor
    write(`\r  ${GREEN}█${RESET} `);

    return {
        stop() {
            clearInterval(interval);
            write('\r\x1b[2K'); // clear cursor line
        },
    };
}

// ── Slash commands ──────────────────────────────────────────────────────

function handleSlash(cmd: string, agent: KernelInstance): boolean {
    switch (cmd) {
        case '/help':
            writeln('');
            writeln(`  ${BOLD}Commands${RESET}`);
            writeln(`  ${GREEN}/status${RESET}    ${DIM}Agent status${RESET}`);
            writeln(`  ${GREEN}/soul${RESET}      ${DIM}SOUL.md summary${RESET}`);
            writeln(`  ${GREEN}/memory${RESET}    ${DIM}Memory stats${RESET}`);
            writeln(`  ${GREEN}/credits${RESET}   ${DIM}Credit balance${RESET}`);
            writeln(`  ${GREEN}/tier${RESET}      ${DIM}View/switch security tier${RESET}`);
            writeln(`  ${GREEN}/quit${RESET}      ${DIM}Exit${RESET}`);
            writeln(`  ${DIM}(text)${RESET}     ${DIM}Chat with agent${RESET}`);
            writeln('');
            return true;

        case '/status': {
            const s = agent.cliAdmin.status();
            writeln('');
            writeln(`  ${DIM}State${RESET}     ${CYAN}${s.agentState}${RESET}`);
            writeln(`  ${DIM}Tier${RESET}      ${s.survivalTier}`);
            writeln(`  ${DIM}Balance${RESET}   ${s.financial.netBalanceCents} cents`);
            writeln(`  ${DIM}Tasks${RESET}     ${s.heartbeatTasks.length}`);
            writeln('');
            return true;
        }

        case '/soul': {
            const soul = agent.cliAdmin.soulInspect?.();
            if (!soul) {
                writeln(`\n  ${DIM}No SOUL.md loaded.${RESET}\n`);
                return true;
            }
            writeln('');
            writeln(`  ${DIM}Name${RESET}     ${soul.name}`);
            writeln(`  ${DIM}Version${RESET}  ${soul.version}`);
            writeln(`  ${DIM}Values${RESET}   ${soul.valuesCount}`);
            writeln(`  ${DIM}Goals${RESET}    ${soul.goalsCount}`);
            writeln('');
            return true;
        }

        case '/memory': {
            const stats = agent.cliAdmin.memoryStats?.() ?? { tiers: [], totalEntries: 0 };
            writeln('');
            writeln(`  ${DIM}Total${RESET}  ${stats.totalEntries} entries`);
            for (const t of stats.tiers) {
                writeln(`  ${DIM}${t.tier}${RESET}  ${t.count}`);
            }
            writeln('');
            return true;
        }

        case '/credits': {
            const c = agent.cliAdmin.credits?.() ?? { balance: 0, tier: 'unknown' };
            writeln('');
            writeln(`  ${DIM}Balance${RESET}  ${c.balance} cents`);
            writeln(`  ${DIM}Tier${RESET}     ${c.tier}`);
            writeln('');
            return true;
        }

        default:
            return false;
    }
}

const VALID_TIERS = ['sandbox', 'standard', 'autonomous', 'godmode'] as const;

function handleTierCommand(args: string, agent: KernelInstance): boolean {
    const current = agent.capabilityConfig.get();
    const currentTier = detectTier(current);

    if (!args) {
        writeln('');
        writeln(`  ${DIM}Current tier${RESET}  ${CYAN}${currentTier}${RESET}`);
        writeln(`  ${DIM}Available${RESET}    ${VALID_TIERS.join(' | ')}`);
        writeln(`  ${DIM}Usage${RESET}        ${GREEN}/tier <name>${RESET}`);
        writeln('');
        return true;
    }

    const target = args.toLowerCase().trim();
    if (!VALID_TIERS.includes(target as typeof VALID_TIERS[number])) {
        writeln(`\n  ${RED}✗${RESET} Invalid tier: ${target}. Use: ${VALID_TIERS.join(' | ')}\n`);
        return true;
    }

    if (target === currentTier) {
        writeln(`\n  ${DIM}Already on${RESET} ${CYAN}${target}${RESET}\n`);
        return true;
    }

    const preset = SECURITY_TIER_PRESETS[target as keyof typeof SECURITY_TIER_PRESETS];
    agent.capabilityConfig.set(preset);
    const verified = detectTier(agent.capabilityConfig.get());
    agent.logger.info('Security tier changed via REPL', { from: currentTier, to: verified });
    writeln(`\n  ${GREEN}✓${RESET} Tier changed: ${DIM}${currentTier}${RESET} → ${CYAN}${verified}${RESET}\n`);
    return true;
}

// ── Main REPL ───────────────────────────────────────────────────────────

export async function startRepl(version: string): Promise<void> {
    // Banner
    writeln('');
    writeln(`  ${GREEN}ConShell${RESET} ${DIM}v${version}${RESET}`);
    writeln(`  ${DIM}Sovereign AI Agent Runtime${RESET}`);
    writeln('');

    const config = loadConfig();

    // Show providers
    const active = config.providers.filter(p => p.available).map(p => p.name);
    if (active.length > 0) {
        writeln(`  ${DIM}Providers${RESET}  ${active.map(p => `${GREEN}${p}${RESET}`).join(`${DIM},${RESET} `)}`);
    } else {
        writeln(`  ${YELLOW}⚠ No providers configured.${RESET} Run ${DIM}conshell onboard${RESET}`);
    }

    // Boot with spinner, suppressing all kernel logs
    write(`  ${DIM}Booting...${RESET}`);
    suppressConsoleLogs();

    let agent: KernelInstance;
    try {
        agent = await bootKernel(config);
    } catch (err) {
        writeln(` ${RED}failed${RESET}`);
        writeln(`  ${err instanceof Error ? err.message : err}`);
        writeln(`\n  Run ${DIM}conshell doctor${RESET} to diagnose.\n`);
        process.exit(1);
    }

    write(`\r\x1b[2K`); // clear "Booting..." line
    writeln(`  ${GREEN}●${RESET} ${DIM}Online${RESET}  ${DIM}Type /help or start chatting${RESET}`);
    writeln('');

    // Readline
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${BLUE}\$${RESET} `,
    });

    rl.prompt();

    const sessionId = `repl-${Date.now()}`;
    let busy = false;

    rl.on('line', async (line) => {
        const input = line.trim();

        if (!input) {
            rl.prompt();
            return;
        }

        // Slash commands
        if (input.startsWith('/')) {
            const cmd = input.split(' ')[0]!.toLowerCase();

            if (cmd === '/quit' || cmd === '/exit') {
                writeln(`\n  ${DIM}Goodbye.${RESET}\n`);
                agent.shutdown();
                rl.close();
                process.exit(0);
            }

            if (handleSlash(cmd, agent)) {
                rl.prompt();
                return;
            }

            // /tier with optional argument
            if (cmd === '/tier') {
                const tierArg = input.slice('/tier'.length).trim();
                handleTierCommand(tierArg, agent);
                rl.prompt();
                return;
            }

            writeln(`  ${YELLOW}?${RESET} Unknown: ${cmd}  ${DIM}(/help for commands)${RESET}`);
            rl.prompt();
            return;
        }

        // Prevent overlapping requests
        if (busy) {
            writeln(`  ${DIM}Still thinking... please wait.${RESET}`);
            rl.prompt();
            return;
        }

        busy = true;

        // Show blinking cursor while thinking
        const cursor = startCursor();

        try {
            const turn = await agent.agentLoop.executeTurn({
                sessionId,
                role: 'user' as const,
                content: input,
            });

            cursor.stop();

            // Extract response
            const response = typeof turn === 'string'
                ? turn
                : (turn as any)?.content ?? (turn as any)?.response ?? JSON.stringify(turn, null, 2);

            // Display with > prompt like WebUI
            const lines = String(response).split('\n');
            for (const l of lines) {
                writeln(`${GREEN}>${RESET} ${l}`);
            }
            writeln('');
        } catch (err) {
            cursor.stop();
            writeln(`${RED}✗${RESET} ${err instanceof Error ? err.message : err}`);
            writeln('');
        }

        busy = false;
        rl.prompt();
    });

    rl.on('close', () => {
        writeln(`\n  ${DIM}Goodbye.${RESET}\n`);
        agent.shutdown();
        process.exit(0);
    });

    process.on('SIGINT', () => {
        writeln(`\n  ${DIM}Goodbye.${RESET}\n`);
        agent.shutdown();
        process.exit(0);
    });
}
