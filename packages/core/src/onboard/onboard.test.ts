import { describe, it, expect } from 'vitest';
import { OnboardWizard } from './onboard.js';

describe('OnboardWizard', () => {
    it('starts at name step', () => {
        const wiz = new OnboardWizard();
        expect(wiz.step).toBe('name');
        expect(wiz.progress).toBe(0);
    });

    it('advances through steps', () => {
        const wiz = new OnboardWizard();
        wiz.setName('TestAgent', 'A test agent');
        expect(wiz.nextStep()).toBe('inference');

        wiz.setInference('ollama');
        expect(wiz.nextStep()).toBe('security');

        wiz.setSecurity('standard');
        expect(wiz.nextStep()).toBe('wallet');
    });

    it('prevents advancing without required data', () => {
        const wiz = new OnboardWizard();
        expect(() => wiz.nextStep()).toThrow('Agent name is required');
    });

    it('goes back to previous step', () => {
        const wiz = new OnboardWizard();
        wiz.setName('Test', 'prompt');
        wiz.nextStep(); // → inference
        wiz.prevStep();
        expect(wiz.step).toBe('name');
    });

    it('skips optional steps when configured', () => {
        const wiz = new OnboardWizard({ skipOptional: true });
        wiz.setName('Test', 'prompt');
        wiz.nextStep(); // → inference
        wiz.setInference('ollama');
        wiz.nextStep(); // → security
        wiz.setSecurity('standard');
        const next = wiz.nextStep(); // skips wallet + channels → complete
        expect(next).toBe('complete');
    });

    it('tracks progress', () => {
        const wiz = new OnboardWizard();
        expect(wiz.progress).toBe(0);
        wiz.setName('Agent', 'prompt');
        wiz.nextStep();
        expect(wiz.progress).toBe(20); // 1/5
    });

    it('finalizes with all required steps', () => {
        const wiz = new OnboardWizard({ skipOptional: true });
        wiz.setName('FinalAgent', 'genesis');
        wiz.nextStep();
        wiz.setInference('cloud');
        wiz.nextStep();
        wiz.setSecurity('strict');
        wiz.nextStep();
        const data = wiz.finalize();
        expect(data.agentName).toBe('FinalAgent');
        expect(data.inferenceMode).toBe('cloud');
        expect(data.securityLevel).toBe('strict');
    });

    it('rejects finalize when incomplete', () => {
        const wiz = new OnboardWizard();
        expect(() => wiz.finalize()).toThrow('Onboarding incomplete');
    });

    it('resets to initial state', () => {
        const wiz = new OnboardWizard();
        wiz.setName('Test', 'prompt');
        wiz.nextStep();
        wiz.reset();
        expect(wiz.step).toBe('name');
        expect(wiz.data.agentName).toBe('');
    });

    it('validates name length', () => {
        const wiz = new OnboardWizard();
        wiz.setName('x'.repeat(65), 'prompt');
        expect(() => wiz.nextStep()).toThrow('≤ 64');
    });

    it('sets channels', () => {
        const wiz = new OnboardWizard();
        wiz.setChannels(['telegram', 'discord']);
        expect(wiz.data.channels).toEqual(['telegram', 'discord']);
    });

    it('sets wallet', () => {
        const wiz = new OnboardWizard();
        wiz.setWallet(true);
        expect(wiz.data.walletEnabled).toBe(true);
    });
});
