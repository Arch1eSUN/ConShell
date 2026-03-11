/**
 * Daemon Installer — Install/uninstall ConShell as a system daemon.
 *
 * Supports:
 *   - macOS: ~/Library/LaunchAgents/ai.conshell.agent.plist (launchd)
 *   - Linux: ~/.config/systemd/user/conshell.service (systemd)
 *
 * The daemon auto-starts the ConShell gateway on login,
 * restarts on crash, and keeps the agent always-on.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

// ── Types ──────────────────────────────────────────────────────────────

export interface DaemonConfig {
    readonly port: number;
    readonly logLevel: string;
    readonly conshellBin: string;
}

export interface DaemonStatus {
    readonly installed: boolean;
    readonly running: boolean;
    readonly platform: 'macos' | 'linux' | 'unsupported';
    readonly servicePath?: string;
    readonly pid?: number;
}

// ── Platform Detection ─────────────────────────────────────────────────

function detectPlatform(): 'macos' | 'linux' | 'unsupported' {
    const p = os.platform();
    if (p === 'darwin') return 'macos';
    if (p === 'linux') return 'linux';
    return 'unsupported';
}

function findConshellBin(): string {
    try {
        return execSync('which conshell', { encoding: 'utf-8' }).trim();
    } catch {
        // Fallback: use the node_modules/.bin path
        return path.join(process.cwd(), 'node_modules', '.bin', 'conshell');
    }
}

// ── macOS: launchd ─────────────────────────────────────────────────────

const LAUNCHD_LABEL = 'ai.conshell.agent';
const LAUNCHD_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const LAUNCHD_PLIST = path.join(LAUNCHD_DIR, `${LAUNCHD_LABEL}.plist`);

function generatePlist(config: DaemonConfig): string {
    const logDir = path.join(os.homedir(), '.conshell', 'logs');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${config.conshellBin}</string>
        <string>start</string>
        <string>-p</string>
        <string>${config.port}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>LOG_LEVEL</key>
        <string>${config.logLevel}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${path.dirname(config.conshellBin)}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${path.join(logDir, 'daemon.stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(logDir, 'daemon.stderr.log')}</string>
    <key>WorkingDirectory</key>
    <string>${os.homedir()}</string>
</dict>
</plist>`;
}

function installLaunchd(config: DaemonConfig): void {
    const logDir = path.join(os.homedir(), '.conshell', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(LAUNCHD_DIR, { recursive: true });

    // Unload first if exists
    try { execSync(`launchctl unload ${LAUNCHD_PLIST} 2>/dev/null`); } catch { /* ok */ }

    fs.writeFileSync(LAUNCHD_PLIST, generatePlist(config));
    execSync(`launchctl load ${LAUNCHD_PLIST}`);
}

function uninstallLaunchd(): void {
    try { execSync(`launchctl unload ${LAUNCHD_PLIST} 2>/dev/null`); } catch { /* ok */ }
    try { fs.unlinkSync(LAUNCHD_PLIST); } catch { /* ok */ }
}

function launchdStatus(): { installed: boolean; running: boolean; pid?: number } {
    const installed = fs.existsSync(LAUNCHD_PLIST);
    let running = false;
    let pid: number | undefined;

    if (installed) {
        try {
            const out = execSync(`launchctl list ${LAUNCHD_LABEL} 2>/dev/null`, { encoding: 'utf-8' });
            running = !out.includes('Could not find');
            const pidMatch = out.match(/"PID"\s*=\s*(\d+)/);
            if (pidMatch) pid = parseInt(pidMatch[1]!, 10);
        } catch { /* not running */ }
    }

    return { installed, running, pid };
}

// ── Linux: systemd ─────────────────────────────────────────────────────

const SYSTEMD_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SYSTEMD_SERVICE = path.join(SYSTEMD_DIR, 'conshell.service');

function generateSystemdUnit(config: DaemonConfig): string {
    return `[Unit]
Description=ConShell — Sovereign AI Agent Runtime
After=network.target

[Service]
Type=simple
ExecStart=${config.conshellBin} start -p ${config.port}
Environment=LOG_LEVEL=${config.logLevel}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${path.dirname(config.conshellBin)}
Restart=on-failure
RestartSec=10
WorkingDirectory=${os.homedir()}
StandardOutput=append:${path.join(os.homedir(), '.conshell', 'logs', 'daemon.stdout.log')}
StandardError=append:${path.join(os.homedir(), '.conshell', 'logs', 'daemon.stderr.log')}

[Install]
WantedBy=default.target
`;
}

function installSystemd(config: DaemonConfig): void {
    const logDir = path.join(os.homedir(), '.conshell', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(SYSTEMD_DIR, { recursive: true });

    fs.writeFileSync(SYSTEMD_SERVICE, generateSystemdUnit(config));
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable conshell.service');
    execSync('systemctl --user start conshell.service');
}

function uninstallSystemd(): void {
    try { execSync('systemctl --user stop conshell.service 2>/dev/null'); } catch { /* ok */ }
    try { execSync('systemctl --user disable conshell.service 2>/dev/null'); } catch { /* ok */ }
    try { fs.unlinkSync(SYSTEMD_SERVICE); } catch { /* ok */ }
    try { execSync('systemctl --user daemon-reload'); } catch { /* ok */ }
}

function systemdStatus(): { installed: boolean; running: boolean; pid?: number } {
    const installed = fs.existsSync(SYSTEMD_SERVICE);
    let running = false;
    let pid: number | undefined;

    if (installed) {
        try {
            const out = execSync('systemctl --user is-active conshell.service 2>/dev/null', { encoding: 'utf-8' }).trim();
            running = out === 'active';
        } catch { /* inactive */ }
        if (running) {
            try {
                const out = execSync('systemctl --user show conshell.service --property=MainPID 2>/dev/null', { encoding: 'utf-8' });
                const match = out.match(/MainPID=(\d+)/);
                if (match && match[1] !== '0') pid = parseInt(match[1]!, 10);
            } catch { /* ok */ }
        }
    }

    return { installed, running, pid };
}

// ── Public API ─────────────────────────────────────────────────────────

export function installDaemon(options?: { port?: number; logLevel?: string }): DaemonStatus {
    const platform = detectPlatform();

    if (platform === 'unsupported') {
        throw new Error('Daemon install is only supported on macOS (launchd) and Linux (systemd).');
    }

    const config: DaemonConfig = {
        port: options?.port ?? 4200,
        logLevel: options?.logLevel ?? 'info',
        conshellBin: findConshellBin(),
    };

    if (platform === 'macos') {
        installLaunchd(config);
        const s = launchdStatus();
        return { ...s, platform, servicePath: LAUNCHD_PLIST };
    } else {
        installSystemd(config);
        const s = systemdStatus();
        return { ...s, platform, servicePath: SYSTEMD_SERVICE };
    }
}

export function uninstallDaemon(): DaemonStatus {
    const platform = detectPlatform();

    if (platform === 'macos') {
        uninstallLaunchd();
    } else if (platform === 'linux') {
        uninstallSystemd();
    }

    return getDaemonStatus();
}

export function getDaemonStatus(): DaemonStatus {
    const platform = detectPlatform();

    if (platform === 'macos') {
        const s = launchdStatus();
        return { ...s, platform, servicePath: LAUNCHD_PLIST };
    } else if (platform === 'linux') {
        const s = systemdStatus();
        return { ...s, platform, servicePath: SYSTEMD_SERVICE };
    }

    return { installed: false, running: false, platform };
}
