/**
 * Agent State Machine — Complete lifecycle management.
 *
 * States: setup → waking → running → sleeping → dead
 * Sub-states: low_compute, critical, recovering (overlay on running)
 *
 * Features:
 * - Valid transition enforcement
 * - Typed transition events with listeners
 * - State entry/exit hooks
 * - Transition history log
 * - Automatic timeouts (optional)
 * - SubState overlay for resource conditions
 */

export type AgentState = 'setup' | 'waking' | 'running' | 'sleeping' | 'dead';
export type SubState = 'normal' | 'low_compute' | 'critical' | 'recovering';

export interface StateTransition {
    readonly from: AgentState;
    readonly to: AgentState;
    readonly reason?: string;
    readonly timestamp: number;
}

export interface StateMachineSnapshot {
    readonly state: AgentState;
    readonly subState: SubState;
    readonly enteredAt: number;
    readonly transitionCount: number;
    readonly history: readonly StateTransition[];
    readonly uptimeMs: number;
}

// ── Valid Transitions ────────────────────────────────────────────────────

const VALID_TRANSITIONS: ReadonlyMap<AgentState, readonly AgentState[]> = new Map([
    ['setup', ['waking', 'dead']],
    ['waking', ['running', 'sleeping', 'dead']],
    ['running', ['sleeping', 'dead']],
    ['sleeping', ['waking', 'dead']],
    ['dead', []], // terminal
]);

// ── Listeners ───────────────────────────────────────────────────────────

export type TransitionListener = (transition: StateTransition) => void;
export type SubStateListener = (from: SubState, to: SubState) => void;
export type StateEntryHook = (state: AgentState) => void | Promise<void>;
export type StateExitHook = (state: AgentState) => void | Promise<void>;

// ── AgentStateMachine ───────────────────────────────────────────────────

export class AgentStateMachine {
    private _state: AgentState;
    private _subState: SubState = 'normal';
    private _enteredAt: number;
    private _startedAt: number;

    private readonly _history: StateTransition[] = [];
    private readonly _maxHistory: number;

    private readonly _transitionListeners: TransitionListener[] = [];
    private readonly _subStateListeners: SubStateListener[] = [];
    private readonly _entryHooks: Map<AgentState, StateEntryHook[]> = new Map();
    private readonly _exitHooks: Map<AgentState, StateExitHook[]> = new Map();

    constructor(initial: AgentState = 'setup', maxHistory = 100) {
        this._state = initial;
        this._enteredAt = Date.now();
        this._startedAt = Date.now();
        this._maxHistory = maxHistory;
    }

    // ── Getters ──────────────────────────────────────────────────────────

    get state(): AgentState {
        return this._state;
    }

    get subState(): SubState {
        return this._subState;
    }

    get enteredAt(): number {
        return this._enteredAt;
    }

    get stateAge(): number {
        return Date.now() - this._enteredAt;
    }

    get uptimeMs(): number {
        return Date.now() - this._startedAt;
    }

    get transitionCount(): number {
        return this._history.length;
    }

    get isAlive(): boolean {
        return this._state !== 'dead';
    }

    get isActive(): boolean {
        return this._state === 'running' || this._state === 'waking';
    }

    get isDegraded(): boolean {
        return this._subState === 'low_compute' || this._subState === 'critical';
    }

    // ── Snapshot ──────────────────────────────────────────────────────────

    snapshot(): StateMachineSnapshot {
        return {
            state: this._state,
            subState: this._subState,
            enteredAt: this._enteredAt,
            transitionCount: this._history.length,
            history: [...this._history],
            uptimeMs: this.uptimeMs,
        };
    }

    // ── Transition ───────────────────────────────────────────────────────

    canTransition(to: AgentState): boolean {
        const allowed = VALID_TRANSITIONS.get(this._state);
        return allowed?.includes(to) ?? false;
    }

    async transition(to: AgentState, reason?: string): Promise<void> {
        if (!this.canTransition(to)) {
            throw new Error(
                `Invalid state transition: ${this._state} → ${to}` +
                (reason ? ` (reason: ${reason})` : ''),
            );
        }

        const from = this._state;
        const transition: StateTransition = {
            from,
            to,
            reason,
            timestamp: Date.now(),
        };

        // Exit hooks
        const exitHooks = this._exitHooks.get(from) ?? [];
        for (const hook of exitHooks) {
            await hook(from);
        }

        // Switch state
        this._state = to;
        this._enteredAt = Date.now();

        // Record history
        this._history.push(transition);
        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }

        // Entry hooks
        const entryHooks = this._entryHooks.get(to) ?? [];
        for (const hook of entryHooks) {
            await hook(to);
        }

        // Notify listeners
        for (const fn of this._transitionListeners) {
            fn(transition);
        }

        // Reset sub-state on major transition
        if (from !== to) {
            this.setSubState('normal');
        }
    }

    /**
     * Synchronous transition — for backward compatibility.
     */
    transitionSync(to: AgentState, reason?: string): void {
        if (!this.canTransition(to)) {
            throw new Error(
                `Invalid state transition: ${this._state} → ${to}`,
            );
        }

        const from = this._state;
        const t: StateTransition = { from, to, reason, timestamp: Date.now() };

        this._state = to;
        this._enteredAt = Date.now();
        this._history.push(t);
        if (this._history.length > this._maxHistory) this._history.shift();

        for (const fn of this._transitionListeners) fn(t);
        if (from !== to) this.setSubState('normal');
    }

    // ── Sub-State ────────────────────────────────────────────────────────

    setSubState(sub: SubState): void {
        if (this._subState === sub) return;
        const from = this._subState;
        this._subState = sub;
        for (const fn of this._subStateListeners) {
            fn(from, sub);
        }
    }

    // ── Event registration ───────────────────────────────────────────────

    onTransition(fn: TransitionListener): () => void {
        this._transitionListeners.push(fn);
        return () => {
            const idx = this._transitionListeners.indexOf(fn);
            if (idx >= 0) this._transitionListeners.splice(idx, 1);
        };
    }

    onSubStateChange(fn: SubStateListener): () => void {
        this._subStateListeners.push(fn);
        return () => {
            const idx = this._subStateListeners.indexOf(fn);
            if (idx >= 0) this._subStateListeners.splice(idx, 1);
        };
    }

    onEntry(state: AgentState, hook: StateEntryHook): void {
        const hooks = this._entryHooks.get(state) ?? [];
        hooks.push(hook);
        this._entryHooks.set(state, hooks);
    }

    onExit(state: AgentState, hook: StateExitHook): void {
        const hooks = this._exitHooks.get(state) ?? [];
        hooks.push(hook);
        this._exitHooks.set(state, hooks);
    }

    // ── History queries ──────────────────────────────────────────────────

    getHistory(limit?: number): readonly StateTransition[] {
        const n = limit ?? this._history.length;
        return this._history.slice(-n);
    }

    getLastTransition(): StateTransition | undefined {
        return this._history[this._history.length - 1];
    }

    timeInState(state: AgentState): number {
        let total = 0;
        for (let i = 0; i < this._history.length - 1; i++) {
            const t = this._history[i]!;
            const next = this._history[i + 1]!;
            if (t.to === state) {
                total += next.timestamp - t.timestamp;
            }
        }
        // Add current state time if applicable
        if (this._state === state) {
            total += Date.now() - this._enteredAt;
        }
        return total;
    }
}
