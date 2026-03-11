/**
 * Shared UI utilities for ConShell CLI.
 * Gradient banners, spinners, styled logging, and color palette.
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';

// ── Color Palette ──────────────────────────────────────────────────────

export const palette = {
    primary: chalk.hex('#6C5CE7'),
    secondary: chalk.hex('#00B894'),
    accent: chalk.hex('#FDCB6E'),
    muted: chalk.hex('#636E72'),
    success: chalk.hex('#00B894'),
    warning: chalk.hex('#FDCB6E'),
    error: chalk.hex('#E17055'),
    info: chalk.hex('#74B9FF'),
    dim: chalk.dim,
    bold: chalk.bold,
} as const;

// ── Banner ─────────────────────────────────────────────────────────────

const BANNER_LINES = [
    '   ██████╗ ██████╗ ███╗   ██╗███████╗██╗  ██╗███████╗██╗     ██╗     ',
    '  ██╔════╝██╔═══██╗████╗  ██║██╔════╝██║  ██║██╔════╝██║     ██║     ',
    '  ██║     ██║   ██║██╔██╗ ██║███████╗███████║█████╗  ██║     ██║     ',
    '  ██║     ██║   ██║██║╚██╗██║╚════██║██╔══██║██╔══╝  ██║     ██║     ',
    '  ╚██████╗╚██████╔╝██║ ╚████║███████║██║  ██║███████╗███████╗███████╗',
    '   ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝',
];

const GRADIENT_COLORS = ['#6C5CE7', '#A29BFE', '#74B9FF', '#00B894', '#00CEC9', '#55EFC4'];

export function banner(version?: string): void {
    console.log('');
    BANNER_LINES.forEach((line, i) => {
        const color = GRADIENT_COLORS[i % GRADIENT_COLORS.length]!;
        console.log(chalk.hex(color)(line));
    });
    const subtitle = palette.muted('  Sovereign AI Agent Runtime');
    const ver = version ? palette.dim(`  v${version}`) : '';
    console.log(`${subtitle}${ver}`);
    console.log('');
}

// ── Mini Banner (for subcommands) ──────────────────────────────────────

export function miniBanner(title: string, subtitle?: string): void {
    const line = palette.primary('━'.repeat(48));
    console.log('');
    console.log(line);
    console.log(`  ${palette.bold(palette.primary(title))}`);
    if (subtitle) console.log(`  ${palette.muted(subtitle)}`);
    console.log(line);
    console.log('');
}

// ── Styled Logging ─────────────────────────────────────────────────────

export function success(msg: string): void {
    console.log(`  ${palette.success('✓')} ${msg}`);
}

export function warn(msg: string): void {
    console.log(`  ${palette.warning('⚠')} ${msg}`);
}

export function fail(msg: string): void {
    console.log(`  ${palette.error('✗')} ${msg}`);
}

export function info(msg: string): void {
    console.log(`  ${palette.info('ℹ')} ${msg}`);
}

export function label(key: string, value: string): void {
    console.log(`  ${palette.muted(key.padEnd(12))} ${value}`);
}

// ── Spinner Wrapper ────────────────────────────────────────────────────

export function spinner(text: string): Ora {
    return ora({
        text,
        color: 'cyan',
        spinner: 'dots',
        indent: 2,
    });
}

// ── Step Progress (for wizards) ────────────────────────────────────────

export function stepProgress(current: number, total: number, icon: string, title: string): void {
    const filled = '█'.repeat(current);
    const empty = '░'.repeat(total - current);
    const bar = palette.primary(filled) + palette.dim(empty);
    console.log(`\n  ${bar}  ${palette.muted(`${current}/${total}`)}`);
    console.log(`\n  ${icon}  ${palette.bold(title)}\n`);
}

// ── Open Browser ───────────────────────────────────────────────────────

export async function openBrowser(url: string): Promise<void> {
    try {
        const { default: open } = await import('open');
        await open(url);
    } catch {
        // Silently fail — user can open manually
    }
}
