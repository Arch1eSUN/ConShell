/**
 * Agent State Machine — lifecycle states and valid transitions.
 *
 * States: setup → waking → running → sleeping → dead
 */

export type AgentState = 'setup' | 'waking' | 'running' | 'sleeping' | 'dead';

const VALID_TRANSITIONS: ReadonlyMap<AgentState, readonly AgentState[]> = new Map([
    ['setup', ['waking', 'dead']],
    ['waking', ['running', 'sleeping', 'dead']],
    ['running', ['sleeping', 'dead']],
    ['sleeping', ['waking', 'dead']],
    ['dead', []], // terminal
]);

export class AgentStateMachine {
    private _state: AgentState;
    private readonly listeners: Array<(from: AgentState, to: AgentState) => void> = [];

    constructor(initial: AgentState = 'setup') {
        this._state = initial;
    }

    get state(): AgentState {
        return this._state;
    }

    canTransition(to: AgentState): boolean {
        const allowed = VALID_TRANSITIONS.get(this._state);
        return allowed?.includes(to) ?? false;
    }

    transition(to: AgentState): void {
        if (!this.canTransition(to)) {
            throw new Error(
                `Invalid state transition: ${this._state} → ${to}`,
            );
        }
        const from = this._state;
        this._state = to;
        for (const fn of this.listeners) {
            fn(from, to);
        }
    }

    onTransition(fn: (from: AgentState, to: AgentState) => void): void {
        this.listeners.push(fn);
    }
}
