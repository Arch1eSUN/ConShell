/**
 * TUI — Terminal UI renderer (`packages/core/src/tui/`)
 *
 * Renders an ANSI-based dashboard in the terminal.
 * Panels: Status bar, Log stream, Chat input, Tool calls.
 * Keybindings: q=quit, s=status, m=memory, t=tools
 *
 * Uses plain ANSI escape codes — no external dependencies.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface TuiPanel {
    id: string;
    title: string;
    content: string[];
    maxLines: number;
}

export type TuiKeybinding = {
    key: string;
    label: string;
    action: () => void;
};

export interface TuiConfig {
    width?: number;
    height?: number;
    borderChar?: string;
}

export interface TuiState {
    panels: Map<string, TuiPanel>;
    statusText: string;
    activePanel: string;
    keybindings: TuiKeybinding[];
}

// ── ANSI Helpers ────────────────────────────────────────────────────────

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgBlue: '\x1b[44m',
    bgGray: '\x1b[100m',
    clearScreen: '\x1b[2J\x1b[H',
} as const;

// ── TuiRenderer ─────────────────────────────────────────────────────────

export class TuiRenderer {
    private state: TuiState;
    private readonly config: Required<TuiConfig>;

    constructor(config: TuiConfig = {}) {
        this.config = {
            width: config.width ?? 80,
            height: config.height ?? 24,
            borderChar: config.borderChar ?? '─',
        };
        this.state = {
            panels: new Map(),
            statusText: 'Idle',
            activePanel: '',
            keybindings: [],
        };
    }

    // ── Panel Management ─────────────────────────────────────────

    addPanel(id: string, title: string, maxLines = 10): void {
        this.state.panels.set(id, {
            id,
            title,
            content: [],
            maxLines,
        });
        if (!this.state.activePanel) this.state.activePanel = id;
    }

    appendToPanel(id: string, line: string): void {
        const panel = this.state.panels.get(id);
        if (!panel) return;
        panel.content.push(line);
        while (panel.content.length > panel.maxLines) {
            panel.content.shift();
        }
    }

    clearPanel(id: string): void {
        const panel = this.state.panels.get(id);
        if (panel) panel.content = [];
    }

    setActivePanel(id: string): void {
        if (this.state.panels.has(id)) {
            this.state.activePanel = id;
        }
    }

    // ── Status ───────────────────────────────────────────────────

    setStatus(text: string): void {
        this.state.statusText = text;
    }

    // ── Keybindings ──────────────────────────────────────────────

    registerKeybinding(key: string, label: string, action: () => void): void {
        this.state.keybindings.push({ key, label, action });
    }

    handleKey(key: string): boolean {
        const binding = this.state.keybindings.find(kb => kb.key === key);
        if (binding) {
            binding.action();
            return true;
        }
        return false;
    }

    // ── Rendering ────────────────────────────────────────────────

    renderStatusBar(): string {
        const { width } = this.config;
        const text = ` ConShell TUI — ${this.state.statusText} `;
        const padded = text.padEnd(width, ' ').slice(0, width);
        return `${ANSI.bgBlue}${ANSI.white}${ANSI.bold}${padded}${ANSI.reset}`;
    }

    renderPanel(id: string): string[] {
        const panel = this.state.panels.get(id);
        if (!panel) return [];
        const { width, borderChar } = this.config;
        const isActive = id === this.state.activePanel;

        const lines: string[] = [];
        const titleColor = isActive ? ANSI.cyan : ANSI.dim;
        const border = borderChar.repeat(width);

        lines.push(`${titleColor}${border}${ANSI.reset}`);
        lines.push(`${titleColor}${ANSI.bold} ${panel.title} ${ANSI.reset}`);
        lines.push(`${titleColor}${border}${ANSI.reset}`);

        for (const contentLine of panel.content) {
            lines.push(` ${contentLine}`);
        }

        // Pad empty lines
        const remaining = panel.maxLines - panel.content.length;
        for (let i = 0; i < remaining; i++) {
            lines.push('');
        }

        return lines;
    }

    renderKeybindings(): string {
        const parts = this.state.keybindings.map(
            kb => `${ANSI.bold}[${kb.key}]${ANSI.reset} ${kb.label}`,
        );
        return parts.join('  ');
    }

    renderFrame(): string {
        const lines: string[] = [];

        lines.push(this.renderStatusBar());
        lines.push('');

        for (const [id] of this.state.panels) {
            lines.push(...this.renderPanel(id));
            lines.push('');
        }

        lines.push(this.renderKeybindings());

        return lines.join('\n');
    }

    render(): string {
        return `${ANSI.clearScreen}${this.renderFrame()}`;
    }

    // ── Queries ──────────────────────────────────────────────────

    get panelIds(): string[] { return [...this.state.panels.keys()]; }
    get panelCount(): number { return this.state.panels.size; }
    get status(): string { return this.state.statusText; }
    get active(): string { return this.state.activePanel; }
}
