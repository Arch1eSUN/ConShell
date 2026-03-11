import { describe, it, expect } from 'vitest';
import { TuiRenderer } from './tui.js';

describe('TuiRenderer', () => {
    it('creates with default config', () => {
        const tui = new TuiRenderer();
        expect(tui.panelCount).toBe(0);
        expect(tui.status).toBe('Idle');
    });

    it('adds panels', () => {
        const tui = new TuiRenderer();
        tui.addPanel('logs', 'Logs', 5);
        tui.addPanel('chat', 'Chat', 5);
        expect(tui.panelCount).toBe(2);
        expect(tui.panelIds).toEqual(['logs', 'chat']);
    });

    it('first panel becomes active', () => {
        const tui = new TuiRenderer();
        tui.addPanel('logs', 'Logs');
        expect(tui.active).toBe('logs');
    });

    it('sets active panel', () => {
        const tui = new TuiRenderer();
        tui.addPanel('logs', 'Logs');
        tui.addPanel('chat', 'Chat');
        tui.setActivePanel('chat');
        expect(tui.active).toBe('chat');
    });

    it('ignores invalid active panel', () => {
        const tui = new TuiRenderer();
        tui.addPanel('logs', 'Logs');
        tui.setActivePanel('nonexistent');
        expect(tui.active).toBe('logs');
    });

    it('appends lines to panel', () => {
        const tui = new TuiRenderer();
        tui.addPanel('logs', 'Logs', 3);
        tui.appendToPanel('logs', 'Line 1');
        tui.appendToPanel('logs', 'Line 2');
        const frame = tui.renderPanel('logs');
        expect(frame.some(l => l.includes('Line 1'))).toBe(true);
        expect(frame.some(l => l.includes('Line 2'))).toBe(true);
    });

    it('evicts old lines when maxLines exceeded', () => {
        const tui = new TuiRenderer();
        tui.addPanel('logs', 'Logs', 2);
        tui.appendToPanel('logs', 'A');
        tui.appendToPanel('logs', 'B');
        tui.appendToPanel('logs', 'C');
        const frame = tui.renderPanel('logs');
        const content = frame.join('\n');
        expect(content).not.toContain(' A');
        expect(content).toContain('B');
        expect(content).toContain('C');
    });

    it('clears panel', () => {
        const tui = new TuiRenderer();
        tui.addPanel('logs', 'Logs');
        tui.appendToPanel('logs', 'Line');
        tui.clearPanel('logs');
        const frame = tui.renderPanel('logs');
        expect(frame.every(l => !l.includes('Line'))).toBe(true);
    });

    it('sets status text', () => {
        const tui = new TuiRenderer();
        tui.setStatus('Running');
        expect(tui.status).toBe('Running');
        const bar = tui.renderStatusBar();
        expect(bar).toContain('Running');
    });

    it('registers and handles keybindings', () => {
        const tui = new TuiRenderer();
        let called = false;
        tui.registerKeybinding('q', 'Quit', () => { called = true; });
        expect(tui.handleKey('q')).toBe(true);
        expect(called).toBe(true);
    });

    it('returns false for unbound key', () => {
        const tui = new TuiRenderer();
        expect(tui.handleKey('x')).toBe(false);
    });

    it('renders full frame without crash', () => {
        const tui = new TuiRenderer({ width: 40, height: 12 });
        tui.addPanel('logs', 'Logs', 3);
        tui.addPanel('chat', 'Chat', 3);
        tui.appendToPanel('logs', 'Hello');
        tui.setStatus('Active');
        tui.registerKeybinding('q', 'Quit', () => {});
        const output = tui.render();
        expect(output).toContain('Active');
        expect(output).toContain('Hello');
        expect(output).toContain('[q]');
    });

    it('renders keybindings line', () => {
        const tui = new TuiRenderer();
        tui.registerKeybinding('s', 'Status', () => {});
        tui.registerKeybinding('m', 'Memory', () => {});
        const line = tui.renderKeybindings();
        expect(line).toContain('[s]');
        expect(line).toContain('[m]');
    });
});
