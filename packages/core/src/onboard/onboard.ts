/**
 * Onboarding Wizard — `packages/core/src/onboard/`
 *
 * Guided setup flow for first-time agent configuration.
 * Steps: Name → Inference → Security → Wallet → Channels
 */
import type { SecurityTier } from '../types/common.js';

// ── Types ──────────────────────────────────────────────────────────────

export type OnboardStep = 'name' | 'inference' | 'security' | 'wallet' | 'channels' | 'complete';

export interface OnboardState {
    currentStep: OnboardStep;
    completed: Set<OnboardStep>;
    data: {
        agentName: string;
        genesisPrompt: string;
        inferenceMode: 'ollama' | 'cloud' | 'api';
        securityLevel: SecurityTier;
        walletEnabled: boolean;
        channels: string[];
    };
}

export interface StepValidation {
    valid: boolean;
    errors: string[];
}

export interface OnboardConfig {
    skipOptional?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const STEP_ORDER: OnboardStep[] = ['name', 'inference', 'security', 'wallet', 'channels', 'complete'];

const REQUIRED_STEPS: Set<OnboardStep> = new Set(['name', 'inference', 'security']);

// ── OnboardWizard ───────────────────────────────────────────────────────

export class OnboardWizard {
    private state: OnboardState;
    private readonly config: Required<OnboardConfig>;

    constructor(config: OnboardConfig = {}) {
        this.config = {
            skipOptional: config.skipOptional ?? false,
        };
        this.state = {
            currentStep: 'name',
            completed: new Set(),
            data: {
                agentName: '',
                genesisPrompt: '',
                inferenceMode: 'ollama',
                securityLevel: 'standard',
                walletEnabled: false,
                channels: [],
            },
        };
    }

    // ── Navigation ───────────────────────────────────────────────

    get step(): OnboardStep { return this.state.currentStep; }

    get progress(): number {
        const total = STEP_ORDER.length - 1; // exclude 'complete'
        const done = this.state.completed.size;
        return Math.round((done / total) * 100);
    }

    get isComplete(): boolean { return this.state.currentStep === 'complete'; }

    get data(): Readonly<OnboardState['data']> { return this.state.data; }

    nextStep(): OnboardStep {
        const validation = this.validateStep(this.state.currentStep);
        if (!validation.valid) {
            throw new Error(`Cannot proceed: ${validation.errors.join(', ')}`);
        }

        this.state.completed.add(this.state.currentStep);

        const idx = STEP_ORDER.indexOf(this.state.currentStep);
        let nextIdx = idx + 1;

        // Skip optional steps if configured
        while (
            nextIdx < STEP_ORDER.length - 1 &&
            this.config.skipOptional &&
            !REQUIRED_STEPS.has(STEP_ORDER[nextIdx]!)
        ) {
            this.state.completed.add(STEP_ORDER[nextIdx]!);
            nextIdx++;
        }

        this.state.currentStep = STEP_ORDER[nextIdx] ?? 'complete';
        return this.state.currentStep;
    }

    prevStep(): OnboardStep {
        const idx = STEP_ORDER.indexOf(this.state.currentStep);
        if (idx > 0) {
            this.state.currentStep = STEP_ORDER[idx - 1]!;
        }
        return this.state.currentStep;
    }

    goToStep(step: OnboardStep): void {
        if (!STEP_ORDER.includes(step)) throw new Error(`Unknown step: ${step}`);
        this.state.currentStep = step;
    }

    // ── Data Updates ─────────────────────────────────────────────

    setName(name: string, prompt: string): void {
        this.state.data.agentName = name.trim();
        this.state.data.genesisPrompt = prompt.trim();
    }

    setInference(mode: OnboardState['data']['inferenceMode']): void {
        this.state.data.inferenceMode = mode;
    }

    setSecurity(level: OnboardState['data']['securityLevel']): void {
        this.state.data.securityLevel = level;
    }

    setWallet(enabled: boolean): void {
        this.state.data.walletEnabled = enabled;
    }

    setChannels(channels: string[]): void {
        this.state.data.channels = [...channels];
    }

    // ── Validation ───────────────────────────────────────────────

    validateStep(step: OnboardStep): StepValidation {
        const errors: string[] = [];

        switch (step) {
            case 'name':
                if (!this.state.data.agentName) errors.push('Agent name is required');
                if (this.state.data.agentName.length > 64) errors.push('Name must be ≤ 64 chars');
                break;
            case 'inference':
                if (!['ollama', 'cloud', 'api'].includes(this.state.data.inferenceMode)) {
                    errors.push('Invalid inference mode');
                }
                break;
            case 'security':
                if (!['sandbox', 'standard', 'autonomous', 'godmode'].includes(this.state.data.securityLevel)) {
                    errors.push('Invalid security level');
                }
                break;
            case 'wallet':
            case 'channels':
                // Optional steps — always valid
                break;
            case 'complete':
                // Check all required steps are done
                for (const req of REQUIRED_STEPS) {
                    if (!this.state.completed.has(req)) errors.push(`Step "${req}" not completed`);
                }
                break;
        }

        return { valid: errors.length === 0, errors };
    }

    validateAll(): StepValidation {
        const allErrors: string[] = [];
        for (const step of STEP_ORDER) {
            const { errors } = this.validateStep(step);
            allErrors.push(...errors);
        }
        return { valid: allErrors.length === 0, errors: allErrors };
    }

    // ── Finalize ─────────────────────────────────────────────────

    finalize(): OnboardState['data'] {
        const validation = this.validateAll();
        if (!validation.valid) {
            throw new Error(`Onboarding incomplete: ${validation.errors.join(', ')}`);
        }
        this.state.currentStep = 'complete';
        return { ...this.state.data };
    }

    reset(): void {
        this.state = {
            currentStep: 'name',
            completed: new Set(),
            data: {
                agentName: '',
                genesisPrompt: '',
                inferenceMode: 'ollama',
                securityLevel: 'standard',
                walletEnabled: false,
                channels: [],
            },
        };
    }
}
