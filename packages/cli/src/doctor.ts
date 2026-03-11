/**
 * Doctor — System health diagnostics for ConShell.
 *
 * Checks: Node version, SQLite integrity, Ollama, disk, wallet perms, scheduler, errors.
 * `conshell doctor` → report, `conshell doctor --fix` → auto-fix fixable issues.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
    readonly name: string;
    readonly status: CheckStatus;
    readonly message: string;
    readonly fixable: boolean;
    readonly fixAction?: string;
}

export interface DoctorReport {
    readonly timestamp: string;
    readonly checks: CheckResult[];
    readonly passed: number;
    readonly warned: number;
    readonly failed: number;
    readonly score: number; // 0-100
}

export interface DoctorOptions {
    readonly fix?: boolean;
    readonly dbPath?: string;
    readonly walletPath?: string;
    readonly conshellDir?: string;
}

// ── Individual Checks ───────────────────────────────────────────────────

function checkNodeVersion(): CheckResult {
    const version = process.versions.node;
    const major = parseInt(version.split('.')[0]!, 10);

    if (major >= 20) {
        return { name: 'Node.js Version', status: 'pass', message: `v${version} (≥ 20 ✓)`, fixable: false };
    }
    if (major >= 18) {
        return { name: 'Node.js Version', status: 'warn', message: `v${version} — recommend ≥ 20`, fixable: false };
    }
    return { name: 'Node.js Version', status: 'fail', message: `v${version} — requires ≥ 18, recommend ≥ 20`, fixable: false };
}

function checkDiskSpace(): CheckResult {
    try {
        const home = os.homedir();
        const stat = fs.statfsSync(home);
        const freeGB = (stat.bfree * stat.bsize) / (1024 ** 3);

        if (freeGB > 5) {
            return { name: 'Disk Space', status: 'pass', message: `${freeGB.toFixed(1)} GB free`, fixable: false };
        }
        if (freeGB > 1) {
            return { name: 'Disk Space', status: 'warn', message: `${freeGB.toFixed(1)} GB free — low`, fixable: false };
        }
        return { name: 'Disk Space', status: 'fail', message: `${freeGB.toFixed(2)} GB free — critically low`, fixable: false };
    } catch {
        return { name: 'Disk Space', status: 'warn', message: 'Unable to check disk space', fixable: false };
    }
}

function checkMemoryUsage(): CheckResult {
    const totalMB = os.totalmem() / (1024 ** 2);
    const freeMB = os.freemem() / (1024 ** 2);
    const usedPercent = ((totalMB - freeMB) / totalMB) * 100;

    if (usedPercent < 80) {
        return {
            name: 'Memory Usage', status: 'pass',
            message: `${usedPercent.toFixed(0)}% used (${freeMB.toFixed(0)} MB free)`, fixable: false,
        };
    }
    if (usedPercent < 95) {
        return {
            name: 'Memory Usage', status: 'warn',
            message: `${usedPercent.toFixed(0)}% used — high`, fixable: false,
        };
    }
    return {
        name: 'Memory Usage', status: 'fail',
        message: `${usedPercent.toFixed(0)}% used — critically high`, fixable: false,
    };
}

function checkOllama(): CheckResult {
    try {
        const result = execSync('curl -sf http://localhost:11434/api/tags 2>/dev/null', {
            timeout: 5_000,
            encoding: 'utf8',
        });
        const data = JSON.parse(result);
        const models = (data.models ?? []).length;
        return {
            name: 'Ollama', status: 'pass',
            message: `Running — ${models} model(s) installed`, fixable: false,
        };
    } catch {
        return {
            name: 'Ollama', status: 'warn',
            message: 'Not reachable (localhost:11434) — optional for cloud mode',
            fixable: false,
        };
    }
}

function checkSqliteIntegrity(dbPath?: string): CheckResult {
    if (!dbPath) {
        return { name: 'SQLite Database', status: 'warn', message: 'No DB path configured', fixable: false };
    }
    if (!fs.existsSync(dbPath)) {
        return { name: 'SQLite Database', status: 'warn', message: `Not found: ${dbPath}`, fixable: false };
    }
    try {
        const result = execSync(`sqlite3 ${JSON.stringify(dbPath)} "PRAGMA integrity_check;"`, {
            timeout: 10_000,
            encoding: 'utf8',
        }).trim();
        if (result === 'ok') {
            const stat = fs.statSync(dbPath);
            const sizeMB = (stat.size / (1024 ** 2)).toFixed(1);
            return { name: 'SQLite Database', status: 'pass', message: `Integrity OK (${sizeMB} MB)`, fixable: false };
        }
        return { name: 'SQLite Database', status: 'fail', message: `Integrity issue: ${result}`, fixable: false };
    } catch {
        return { name: 'SQLite Database', status: 'warn', message: 'Could not verify (sqlite3 CLI not found?)', fixable: false };
    }
}

function checkWalletPermissions(walletPath?: string): CheckResult {
    if (!walletPath) {
        const defaultPath = path.join(os.homedir(), '.conshell', 'wallet.json');
        if (!fs.existsSync(defaultPath)) {
            return { name: 'Wallet Permissions', status: 'pass', message: 'No wallet file (not yet created)', fixable: false };
        }
        walletPath = defaultPath;
    }
    if (!fs.existsSync(walletPath)) {
        return { name: 'Wallet Permissions', status: 'pass', message: 'No wallet file', fixable: false };
    }

    try {
        const stat = fs.statSync(walletPath);
        const mode = (stat.mode & 0o777).toString(8);
        if (mode === '600') {
            return { name: 'Wallet Permissions', status: 'pass', message: 'wallet.json permissions 0600 ✓', fixable: false };
        }
        return {
            name: 'Wallet Permissions', status: 'fail',
            message: `wallet.json permissions 0${mode} — should be 0600`,
            fixable: true,
            fixAction: `chmod 600 ${walletPath}`,
        };
    } catch {
        return { name: 'Wallet Permissions', status: 'warn', message: 'Could not stat wallet file', fixable: false };
    }
}

function checkConshellDir(conshellDir?: string): CheckResult {
    const dir = conshellDir ?? path.join(os.homedir(), '.conshell');
    if (fs.existsSync(dir)) {
        return { name: 'ConShell Directory', status: 'pass', message: `~/.conshell exists`, fixable: false };
    }
    return {
        name: 'ConShell Directory', status: 'warn',
        message: '~/.conshell not found — will be created on first run',
        fixable: true,
        fixAction: `mkdir -p ${dir}`,
    };
}

function checkConstitution(): CheckResult {
    // Try to find CONSTITUTION.md from package root
    const candidates = [
        path.resolve(process.cwd(), 'CONSTITUTION.md'),
        path.resolve(__dirname, '../../../../CONSTITUTION.md'),
        path.resolve(__dirname, '../../../CONSTITUTION.md'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return { name: 'Constitution', status: 'pass', message: 'CONSTITUTION.md present ✓', fixable: false };
        }
    }
    return {
        name: 'Constitution', status: 'fail',
        message: 'CONSTITUTION.md not found — required for security',
        fixable: false,
    };
}

// ── applyFix ────────────────────────────────────────────────────────────

function applyFix(check: CheckResult): CheckResult {
    if (!check.fixable || !check.fixAction) return check;
    try {
        execSync(check.fixAction, { timeout: 5_000 });
        return {
            ...check,
            status: 'pass',
            message: `${check.message} → FIXED ✓`,
        };
    } catch {
        return {
            ...check,
            message: `${check.message} → fix failed`,
        };
    }
}

// ── Main Doctor Entrypoint ──────────────────────────────────────────────

export function runDoctor(options: DoctorOptions = {}): DoctorReport {
    let checks: CheckResult[] = [
        checkNodeVersion(),
        checkConshellDir(options.conshellDir),
        checkConstitution(),
        checkDiskSpace(),
        checkMemoryUsage(),
        checkOllama(),
        checkSqliteIntegrity(options.dbPath),
        checkWalletPermissions(options.walletPath),
    ];

    // Auto-fix mode
    if (options.fix) {
        checks = checks.map(c => c.fixable ? applyFix(c) : c);
    }

    const passed = checks.filter(c => c.status === 'pass').length;
    const warned = checks.filter(c => c.status === 'warn').length;
    const failed = checks.filter(c => c.status === 'fail').length;

    // Score: pass = full, warn = half, fail = 0
    const total = checks.length;
    const score = total > 0 ? Math.round(((passed + warned * 0.5) / total) * 100) : 0;

    return {
        timestamp: new Date().toISOString(),
        checks,
        passed,
        warned,
        failed,
        score,
    };
}

/**
 * Format doctor report as a human-readable string.
 */
export function formatDoctorReport(report: DoctorReport): string {
    const lines: string[] = [
        '🏥 ConShell Doctor — Health Report',
        `   Score: ${report.score}/100`,
        `   Time:  ${report.timestamp}`,
        '',
    ];

    for (const c of report.checks) {
        const icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️ ' : '❌';
        const fix = (c.fixable && c.status !== 'pass') ? ' [fixable]' : '';
        lines.push(`  ${icon} ${c.name}: ${c.message}${fix}`);
    }

    lines.push('');
    lines.push(`  Total: ${report.passed} passed, ${report.warned} warnings, ${report.failed} failed`);

    if (report.failed > 0) {
        lines.push('');
        lines.push('  Run `conshell doctor --fix` to auto-fix fixable issues.');
    }

    return lines.join('\n');
}
