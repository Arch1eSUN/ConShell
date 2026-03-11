/**
 * Login Command — `conshell login [provider]`
 *
 * Terminal-based OAuth login for connecting AI provider accounts.
 * Uses the OAuthManager from @conshell/proxy for actual auth flows.
 *
 * Supported providers:
 *   github   — GitHub Copilot (Device Code Flow)
 *   google   — Google Antigravity (Browser Auth + PKCE)
 *   claude   — Anthropic Claude (Guided API Key)
 *   openai   — OpenAI Codex (Guided API Key)
 */

import { select, password, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { OAuthManager, type OAuthProvider, type OAuthProviderConfig } from '@conshell/proxy';
import type { Command } from 'commander';

// ── Provider Display Info ──────────────────────────────────────────────

const PROVIDERS = [
    {
        value: 'github' as const,
        name: `🐙 ${chalk.bold('GitHub Copilot')}       ${chalk.dim('— Device code → auto-poll')}`,
        color: '#6e5494',
    },
    {
        value: 'google' as const,
        name: `🔵 ${chalk.bold('Google Antigravity')}    ${chalk.dim('— Browser OAuth + PKCE')}`,
        color: '#4285f4',
    },
    {
        value: 'claude' as const,
        name: `🟣 ${chalk.bold('Claude (Anthropic)')}    ${chalk.dim('— Guided API key')}`,
        color: '#cc785c',
    },
    {
        value: 'openai' as const,
        name: `🟢 ${chalk.bold('OpenAI Codex')}          ${chalk.dim('— Guided API key')}`,
        color: '#10a37f',
    },
] as const;

// ── Login Flow ─────────────────────────────────────────────────────────

async function loginProvider(provider: OAuthProvider): Promise<void> {
    const config = buildOAuthConfig();
    const logger = { info: console.log, error: console.error, warn: console.warn, debug: () => {} } as any;
    const oauth = new OAuthManager(config, logger);

    console.log('');

    try {
        const flow = await oauth.startFlow(provider);

        if (flow.status === 'error') {
            console.log(`  ${chalk.red('✗')} ${flow.error}`);
            return;
        }

        switch (flow.flowType) {
            case 'device_code':
                await handleDeviceCodeFlow(oauth, provider, flow.userCode!, flow.verificationUri!);
                break;

            case 'authorization_code':
                await handleAuthCodeFlow(oauth, provider, flow.authUrl!);
                break;

            case 'guided_key':
                await handleGuidedKeyFlow(oauth, provider, flow.guideUrl!);
                break;
        }
    } catch (err) {
        console.log(`  ${chalk.red('✗')} Login failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        oauth.destroy();
    }
}

async function handleDeviceCodeFlow(
    oauth: OAuthManager,
    provider: OAuthProvider,
    userCode: string,
    verificationUri: string,
): Promise<void> {
    console.log(chalk.dim('  ┌─────────────────────────────────────────────┐'));
    console.log(`  │  Open: ${chalk.cyan.underline(verificationUri)}`);
    console.log(`  │  Code: ${chalk.bold.yellow(userCode)}             │`);
    console.log(chalk.dim('  └─────────────────────────────────────────────┘'));
    console.log('');

    // Try to auto-open browser
    try {
        const { default: open } = await import('open');
        await open(verificationUri);
        console.log(chalk.dim('  Browser opened automatically.'));
    } catch {
        console.log(chalk.dim('  Open the link above in your browser.'));
    }

    const spin = ora({ text: 'Waiting for authorization...', indent: 2 }).start();

    // Poll until success, error, or timeout
    const startTime = Date.now();
    const TIMEOUT = 300_000; // 5 min

    while (Date.now() - startTime < TIMEOUT) {
        await sleep(3000);
        const status = oauth.getFlowStatus(provider);

        if (status?.status === 'success') {
            spin.succeed(`${providerDisplayName(provider)} connected!`);
            return;
        }
        if (status?.status === 'error') {
            spin.fail(status.error ?? 'Authorization failed');
            return;
        }
    }

    spin.fail('Authorization timed out (5 minutes)');
}

async function handleAuthCodeFlow(
    oauth: OAuthManager,
    _provider: OAuthProvider,
    authUrl: string,
): Promise<void> {
    console.log(`  Opening browser for authorization...\n`);
    console.log(`  ${chalk.dim('URL:')} ${chalk.cyan.underline(authUrl)}\n`);

    try {
        const { default: open } = await import('open');
        await open(authUrl);
    } catch {
        console.log(chalk.dim('  Could not auto-open. Copy the URL above into your browser.'));
    }

    console.log(chalk.dim('  After authorizing, the browser will redirect back automatically.'));
    console.log(chalk.dim('  If that fails, paste the authorization code below:\n'));

    const code = await password({
        message: 'Authorization code (or Enter to skip)',
        mask: '•',
    });

    if (code) {
        const spin = ora({ text: 'Exchanging code for token...', indent: 2 }).start();
        try {
            await oauth.handleCallback('google', code);
            spin.succeed('Google Antigravity connected!');
        } catch (err) {
            spin.fail(`Token exchange failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

async function handleGuidedKeyFlow(
    oauth: OAuthManager,
    provider: OAuthProvider,
    guideUrl: string,
): Promise<void> {
    const displayName = providerDisplayName(provider);

    console.log(chalk.dim('  ┌─────────────────────────────────────────────┐'));
    console.log(`  │  Open: ${chalk.cyan.underline(guideUrl)}`);
    console.log(`  │  Create an API key and paste it below.      │`);
    console.log(chalk.dim('  └─────────────────────────────────────────────┘'));
    console.log('');

    try {
        const { default: open } = await import('open');
        await open(guideUrl);
    } catch {
        console.log(chalk.dim('  Open the link above in your browser.'));
    }

    const apiKey = await password({
        message: `${displayName} API key`,
        mask: '•',
    });

    if (!apiKey) {
        console.log(chalk.dim('  Skipped. You can login later with `conshell login`.'));
        return;
    }

    const spin = ora({ text: 'Validating API key...', indent: 2 }).start();
    try {
        await oauth.submitManualKey(provider, apiKey);
        spin.succeed(`${displayName} connected!`);

        // Save to config
        await saveKeyToConfig(provider, apiKey);
    } catch (err) {
        spin.fail(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// ── CLI Registration ───────────────────────────────────────────────────

export function registerLoginCommand(program: Command): void {
    const loginCmd = program
        .command('login [provider]')
        .description('Connect an AI provider account via OAuth or API key')
        .action(async (provider?: string) => {
            printLoginHeader();

            let targetProvider: OAuthProvider;

            if (provider && isValidProvider(provider)) {
                targetProvider = provider;
            } else {
                targetProvider = await select({
                    message: 'Which provider do you want to connect?',
                    choices: PROVIDERS.map(p => ({
                        name: p.name,
                        value: p.value,
                    })),
                });
            }

            await loginProvider(targetProvider);

            // Ask to connect another
            const another = await confirm({
                message: 'Connect another provider?',
                default: false,
            });

            if (another) {
                const nextProvider = await select({
                    message: 'Which provider?',
                    choices: PROVIDERS.map(p => ({
                        name: p.name,
                        value: p.value,
                    })),
                });
                await loginProvider(nextProvider);
            }

            console.log('');
            console.log(chalk.dim('  Manage providers anytime: conshell login'));
            console.log(chalk.dim('  Or in the Dashboard:      http://localhost:4200/settings'));
            console.log('');
        });

    // Direct sub-commands for each provider
    for (const p of PROVIDERS) {
        loginCmd
            .command(p.value)
            .description(`Connect ${providerDisplayName(p.value)}`)
            .action(async () => {
                printLoginHeader();
                await loginProvider(p.value);
            });
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function printLoginHeader(): void {
    console.log('');
    console.log(chalk.hex('#00B894')('  🔐 ConShell Login'));
    console.log(chalk.dim('  Connect your AI provider accounts\n'));
}

function providerDisplayName(provider: OAuthProvider): string {
    const names: Record<OAuthProvider, string> = {
        github: 'GitHub Copilot',
        google: 'Google Antigravity',
        claude: 'Claude (Anthropic)',
        openai: 'OpenAI Codex',
    };
    return names[provider];
}

function isValidProvider(p: string): p is OAuthProvider {
    return ['github', 'google', 'claude', 'openai'].includes(p);
}

function buildOAuthConfig(): OAuthProviderConfig {
    return {
        github: process.env['GITHUB_OAUTH_CLIENT_ID']
            ? { clientId: process.env['GITHUB_OAUTH_CLIENT_ID'] }
            : undefined,
        google: process.env['GOOGLE_OAUTH_CLIENT_ID']
            ? {
                clientId: process.env['GOOGLE_OAUTH_CLIENT_ID']!,
                clientSecret: process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? '',
                redirectUri: process.env['GOOGLE_OAUTH_REDIRECT_URI']
                    ?? `http://localhost:${process.env['PORT'] ?? '4200'}/api/oauth/google/callback`,
            }
            : undefined,
    };
}

async function saveKeyToConfig(provider: OAuthProvider, apiKey: string): Promise<void> {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const configPath = path.join(os.homedir(), '.conshell', 'config.json');
    let config: Record<string, unknown> = {};

    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch { /* new config */ }

    const envKeys: Record<OAuthProvider, string> = {
        claude: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
        github: 'GITHUB_TOKEN',
        google: 'GOOGLE_TOKEN',
    };

    config[envKeys[provider]] = apiKey;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
