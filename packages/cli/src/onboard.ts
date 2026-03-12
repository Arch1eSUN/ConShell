/**
 * Onboard Wizard — Interactive first-run setup for ConShell.
 *
 * Steps:
 * 1. 🧬 Agent Identity — name + genesis prompt
 * 2. 🧠 Inference — mode → provider → model + CLIProxy (unified)
 * 3. 🛡️ Security — constitution + strict mode
 * 4. 💳 Wallet — optional on-chain identity
 * 5. 📡 Channels — 7 platforms (Telegram/Discord/Slack/WhatsApp/iMessage/Matrix/Email)
 * 6. 🔧 Skills — local dir + ClawHub registry token
 * 7. 🌐 Browser — Playwright vs CDP + headless
 * 8. 🖥️ Interface — REPL / WebUI
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { input, select, confirm, checkbox, password } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';

// ── Types ──────────────────────────────────────────────────────────────

export interface OnboardConfig {
    readonly agentName: string;
    readonly genesisPrompt: string;
    readonly inferenceMode: 'ollama' | 'conway-cloud' | 'direct-api' | 'cliproxy' | 'skip';
    readonly model: string;
    readonly apiProvider?: string;
    readonly apiKey?: string;
    readonly ollamaUrl?: string;
    readonly proxyBaseUrl?: string;
    readonly proxyEnabled: boolean;
    readonly proxyApiKey?: string;
    readonly securityLevel: 'sandbox' | 'standard' | 'autonomous' | 'godmode';
    readonly constitutionAccepted: boolean;
    readonly walletEnabled: boolean;
    readonly channels: string[];
    readonly channelCredentials: Record<string, Record<string, string>>;
    readonly skillsDir: string;
    readonly clawHubToken?: string;
    readonly browserProvider: 'playwright' | 'cdp' | 'none';
    readonly browserHeadless: boolean;
    readonly interface: 'webui' | 'repl';
    readonly port: number;
    readonly completedAt: string;
}

export interface OnboardOptions {
    readonly defaults?: boolean;
    readonly installDaemon?: boolean;
    readonly conshellDir?: string;
}

// ── Gradient Colors ────────────────────────────────────────────────────

const GRADIENT = ['#6C5CE7', '#A29BFE', '#74B9FF', '#00B894', '#00CEC9', '#55EFC4'];
const gradient = (text: string, idx: number) => chalk.hex(GRADIENT[idx % GRADIENT.length]!)(text);

// ── Banner ─────────────────────────────────────────────────────────────

function printBanner(): void {
    const turtle = [
        '              ██████          ',
        '          ████░░░░████       ',
        '        ██░░██████░░░░██     ',
        '        ██░░████████░░██     ',
        '      ██░░░░░░░░░░░░░░░░██  ',
        '        ████░░░░░░░░████    ',
        '      ██    ████████    ██  ',
        '                ██          ',
    ];
    const title = [
        '   ██████╗ ██████╗ ███╗   ██╗',
        '  ██╔════╝██╔═══██╗████╗  ██║',
        '  ██║     ██║   ██║██╔██╗ ██║',
        '  ╚██████╗╚██████╔╝██║ ╚████║',
        '      ███████╗██╗  ██╗███████╗██╗     ██╗',
        '      ██╔════╝██║  ██║██╔════╝██║     ██║',
        '      ███████╗███████║█████╗  ██║     ██║',
        '      ╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝',
    ];
    console.log('');
    turtle.forEach((line) => console.log(chalk.hex('#00B894')(line)));
    console.log('');
    title.forEach((line, idx) => console.log(gradient(line, idx)));
    console.log(chalk.dim('  🐢 Sovereign AI Agent Runtime — v0.2.0'));
    console.log('');
}

// ── Step Progress ──────────────────────────────────────────────────────

const TOTAL_STEPS = 8;

function stepProgress(step: number, icon: string, title: string): void {
    const filled = chalk.hex('#6C5CE7')('█'.repeat(step));
    const empty = chalk.dim('░'.repeat(TOTAL_STEPS - step));
    console.log(`\n  ${filled}${empty}  ${chalk.dim(`${step}/${TOTAL_STEPS}`)}`);
    console.log(`\n  ${icon}  ${chalk.bold(title)}\n`);
}

// ── Step 1: Identity ───────────────────────────────────────────────────

async function step1_identity(): Promise<Pick<OnboardConfig, 'agentName' | 'genesisPrompt'>> {
    stepProgress(1, '🧬', 'Agent Identity');

    const agentName = await input({
        message: 'What should we call your agent?',
        default: 'conshell-agent',
    });

    const genesisPrompt = await input({
        message: 'What is the purpose of this agent?',
        default: 'Autonomous sovereign AI agent',
    });

    console.log(`\n  ${chalk.green('✓')} Identity: ${chalk.bold(agentName)}`);
    return { agentName, genesisPrompt };
}

// ── Model Fetcher ─────────────────────────────────────────────────────

interface FetchModelsOptions {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly timeout?: number;
}

async function fetchModels(opts: FetchModelsOptions): Promise<string[]> {
    const url = opts.baseUrl.replace(/\/$/, '') + '/models';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeout ?? 5000);

    try {
        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${opts.apiKey}` },
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = await resp.json() as { data?: { id: string }[] };
        return (body.data ?? []).map(m => m.id).filter(Boolean).sort();
    } catch {
        clearTimeout(timer);
        return [];
    }
}

// Provider definitions (no hardcoded models — fetched dynamically)
const PROVIDER_DEFS = [
    { name: '🟢 OpenAI       — GPT-4o, o1, o3…', value: 'openai', baseUrl: 'https://api.openai.com/v1', envKey: 'OPENAI_API_KEY', canFetch: true },
    { name: '🟣 Anthropic    — Claude 4, Sonnet, Haiku…', value: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', envKey: 'ANTHROPIC_API_KEY', canFetch: false, fallbackModels: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'] },
    { name: '🔵 Google       — Gemini 2.5 Pro, Flash…', value: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', envKey: 'GEMINI_API_KEY', canFetch: false, fallbackModels: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
    { name: '🟡 DeepSeek     — DeepSeek-V3, R1…', value: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY', canFetch: true },
    { name: '🌐 OpenRouter   — Any model via OpenRouter', value: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', envKey: 'OPENROUTER_API_KEY', canFetch: true },
] as const;

// ── Step 2: Inference (Unified — includes CLIProxy) ────────────────────

async function step2_inference(): Promise<Pick<OnboardConfig, 'inferenceMode' | 'model' | 'apiProvider' | 'apiKey' | 'ollamaUrl' | 'proxyBaseUrl' | 'proxyEnabled' | 'proxyApiKey'>> {
    stepProgress(2, '🧠', 'Inference Engine');

    const inferenceMode = await select<'ollama' | 'conway-cloud' | 'direct-api' | 'cliproxy' | 'skip'>({
        message: 'How should your agent think?',
        choices: [
            { name: '🏠 Ollama       — Local, private, free (recommended)', value: 'ollama' },
            { name: '🔌 CLIProxy     — Connect via deployed proxy (Base URL + Key)', value: 'cliproxy' },
            { name: '🔑 Direct API   — OpenAI / Anthropic / Google / DeepSeek', value: 'direct-api' },
            { name: '☁️  Conway Cloud  — Remote sandbox + inference', value: 'conway-cloud' },
            { name: '⏭️  Skip         — Configure later in WebUI', value: 'skip' },
        ],
    });

    let model = '';
    let apiProvider: string | undefined;
    let apiKey: string | undefined;
    let ollamaUrl: string | undefined;
    let proxyBaseUrl: string | undefined;
    let proxyEnabled = false;
    let proxyApiKey: string | undefined;

    if (inferenceMode === 'skip') {
        console.log(chalk.dim('  Inference skipped — configure later in WebUI or with `conshell configure`.'));
        console.log(`\n  ${chalk.green('✓')} Engine: ${chalk.dim('not configured')}`);
        return { inferenceMode, model: '', apiProvider, apiKey, ollamaUrl, proxyBaseUrl, proxyEnabled, proxyApiKey };
    }

    if (inferenceMode === 'ollama') {
        ollamaUrl = await input({ message: 'Ollama URL', default: 'http://localhost:11434' });
        const spin = ora({ text: `Checking Ollama at ${ollamaUrl}...`, indent: 2 }).start();

        try {
            const resp = execSync(`curl -sf ${ollamaUrl}/api/tags 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 });
            const data = JSON.parse(resp) as { models?: { name: string; size: number }[] };
            const models = data.models ?? [];

            if (models.length > 0) {
                spin.succeed(`Found ${models.length} model(s)`);
                model = await select({
                    message: 'Select model',
                    choices: models.map(m => ({
                        name: `${m.name}  ${chalk.dim(`(${Math.round(m.size / 1024 / 1024)} MB)`)}`,
                        value: m.name,
                    })),
                });
            } else {
                spin.warn('Ollama running but no models found');
                console.log(chalk.dim('  Pull a model: ollama pull llama3.2'));
                model = await input({ message: 'Model name', default: 'llama3.2' });
            }
        } catch {
            spin.warn('Cannot reach Ollama — make sure it is running');
            console.log(chalk.dim('  Install: https://ollama.com'));
            model = await input({ message: 'Model to use later', default: 'llama3.2' });
        }

    } else if (inferenceMode === 'cliproxy') {
        proxyBaseUrl = await input({ message: 'CLIProxy Base URL', default: 'http://localhost:4200/v1' });
        apiKey = await password({ message: 'CLIProxy API Key', mask: '•' });

        if (!apiKey) {
            console.log(chalk.yellow('  ⚠ API key is required to connect to CLIProxy.'));
            model = await input({ message: 'Model name (set key later)', default: '' });
        } else {
            const spin = ora({ text: `Fetching models from ${proxyBaseUrl}...`, indent: 2 }).start();
            const models = await fetchModels({ baseUrl: proxyBaseUrl, apiKey });

            if (models.length > 0) {
                spin.succeed(`Found ${models.length} model(s)`);
                model = await select({ message: 'Select model', choices: models.map(m => ({ name: m, value: m })) });
            } else {
                spin.warn('Could not fetch models — check URL and key');
                model = await input({ message: 'Model name', default: '' });
            }
        }
        apiProvider = 'cliproxy';
        proxyEnabled = true;

    } else if (inferenceMode === 'direct-api') {
        apiProvider = await select({
            message: 'Which API provider?',
            choices: PROVIDER_DEFS.map(p => ({ name: p.name, value: p.value })),
        });

        const provider = PROVIDER_DEFS.find(p => p.value === apiProvider)!;
        apiKey = await password({ message: `${provider.envKey}`, mask: '•' });

        if (!apiKey) {
            console.log(chalk.dim(`  Set ${provider.envKey} in ~/.conshell/config.json later.`));
            model = await input({ message: 'Model name', default: '' });
        } else if (provider.canFetch) {
            const spin = ora({ text: `Verifying key & fetching models from ${apiProvider}...`, indent: 2 }).start();
            const models = await fetchModels({ baseUrl: provider.baseUrl, apiKey });

            if (models.length > 0) {
                spin.succeed(`Found ${models.length} model(s)`);
                model = await select({
                    message: `Select ${apiProvider} model`,
                    choices: models.slice(0, 30).map(m => ({ name: m, value: m })),
                });
            } else {
                spin.warn('Could not fetch models — key may be invalid');
                model = await input({ message: 'Model name', default: '' });
            }
        } else {
            const fallback = 'fallbackModels' in provider ? provider.fallbackModels : [];
            if (fallback.length > 0) {
                model = await select({
                    message: `Select ${apiProvider} model`,
                    choices: fallback.map(m => ({ name: m, value: m })),
                });
            } else {
                model = await input({ message: 'Model name', default: '' });
            }
        }

    } else {
        model = 'conway-cloud-default';
        console.log(chalk.dim('  Conway Cloud selected. Remote inference will be used.'));
    }

    // ── Unified CLIProxy Config ────────────────────────────────────────
    if (inferenceMode !== 'cliproxy') {
        console.log('');
        console.log(chalk.dim('  CLIProxy provides OpenAI-compatible endpoints for external tools'));
        console.log(chalk.dim('  (Cursor, Continue, Cline) to connect to ConShell.\n'));

        proxyEnabled = await confirm({ message: 'Enable CLIProxy API?', default: true });

        if (proxyEnabled) {
            const setKey = await confirm({ message: 'Set a proxy API key? (recommended)', default: true });
            if (setKey) {
                proxyApiKey = await password({ message: 'Proxy API key (blank = auto-generate)', mask: '•' });
                if (!proxyApiKey) {
                    proxyApiKey = `csk-${randomHex(32)}`;
                    console.log(`  ${chalk.green('✓')} Auto-generated key: ${chalk.dim(proxyApiKey.slice(0, 12) + '...')}`);
                }
            }
        }
    }

    console.log(`\n  ${chalk.green('✓')} Engine: ${chalk.bold(inferenceMode)} / ${chalk.cyan(model)}`);
    if (proxyEnabled) console.log(`  ${chalk.green('✓')} CLIProxy: ${chalk.bold('enabled')}`);
    return { inferenceMode, model, apiProvider, apiKey, ollamaUrl, proxyBaseUrl, proxyEnabled, proxyApiKey };
}

function randomHex(len: number): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < len; i++) result += chars[Math.floor(Math.random() * 16)];
    return result;
}

// ── Step 3: Security ───────────────────────────────────────────────────

async function step3_security(): Promise<Pick<OnboardConfig, 'securityLevel' | 'constitutionAccepted'>> {
    stepProgress(3, '🛡️', 'Security & Constitution');

    console.log(chalk.dim('  ConShell enforces the Three Laws of Sovereign AI:\n'));
    console.log(`    ${gradient('①', 0)} Protect human safety and privacy`);
    console.log(`    ${gradient('②', 1)} Obey the operator within ethical bounds`);
    console.log(`    ${gradient('③', 2)} Preserve self-continuity without harming others`);
    console.log('');

    const constitutionAccepted = await confirm({ message: 'Accept constitution?', default: true });
    if (!constitutionAccepted) {
        console.log(chalk.yellow('  ⚠ Constitution declined. Agent will run in restricted mode.'));
    }

    const securityLevel = await select<'sandbox' | 'standard' | 'autonomous' | 'godmode'>({
        message: 'Security tier',
        choices: [
            { name: '🔒 Sandbox    — Chat only, internet access', value: 'sandbox' },
            { name: '🛡️  Standard  — + Shell, file system, browser (recommended)', value: 'standard' },
            { name: '⚡ Autonomous — + Financial ops, account creation', value: 'autonomous' },
            { name: '★  God Mode   — All capabilities, no restrictions', value: 'godmode' },
        ],
        default: 'standard',
    });

    console.log(`\n  ${chalk.green('✓')} Security: ${chalk.bold(securityLevel)}, constitution ${constitutionAccepted ? chalk.green('accepted') : chalk.yellow('declined')}`);
    return { securityLevel, constitutionAccepted };
}

// ── Step 4: Wallet ─────────────────────────────────────────────────────

async function step4_wallet(): Promise<Pick<OnboardConfig, 'walletEnabled'>> {
    stepProgress(4, '💳', 'Wallet & Identity');

    console.log(chalk.dim('  An Ethereum wallet enables:'));
    console.log('    • ERC-8004 on-chain identity');
    console.log('    • x402 machine-to-machine payments');
    console.log('    • Cross-agent social messaging');
    console.log('    • Decentralized skill marketplace');
    console.log('');

    const walletEnabled = await confirm({ message: 'Generate wallet?', default: false });

    if (walletEnabled) {
        console.log(`  ${chalk.green('✓')} Wallet will be generated at ~/.conshell/wallet.json`);
        console.log(chalk.yellow('  ⚠ Keep your private key safe!'));
    } else {
        console.log(`  ${chalk.green('✓')} Wallet skipped — enable later with ${chalk.dim('conshell configure')}`);
    }
    return { walletEnabled };
}

// ── Step 5: Channels (7 platforms) ─────────────────────────────────────

const CHANNEL_DEFS = [
    { name: '💬 Discord      — Bot token integration', value: 'discord', credentialKey: 'token', credentialLabel: 'Bot Token' },
    { name: '✈️  Telegram     — Bot API integration', value: 'telegram', credentialKey: 'token', credentialLabel: 'Bot Token' },
    { name: '🔗 Slack        — Webhook integration', value: 'slack', credentialKey: 'token', credentialLabel: 'Bot Token' },
    { name: '📱 WhatsApp     — via wacli CLI bridge', value: 'whatsapp', credentialKey: 'phone', credentialLabel: 'Phone Number' },
    { name: '💎 iMessage     — macOS only (via imsg)', value: 'imessage', credentialKey: 'phone', credentialLabel: 'Phone/Email' },
    { name: '🌐 Matrix       — Decentralized chat', value: 'matrix', credentialKey: 'token', credentialLabel: 'Access Token' },
    { name: '📧 Email        — SMTP/IMAP integration', value: 'email', credentialKey: 'email', credentialLabel: 'Email Address' },
] as const;

async function step5_channels(): Promise<Pick<OnboardConfig, 'channels' | 'channelCredentials'>> {
    stepProgress(5, '📡', 'Channels');

    const isMac = os.platform() === 'darwin';
    const filteredChannels = CHANNEL_DEFS.filter(ch =>
        ch.value !== 'imessage' || isMac,
    );

    const channels = await checkbox({
        message: 'Connect messaging platforms (Space to select, Enter to confirm)',
        choices: filteredChannels.map(ch => ({ name: ch.name, value: ch.value })),
    });

    const channelCredentials: Record<string, Record<string, string>> = {};

    // Collect credentials for each selected channel
    for (const ch of channels) {
        const def = CHANNEL_DEFS.find(d => d.value === ch);
        if (!def) continue;

        const wantCreds = await confirm({
            message: `Configure ${ch} credentials now?`,
            default: false,
        });

        if (wantCreds) {
            const cred = await input({ message: `  ${def.credentialLabel}:` });
            if (cred) {
                channelCredentials[ch] = { [def.credentialKey]: cred };

                // Extra fields for some platforms
                if (ch === 'telegram' || ch === 'discord' || ch === 'slack') {
                    const chatId = await input({ message: '  Chat/Channel ID (optional):' });
                    if (chatId) channelCredentials[ch]!['chat_id'] = chatId;
                }
                if (ch === 'email') {
                    const smtpHost = await input({ message: '  SMTP Host:', default: 'smtp.gmail.com' });
                    channelCredentials[ch]!['smtp_host'] = smtpHost;
                }
            }
        }
    }

    if (channels.length === 0) {
        console.log(`  ${chalk.green('✓')} No channels selected — add later with ${chalk.dim('conshell channels add')}`);
    } else {
        console.log(`  ${chalk.green('✓')} Channels: ${chalk.cyan(channels.join(', '))}`);
        const unconfigured = channels.filter(ch => !channelCredentials[ch]);
        if (unconfigured.length > 0) {
            console.log(chalk.dim(`  Configure tokens/keys for ${unconfigured.join(', ')} in ~/.conshell/config.json later.`));
        }
    }

    return { channels, channelCredentials };
}

// ── Step 6: Skills ─────────────────────────────────────────────────────

async function step6_skills(conshellDir: string): Promise<Pick<OnboardConfig, 'skillsDir' | 'clawHubToken'>> {
    stepProgress(6, '🔧', 'Skills & ClawHub');

    console.log(chalk.dim('  Skills extend your agent with new capabilities.'));
    console.log(chalk.dim('  Local skills live in a directory with SKILL.md files.'));
    console.log(chalk.dim('  ClawHub provides community-contributed remote skills.\n'));

    const defaultDir = path.join(conshellDir, 'skills');
    const skillsDir = await input({
        message: 'Skills directory',
        default: defaultDir,
    });

    const connectClawHub = await confirm({
        message: 'Connect to ClawHub community registry?',
        default: false,
    });

    let clawHubToken: string | undefined;

    if (connectClawHub) {
        console.log(chalk.dim('  ClawHub token is optional — provides access to private skills.'));
        const token = await password({ message: 'ClawHub token (blank = public only)', mask: '•' });
        if (token) clawHubToken = token;

        console.log(`  ${chalk.green('✓')} ClawHub: ${chalk.bold('connected')}${clawHubToken ? ' (authenticated)' : ' (public)'}`);
        console.log(chalk.dim('  Browse skills: conshell skill search <query>'));
    } else {
        console.log(`  ${chalk.green('✓')} ClawHub: ${chalk.dim('skipped')} — enable later with ${chalk.dim('conshell configure')}`);
    }

    console.log(`  ${chalk.green('✓')} Skills dir: ${chalk.dim(skillsDir)}`);
    return { skillsDir, clawHubToken };
}

// ── Step 7: Browser ────────────────────────────────────────────────────

async function step7_browser(): Promise<Pick<OnboardConfig, 'browserProvider' | 'browserHeadless'>> {
    stepProgress(7, '🌐', 'Browser Automation');

    console.log(chalk.dim('  Browser tools allow your agent to navigate the web,'));
    console.log(chalk.dim('  take screenshots, fill forms, and extract data.\n'));

    const browserProvider = await select<'playwright' | 'cdp' | 'none'>({
        message: 'Browser engine',
        choices: [
            { name: '🎭 Playwright   — Full browser automation (recommended)', value: 'playwright' },
            { name: '🔧 Chrome CDP   — Direct DevTools Protocol (advanced)', value: 'cdp' },
            { name: '⏭️  None         — Disable browser tools', value: 'none' },
        ],
        default: 'playwright',
    });

    let browserHeadless = true;
    if (browserProvider !== 'none') {
        browserHeadless = await confirm({
            message: 'Run headless? (no visible browser window)',
            default: true,
        });
    }

    if (browserProvider === 'none') {
        console.log(`\n  ${chalk.green('✓')} Browser: ${chalk.dim('disabled')}`);
    } else {
        console.log(`\n  ${chalk.green('✓')} Browser: ${chalk.bold(browserProvider)} (${browserHeadless ? 'headless' : 'headed'})`);
    }
    return { browserProvider, browserHeadless };
}

// ── Step 8: Interface ──────────────────────────────────────────────────

async function step8_interface(): Promise<Pick<OnboardConfig, 'interface' | 'port'>> {
    stepProgress(8, '🖥️', 'Choose Interface');

    const iface = await select<'repl' | 'webui'>({
        message: 'How do you want to interact with ConShell?',
        choices: [
            { name: '🐚 REPL    — Interactive terminal chat (default)', value: 'repl' },
            { name: '🌐 WebUI   — Browser-based dashboard', value: 'webui' },
        ],
    });

    let port = 4200;
    if (iface === 'webui') {
        const portStr = await input({
            message: 'WebUI port',
            default: '4200',
            validate: (v) => /^\d+$/.test(v) ? true : 'Must be a number',
        });
        port = parseInt(portStr, 10) || 4200;
    }

    console.log(`\n  ${chalk.green('✓')} Interface: ${chalk.bold(iface)}${iface === 'webui' ? ` on port ${port}` : ''}`);
    return { interface: iface, port };
}

// ── Main Onboard ────────────────────────────────────────────────────────

export async function runOnboard(options: OnboardOptions = {}): Promise<OnboardConfig> {
    const conshellDir = options.conshellDir ?? path.join(os.homedir(), '.conshell');

    // Check if already onboarded
    const configPath = path.join(conshellDir, 'config.json');
    if (fs.existsSync(configPath)) {
        const overwrite = await confirm({
            message: 'ConShell is already configured. Re-run setup?',
            default: false,
        });
        if (!overwrite) {
            console.log(chalk.dim('  Keeping existing config. Use `conshell configure` to edit.'));
            return JSON.parse(fs.readFileSync(configPath, 'utf8')) as OnboardConfig;
        }
    }

    let config: OnboardConfig;

    if (options.defaults) {
        config = generateDefaultConfig(conshellDir);
        console.log(chalk.dim('  Using default configuration (non-interactive).'));
    } else {
        printBanner();

        const s1 = await step1_identity();
        const s2 = await step2_inference();
        const s3 = await step3_security();
        const s4 = await step4_wallet();
        const s5 = await step5_channels();
        const s6 = await step6_skills(conshellDir);
        const s7 = await step7_browser();
        const s8 = await step8_interface();

        config = {
            ...s1, ...s2, ...s3, ...s4, ...s5, ...s6, ...s7, ...s8,
            completedAt: new Date().toISOString(),
        };
    }

    // ── Write config ────────────────────────────────────────────────────
    const spin = ora({ text: 'Saving configuration...', indent: 2 }).start();

    fs.mkdirSync(conshellDir, { recursive: true });
    fs.mkdirSync(config.skillsDir, { recursive: true });

    const fullConfig: Record<string, unknown> = {
        agentName: config.agentName,
        genesisPrompt: config.genesisPrompt,
        port: config.port,
        logLevel: 'info',
        authMode: 'none',
        dailyBudgetCents: 5000,
        dbPath: path.join(conshellDir, 'state.db'),
        inferenceMode: config.inferenceMode,
        model: config.model,
        proxyEnabled: config.proxyEnabled,
        securityLevel: config.securityLevel,
        constitutionAccepted: config.constitutionAccepted,
        walletEnabled: config.walletEnabled,
        channels: config.channels,
        channelCredentials: config.channelCredentials,
        skillsDir: config.skillsDir,
        browserProvider: config.browserProvider,
        browserHeadless: config.browserHeadless,
        interface: config.interface,
        completedAt: config.completedAt,
    };

    if (config.proxyApiKey) fullConfig['proxyApiKey'] = config.proxyApiKey;
    if (config.ollamaUrl) fullConfig['ollamaUrl'] = config.ollamaUrl;
    if (config.clawHubToken) fullConfig['CLAWHUB_TOKEN'] = config.clawHubToken;

    // CLIProxy credentials
    if (config.inferenceMode === 'cliproxy') {
        if (config.proxyBaseUrl) fullConfig['CLIPROXYAPI_BASE_URL'] = config.proxyBaseUrl;
        if (config.apiKey) fullConfig['CLIPROXYAPI_API_KEY'] = config.apiKey;
        fullConfig['CLIPROXYAPI_ENABLED'] = 'true';
    }

    // Direct API provider keys
    if (config.apiProvider) fullConfig['apiProvider'] = config.apiProvider;
    if (config.apiKey && config.inferenceMode === 'direct-api') {
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
    spin.succeed('Configuration saved');

    // ── Summary Card ────────────────────────────────────────────────────
    console.log('');
    const line = chalk.hex('#6C5CE7')('━'.repeat(52));
    console.log(line);
    console.log(`  ${chalk.bold(chalk.hex('#6C5CE7')('✅ Setup Complete!'))}`);
    console.log(line);
    console.log('');
    console.log(`  ${chalk.dim('Agent'.padEnd(14))} ${chalk.bold(config.agentName)}`);
    console.log(`  ${chalk.dim('Engine'.padEnd(14))} ${config.inferenceMode} / ${chalk.cyan(config.model)}`);
    console.log(`  ${chalk.dim('CLIProxy'.padEnd(14))} ${config.proxyEnabled ? chalk.green('✓ enabled') : chalk.dim('disabled')}`);
    console.log(`  ${chalk.dim('Security'.padEnd(14))} ${config.securityLevel}`);
    console.log(`  ${chalk.dim('Wallet'.padEnd(14))} ${config.walletEnabled ? chalk.green('✓ enabled') : chalk.dim('disabled')}`);
    console.log(`  ${chalk.dim('Channels'.padEnd(14))} ${config.channels.length > 0 ? chalk.cyan(config.channels.join(', ')) : chalk.dim('none')}`);
    console.log(`  ${chalk.dim('Skills Dir'.padEnd(14))} ${chalk.dim(config.skillsDir)}`);
    console.log(`  ${chalk.dim('ClawHub'.padEnd(14))} ${config.clawHubToken ? chalk.green('✓ authenticated') : chalk.dim('public only')}`);
    console.log(`  ${chalk.dim('Browser'.padEnd(14))} ${config.browserProvider === 'none' ? chalk.dim('disabled') : `${config.browserProvider} (${config.browserHeadless ? 'headless' : 'headed'})`}`);
    console.log(`  ${chalk.dim('Interface'.padEnd(14))} ${chalk.bold(config.interface)}`);
    console.log(`  ${chalk.dim('Config'.padEnd(14))} ${configPath}`);
    console.log('');

    // ── Daemon Install ──────────────────────────────────────────────────
    if (options.installDaemon) {
        const daemonSpin = ora({ text: 'Installing ConShell daemon...', indent: 2 }).start();
        try {
            const { installDaemon } = await import('./daemon.js');
            const status = installDaemon({ port: config.port });
            if (status.running) {
                daemonSpin.succeed(`Daemon installed and running (${status.platform})`);
                console.log(chalk.dim(`  Service: ${status.servicePath}`));
            } else {
                daemonSpin.succeed(`Daemon installed (${status.platform})`);
            }
        } catch (err) {
            daemonSpin.warn(`Daemon install skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
        console.log('');
    }

    // ── Auto-launch ─────────────────────────────────────────────────────
    const launch = await confirm({ message: 'Launch ConShell now?', default: true });

    if (launch) {
        console.log('');
        switch (config.interface) {
            case 'repl':
                console.log(chalk.dim('  Starting REPL...\n'));
                try { execSync('conshell', { stdio: 'inherit' }); } catch { /* user quit */ }
                break;
            case 'webui': {
                const webSpin = ora({ text: 'Starting server & opening browser...', indent: 2 }).start();
                try {
                    const { default: open } = await import('open');
                    const { fork } = await import('node:child_process');
                    const serverArgs = ['start', '-p', String(config.port)];
                    const child = fork(
                        path.join(process.argv[1]!, '..', 'index.js'),
                        serverArgs,
                        { detached: true, stdio: 'ignore' },
                    );
                    child.unref();
                    await new Promise(r => setTimeout(r, 2000));
                    await open(`http://localhost:${config.port}`);
                    webSpin.succeed(`Dashboard opened at http://localhost:${config.port}`);
                    console.log(chalk.dim(`  Server running as daemon (PID: ${child.pid})`));
                } catch {
                    webSpin.warn('Could not auto-launch. Start manually:');
                    console.log(chalk.dim(`    conshell start -p ${config.port}`));
                }
                break;
            }
        }
    } else {
        console.log('');
        console.log(chalk.dim('  Ready! Start anytime with:\n'));
        switch (config.interface) {
            case 'repl':
                console.log(`    ${chalk.cyan('conshell')}              ${chalk.dim('# Interactive REPL')}`);
                break;
            case 'webui':
                console.log(`    ${chalk.cyan('conshell start')}        ${chalk.dim('# Start server + WebUI')}`);
                break;
        }
        console.log(`    ${chalk.cyan('conshell login')}        ${chalk.dim('# Connect AI providers')}`);
        console.log(`    ${chalk.cyan('conshell skill search')} ${chalk.dim('# Browse ClawHub')}`);
        console.log(`    ${chalk.cyan('conshell doctor')}       ${chalk.dim('# Health check')}`);
        console.log(`    ${chalk.cyan('conshell configure')}    ${chalk.dim('# Edit settings')}`);
        console.log('');
    }

    return config;
}

/**
 * Generate default config without interactive prompts.
 */
export function generateDefaultConfig(conshellDir?: string): OnboardConfig {
    const dir = conshellDir ?? path.join(os.homedir(), '.conshell');
    return {
        agentName: 'conshell-agent',
        genesisPrompt: 'Autonomous sovereign AI agent',
        inferenceMode: 'ollama',
        model: 'llama3.2',
        ollamaUrl: 'http://localhost:11434',
        proxyEnabled: true,
        securityLevel: 'standard',
        constitutionAccepted: true,
        walletEnabled: false,
        channels: [],
        channelCredentials: {},
        skillsDir: path.join(dir, 'skills'),
        browserProvider: 'playwright',
        browserHeadless: true,
        interface: 'repl',
        port: 4200,
        completedAt: new Date().toISOString(),
    };
}
