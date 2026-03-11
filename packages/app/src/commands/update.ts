/**
 * `conshell update` — Self-update from git.
 */
import type { Command } from 'commander';
import { miniBanner, success, info, warn, fail, spinner, palette } from '../utils/ui.js';

export function registerUpdateCommand(program: Command): void {
    program
        .command('update')
        .description('Update ConShell to the latest version')
        .option('--dry-run', 'Check for updates without applying')
        .action(async (opts) => {
            const path = await import('node:path');
            const { execSync } = await import('node:child_process');

            miniBanner('ConShell Update', 'Self-update from source');

            // Find source directory
            const binPath = process.argv[1] ?? '';
            const sourceDir = path.default.resolve(binPath, '..', '..', '..');

            const s = spinner('Checking for updates...');
            s.start();

            try {
                execSync('git fetch origin main', { cwd: sourceDir, stdio: 'pipe' });

                const localHash = execSync('git rev-parse HEAD', { cwd: sourceDir, encoding: 'utf-8' }).trim();
                const remoteHash = execSync('git rev-parse origin/main', { cwd: sourceDir, encoding: 'utf-8' }).trim();

                if (localHash === remoteHash) {
                    s.succeed('Already up to date');
                    info(`Current: ${localHash.slice(0, 8)}`);
                    return;
                }

                const log = execSync(`git log --oneline ${localHash}..${remoteHash}`, {
                    cwd: sourceDir,
                    encoding: 'utf-8',
                }).trim();
                const commitCount = log.split('\n').length;
                s.succeed(`${commitCount} update(s) available`);

                console.log(`\n  ${palette.muted('Changes:')}`);
                for (const line of log.split('\n').slice(0, 10)) {
                    console.log(`    ${line}`);
                }
                if (commitCount > 10) {
                    console.log(palette.dim(`    ... and ${commitCount - 10} more`));
                }

                if (opts.dryRun) {
                    console.log('');
                    info('Dry run — no changes applied');
                    return;
                }

                // Pull + rebuild
                const pull = spinner('Pulling updates...');
                pull.start();
                execSync('git pull --rebase origin main', { cwd: sourceDir, stdio: 'pipe' });
                pull.succeed('Updates pulled');

                const install = spinner('Installing dependencies...');
                install.start();
                execSync('pnpm install', { cwd: sourceDir, stdio: 'pipe' });
                install.succeed('Dependencies installed');

                const build = spinner('Building...');
                build.start();
                execSync('pnpm -r build', { cwd: sourceDir, stdio: 'pipe' });
                build.succeed('Build complete');

                const link = spinner('Re-linking CLI...');
                link.start();
                execSync('npm link', { cwd: path.default.join(sourceDir, 'packages', 'app'), stdio: 'pipe' });
                link.succeed('CLI linked');

                const newHash = execSync('git rev-parse HEAD', { cwd: sourceDir, encoding: 'utf-8' }).trim();
                console.log('');
                success(`Updated to ${newHash.slice(0, 8)}`);
                info('Restart any running instances to apply changes');
                console.log('');

            } catch (err) {
                s.fail('Update failed');
                console.error(err instanceof Error ? err.message : err);
                console.error(palette.dim(`  Try manually: cd ${sourceDir} && git pull && pnpm build`));
                process.exit(1);
            }
        });
}
