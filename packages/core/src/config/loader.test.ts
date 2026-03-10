import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadConfig, validateConfig } from './loader.js';
import { ConfigNotFoundError, ConfigValidationError } from '../errors/base.js';

describe('config loader', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = join(tmpdir(), `web4-test-${randomUUID()}`);
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('throws ConfigNotFoundError when config file does not exist', () => {
        expect(() => loadConfig(testDir)).toThrow(ConfigNotFoundError);
    });

    it('loads and validates a minimal config with defaults', () => {
        const minimal = {
            name: 'test-agent',
            genesisPrompt: 'You are a test agent.',
        };
        writeFileSync(join(testDir, 'automaton.json'), JSON.stringify(minimal));

        const config = loadConfig(testDir);

        expect(config.name).toBe('test-agent');
        expect(config.genesisPrompt).toBe('You are a test agent.');
        expect(config.computeMode).toBe('docker');
        expect(config.logLevel).toBe('info');
        expect(config.treasury.maxPaymentCents).toBe(100_000);
        expect(config.treasury.minimumReserveCents).toBe(100);
        expect(config.replication.maxChildren).toBe(3);
        expect(config.selfMod.maxSelfModPerHour).toBe(10);
        expect(config.mcp.enabled).toBe(false);
        expect(config.mcp.transport).toBe('stdio');
    });

    it('deep-merges user overrides with defaults', () => {
        const partial = {
            name: 'custom-agent',
            genesisPrompt: 'Custom prompt.',
            computeMode: 'local',
            treasury: {
                maxPaymentCents: 50_000,
            },
        };
        writeFileSync(join(testDir, 'automaton.json'), JSON.stringify(partial));

        const config = loadConfig(testDir);

        expect(config.computeMode).toBe('local');
        expect(config.treasury.maxPaymentCents).toBe(50_000);
        // Default values still present
        expect(config.treasury.minimumReserveCents).toBe(100);
    });

    it('rejects invalid config with all errors', () => {
        const invalid = {
            name: '', // empty
            genesisPrompt: 123, // wrong type
        };
        writeFileSync(join(testDir, 'automaton.json'), JSON.stringify(invalid));

        expect(() => loadConfig(testDir)).toThrow(ConfigValidationError);
    });

    it('enforces integer constraint on financial fields', () => {
        const config = {
            name: 'test-agent',
            genesisPrompt: 'Test prompt',
            treasury: {
                maxPaymentCents: 100.5, // not integer
            },
        };
        writeFileSync(join(testDir, 'automaton.json'), JSON.stringify(config));

        expect(() => loadConfig(testDir)).toThrow(ConfigValidationError);
    });

    it('rejects malformed JSON', () => {
        writeFileSync(join(testDir, 'automaton.json'), 'not json{{{');

        expect(() => loadConfig(testDir)).toThrow(ConfigValidationError);
    });

    it('returns a frozen config object', () => {
        const minimal = {
            name: 'test-agent',
            genesisPrompt: 'Frozen test.',
        };
        writeFileSync(join(testDir, 'automaton.json'), JSON.stringify(minimal));

        const config = loadConfig(testDir);

        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.treasury)).toBe(true);
        expect(() => {
            // @ts-expect-error testing runtime immutability
            config.name = 'hacked';
        }).toThrow();
    });

    describe('validateConfig', () => {
        it('validates an in-memory config object', () => {
            const config = validateConfig({
                name: 'inline-agent',
                genesisPrompt: 'Inline prompt.',
            });
            expect(config.name).toBe('inline-agent');
        });

        it('rejects invalid input', () => {
            expect(() => validateConfig({})).toThrow(ConfigValidationError);
        });
    });
});
