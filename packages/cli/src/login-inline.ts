/**
 * Inline login helper — lightweight provider connection for use inside onboard wizard.
 *
 * Saves the API key to ~/.conshell/config.json without starting a full OAuth flow.
 * For full OAuth (device code, PKCE), use `conshell login` instead.
 */

import chalk from 'chalk';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ENV_KEY_MAP: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GEMINI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
};

/**
 * Save a provider's API key to config and confirm.
 * Called inline from onboard step 2.
 */
export async function loginProviderInline(provider: string, apiKey: string): Promise<void> {
    const envKey = ENV_KEY_MAP[provider];
    if (!envKey) {
        console.log(chalk.dim(`  Unknown provider: ${provider}`));
        return;
    }

    const configPath = path.join(os.homedir(), '.conshell', 'config.json');
    let config: Record<string, unknown> = {};

    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch { /* new config */ }

    config[envKey] = apiKey;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    console.log(`  ${chalk.green('✓')} ${provider} API key saved to config`);
}
