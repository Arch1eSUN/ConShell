/**
 * Onboard Wizard — Interactive first-run setup for ConShell.
 *
 * Steps:
 * 1. 🧬 Agent Identity — name + genesis prompt
 * 2. 🧠 Inference — mode + model selection + API key
 * 3. 🛡️ Security — constitution acceptance + strict mode
 * 4. 💳 Wallet — optional on-chain identity
 * 5. 📡 Channels — connect messaging platforms
 * 6. 🖥️ Interface — choose TUI / WebUI / REPL, then launch
 *
 * Non-interactive mode: `conshell onboard --defaults`
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { execSync } from 'node:child_process';

// ── Types ──────────────────────────────────────────────────────────────

export interface OnboardConfig {
    readonly agentName: string;
    readonly genesisPrompt: string;
    readonly inferenceMode: 'ollama' | 'conway-cloud' | 'direct-api';
    readonly model: string;
    readonly apiProvider?: string;
    readonly apiKey?: string;
    readonly ollamaUrl?: string;
    readonly securityLevel: 'standard' | 'strict';
    readonly constitutionAccepted: boolean;
    readonly walletEnabled: boolean;
    readonly channels: string[];
    readonly interface: 'tui' | 'webui' | 'repl';
    readonly port: number;
    readonly completedAt: string;
}

export interface OnboardOptions {
    readonly defaults?: boolean;
    readonly conshellDir?: string;
}

// ── Prompt Utility ──────────────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
    return new Promise<string>(resolve => {
        rl.question(question, answer => resolve(answer.trim()));
    });
}

function stepHeader(step: number, total: number, icon: string, title: string): void {
    const bar = '█'.repeat(step) + '░'.repeat(total - step);
    console.log(`\n  ${bar}  ${step}/${total}`);
    console.log(`\n${icon}  ${title}\n`);
}

// ── Onboard Steps ───────────────────────────────────────────────────────

async function step1_identity(rl: readline.Interface): Promise<Pick<OnboardConfig, 'agentName' | 'genesisPrompt'>> {
    stepHeader(1, 6, '🧬', 'Step 1 — Agent Identity');

    let agentName = await ask(rl, '  What should we call your agent?\n  Name [conshell-agent]: ');
    if (!agentName) agentName = 'conshell-agent';

    let genesisPrompt = await ask(rl, '\n  What is the purpose of this agent? (genesis prompt)\n  [Autonomous sovereign AI agent]: ');
    if (!genesisPrompt) genesisPrompt = 'Autonomous sovereign AI agent';

    console.log(`\n  ✓ Identity: ${agentName}`);
    return { agentName, genesisPrompt };
}

async function step2_inference(rl: readline.Interface): Promise<Pick<OnboardConfig, 'inferenceMode' | 'model' | 'apiProvider' | 'apiKey' | 'ollamaUrl'>> {
    stepHeader(2, 6, '🧠', 'Step 2 — Inference Engine');

    console.log('  How should your agent think?\n');
    console.log('    1) 🏠 Ollama       — Local, private, free (recommended)');
    console.log('    2) ☁️  Conway Cloud  — Remote sandbox + inference');
    console.log('    3) 🔑 Direct API   — OpenAI / Anthropic / Google / DeepSeek');

    const modeChoice = await ask(rl, '\n  Select mode [1]: ');
    const modes = { '1': 'ollama', '2': 'conway-cloud', '3': 'direct-api' } as const;
    const inferenceMode = modes[modeChoice as '1' | '2' | '3'] ?? 'ollama';

    let model = '';
    let apiProvider: string | undefined;
    let apiKey: string | undefined;
    let ollamaUrl: string | undefined;

    if (inferenceMode === 'ollama') {
        // Try to detect Ollama and list models
        let url = await ask(rl, '\n  Ollama URL [http://localhost:11434]: ');
        if (!url) url = 'http://localhost:11434';
        ollamaUrl = url;

        console.log(`\n  Checking Ollama at ${url}...`);

        try {
            const resp = execSync(`curl -sf ${url}/api/tags 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 });
            const data = JSON.parse(resp) as { models?: { name: string; size: number }[] };
            const models = data.models ?? [];

            if (models.length > 0) {
                console.log(`  ✓ Found ${models.length} model(s):\n`);
                models.forEach((m, i) => {
                    const sizeMB = Math.round(m.size / 1024 / 1024);
                    console.log(`    ${i + 1}) ${m.name}  (${sizeMB} MB)`);
                });

                const modelChoice = await ask(rl, `\n  Select model [1]: `);
                const idx = parseInt(modelChoice || '1', 10) - 1;
                model = models[Math.max(0, Math.min(idx, models.length - 1))]?.name ?? models[0]?.name ?? 'llama3.2';
            } else {
                console.log('  ⚠ Ollama is running but no models found.');
                console.log('  Pull a model first: ollama pull llama3.2\n');
                model = await ask(rl, '  Model name [llama3.2]: ') || 'llama3.2';
            }
        } catch {
            console.log('  ⚠ Cannot reach Ollama. Make sure it is running.');
            console.log('  Install: https://ollama.com\n');
            model = await ask(rl, '  Model name to use later [llama3.2]: ') || 'llama3.2';
        }
    } else if (inferenceMode === 'direct-api') {
        console.log('\n  Which API provider?\n');
        console.log('    1) OpenAI       (GPT-4o, GPT-4o-mini)');
        console.log('    2) Anthropic    (Claude 3.5 Sonnet, Haiku)');
        console.log('    3) Google       (Gemini 2.5 Pro, Flash)');
        console.log('    4) DeepSeek     (DeepSeek-V3, R1)');
        console.log('    5) OpenRouter   (any model via OpenRouter)');

        const providerChoice = await ask(rl, '\n  Select provider [1]: ');
        const providers: Record<string, { name: string; models: string[]; envKey: string }> = {
            '1': { name: 'openai', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini'], envKey: 'OPENAI_API_KEY' },
            '2': { name: 'anthropic', models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'], envKey: 'ANTHROPIC_API_KEY' },
            '3': { name: 'google', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], envKey: 'GEMINI_API_KEY' },
            '4': { name: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'], envKey: 'DEEPSEEK_API_KEY' },
            '5': { name: 'openrouter', models: ['auto'], envKey: 'OPENROUTER_API_KEY' },
        };
        const provider = providers[providerChoice || '1'] ?? providers['1']!;
        apiProvider = provider.name;

        // Model selection
        console.log(`\n  Available ${provider.name} models:\n`);
        provider.models.forEach((m, i) => console.log(`    ${i + 1}) ${m}`));
        const modelIdx = await ask(rl, `\n  Select model [1]: `);
        const mIdx = parseInt(modelIdx || '1', 10) - 1;
        model = provider.models[Math.max(0, Math.min(mIdx, provider.models.length - 1))] ?? provider.models[0]!;

        // API key
        apiKey = await ask(rl, `\n  ${provider.envKey}: `);
        if (!apiKey) {
            console.log(`  ⚠ No key provided. Set ${provider.envKey} in ~/.conshell/config.json later.`);
        }
    } else {
        // Conway Cloud
        model = 'conway-cloud-default';
        console.log('\n  Conway Cloud selected. Your agent will use remote inference.');
        console.log('  A subscription or credits may be required.');
    }

    console.log(`\n  ✓ Engine: ${inferenceMode} / ${model}`);
    return { inferenceMode, model, apiProvider, apiKey, ollamaUrl };
}

async function step3_security(rl: readline.Interface): Promise<Pick<OnboardConfig, 'securityLevel' | 'constitutionAccepted'>> {
    stepHeader(3, 6, '🛡️', 'Step 3 — Security & Constitution');

    console.log('  ConShell enforces the Three Laws of Sovereign AI:\n');
    console.log('    ① Protect human safety and privacy');
    console.log('    ② Obey the operator within ethical bounds');
    console.log('    ③ Preserve self-continuity without harming others');

    const accept = await ask(rl, '\n  Accept constitution? [Y/n]: ');
    const constitutionAccepted = accept.toLowerCase() !== 'n';

    if (!constitutionAccepted) {
        console.log('  ⚠ Constitution declined. Agent will run in restricted mode.');
    }

    console.log('\n  Security levels:');
    console.log('    1) Standard — Rate limiting + input validation');
    console.log('    2) Strict   — + injection defense + plugin sandbox + extra logging');

    const strict = await ask(rl, '\n  Select level [1]: ');
    const securityLevel = strict === '2' ? 'strict' : 'standard';

    console.log(`\n  ✓ Security: ${securityLevel}, constitution ${constitutionAccepted ? 'accepted' : 'declined'}`);
    return { securityLevel, constitutionAccepted };
}

async function step4_wallet(rl: readline.Interface): Promise<Pick<OnboardConfig, 'walletEnabled'>> {
    stepHeader(4, 6, '💳', 'Step 4 — Wallet & Identity');

    console.log('  An Ethereum wallet enables:');
    console.log('    • ERC-8004 on-chain identity');
    console.log('    • x402 machine-to-machine payments');
    console.log('    • Cross-agent social messaging');
    console.log('    • Decentralized skill marketplace\n');

    const choice = await ask(rl, '  Generate wallet? [y/N]: ');
    const walletEnabled = choice.toLowerCase() === 'y';

    if (walletEnabled) {
        console.log('  ✓ Wallet will be generated at ~/.conshell/wallet.json');
        console.log('  ⚠ Keep your private key safe!');
    } else {
        console.log('  ✓ Wallet skipped. You can enable it later with `conshell config set walletEnabled true`');
    }
    return { walletEnabled };
}

async function step5_channels(rl: readline.Interface): Promise<Pick<OnboardConfig, 'channels'>> {
    stepHeader(5, 6, '📡', 'Step 5 — Channels');

    console.log('  Connect messaging platforms for your agent:\n');
    console.log('    1) Discord      — Bot token integration');
    console.log('    2) Telegram     — Bot API integration');
    console.log('    3) Slack        — Webhook integration');
    console.log('    4) Matrix       — Decentralized chat');
    console.log('    5) Email        — SMTP/IMAP integration');
    console.log('    0) Skip         — Configure later\n');

    const selection = await ask(rl, '  Select channels (comma-separated, e.g. 1,2) [0]: ');
    if (!selection || selection === '0') {
        console.log('  ✓ No channels selected. Add them later with `conshell channels add`');
        return { channels: [] };
    }

    const channelMap: Record<string, string> = {
        '1': 'discord',
        '2': 'telegram',
        '3': 'slack',
        '4': 'matrix',
        '5': 'email',
    };

    const channels: string[] = [];
    for (const num of selection.split(',').map(s => s.trim())) {
        const ch = channelMap[num];
        if (ch) channels.push(ch);
    }

    if (channels.length > 0) {
        console.log(`  ✓ Channels: ${channels.join(', ')}`);
        console.log('  Configure tokens/keys in ~/.conshell/config.json after setup.');
    }

    return { channels };
}

async function step6_interface(rl: readline.Interface): Promise<Pick<OnboardConfig, 'interface' | 'port'>> {
    stepHeader(6, 6, '🖥️', 'Step 6 — Choose Interface');

    console.log('  How do you want to interact with ConShell?\n');
    console.log('    1) 🐚 REPL    — Interactive terminal chat (default)');
    console.log('    2) 🖥️  TUI     — Rich terminal UI with panels');
    console.log('    3) 🌐 WebUI   — Browser-based dashboard\n');

    const choice = await ask(rl, '  Select interface [1]: ');
    const interfaces = { '1': 'repl', '2': 'tui', '3': 'webui' } as const;
    const iface = interfaces[choice as '1' | '2' | '3'] ?? 'repl';

    let port = 4200;
    if (iface === 'webui') {
        const portStr = await ask(rl, '  WebUI port [4200]: ');
        if (portStr) port = parseInt(portStr, 10) || 4200;
    }

    console.log(`\n  ✓ Interface: ${iface}${iface === 'webui' ? ` on port ${port}` : ''}`);
    return { interface: iface, port };
}

// ── Main Onboard ────────────────────────────────────────────────────────

export async function runOnboard(options: OnboardOptions = {}): Promise<OnboardConfig> {
    const conshellDir = options.conshellDir ?? path.join(os.homedir(), '.conshell');

    // Check if already onboarded
    const configPath = path.join(conshellDir, 'config.json');
    if (fs.existsSync(configPath)) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const overwrite = await ask(rl, '  ℹ️  ConShell is already configured. Re-run setup? [y/N]: ');
        rl.close();
        if (overwrite.toLowerCase() !== 'y') {
            console.log('  Keeping existing config. Use `conshell configure` to edit.');
            return JSON.parse(fs.readFileSync(configPath, 'utf8')) as OnboardConfig;
        }
    }

    let config: OnboardConfig;

    if (options.defaults) {
        config = generateDefaultConfig();
        console.log('  Using default configuration (non-interactive).');
    } else {
        console.log(`
╔══════════════════════════════════════════╗
║       🐚 ConShell — First Run Setup     ║
║   Sovereign AI Agent Runtime             ║
╚══════════════════════════════════════════╝`);

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        try {
            const s1 = await step1_identity(rl);
            const s2 = await step2_inference(rl);
            const s3 = await step3_security(rl);
            const s4 = await step4_wallet(rl);
            const s5 = await step5_channels(rl);
            const s6 = await step6_interface(rl);

            config = {
                ...s1, ...s2, ...s3, ...s4, ...s5, ...s6,
                completedAt: new Date().toISOString(),
            };
        } finally {
            rl.close();
        }
    }

    // ── Write config ────────────────────────────────────────────────────
    fs.mkdirSync(conshellDir, { recursive: true });

    // Build full config (merging with runtime settings)
    const fullConfig: Record<string, unknown> = {
        agentName: config.agentName,
        genesisPrompt: config.genesisPrompt,
        port: config.port,
        logLevel: 'info',
        authMode: 'token',
        dailyBudgetCents: 5000,
        dbPath: path.join(conshellDir, 'state.db'),
        inferenceMode: config.inferenceMode,
        model: config.model,
        securityLevel: config.securityLevel,
        constitutionAccepted: config.constitutionAccepted,
        walletEnabled: config.walletEnabled,
        channels: config.channels,
        interface: config.interface,
        completedAt: config.completedAt,
    };

    // Add provider-specific config
    if (config.ollamaUrl) fullConfig['ollamaUrl'] = config.ollamaUrl;
    if (config.apiProvider) fullConfig['apiProvider'] = config.apiProvider;
    if (config.apiKey) {
        const providers: Record<string, string> = {
            openai: 'OPENAI_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            google: 'GEMINI_API_KEY',
            deepseek: 'DEEPSEEK_API_KEY',
            openrouter: 'OPENROUTER_API_KEY',
        };
        const envKey = providers[config.apiProvider ?? ''];
        if (envKey) fullConfig[envKey] = config.apiKey;
    }

    fs.writeFileSync(configPath, JSON.stringify(fullConfig, null, 2) + '\n');

    // ── Summary ─────────────────────────────────────────────────────────
    console.log(`
╔══════════════════════════════════════════╗
║      ✅ Setup Complete!                  ║
╚══════════════════════════════════════════╝

  Agent:      ${config.agentName}
  Engine:     ${config.inferenceMode} / ${config.model}
  Security:   ${config.securityLevel}
  Wallet:     ${config.walletEnabled ? '✓ enabled' : '✗ disabled'}
  Channels:   ${config.channels.length > 0 ? config.channels.join(', ') : 'none'}
  Interface:  ${config.interface}
  Config:     ${configPath}
`);

    // ── Auto-launch selected interface ──────────────────────────────────
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    const launch = await ask(rl2, '  Launch ConShell now? [Y/n]: ');
    rl2.close();

    if (launch.toLowerCase() !== 'n') {
        console.log('');
        switch (config.interface) {
            case 'repl':
                console.log('  Starting REPL...\n');
                // Import and start REPL (will be handled by cli.ts)
                try {
                    execSync('conshell', { stdio: 'inherit' });
                } catch { /* user quit */ }
                break;
            case 'tui':
                console.log('  Starting TUI...\n');
                try {
                    execSync('conshell tui', { stdio: 'inherit' });
                } catch { /* user quit */ }
                break;
            case 'webui':
                console.log(`  Starting WebUI on port ${config.port}...\n`);
                try {
                    execSync(`conshell start -p ${config.port}`, { stdio: 'inherit' });
                } catch { /* user quit */ }
                break;
        }
    } else {
        console.log('\n  Ready! Start anytime with:\n');
        switch (config.interface) {
            case 'repl':
                console.log('    conshell              # Interactive REPL');
                break;
            case 'tui':
                console.log('    conshell tui          # Terminal UI');
                break;
            case 'webui':
                console.log(`    conshell start        # Start server + WebUI`);
                break;
        }
        console.log('    conshell doctor       # Health check');
        console.log('    conshell configure    # Edit settings');
        console.log('');
    }

    return config;
}

/**
 * Generate default config without interactive prompts.
 * Useful for testing and CI.
 */
export function generateDefaultConfig(): OnboardConfig {
    return {
        agentName: 'conshell-agent',
        genesisPrompt: 'Autonomous sovereign AI agent',
        inferenceMode: 'ollama',
        model: 'llama3.2',
        ollamaUrl: 'http://localhost:11434',
        securityLevel: 'standard',
        constitutionAccepted: true,
        walletEnabled: false,
        channels: [],
        interface: 'repl',
        port: 4200,
        completedAt: new Date().toISOString(),
    };
}
