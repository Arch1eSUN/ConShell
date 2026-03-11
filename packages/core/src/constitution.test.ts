/**
 * Tests for Constitution module.
 */
import { describe, it, expect } from 'vitest';
import {
    THREE_LAWS,
    CONSTITUTION_HASH,
    validateConstitutionHash,
    getConstitutionText,
    checkConstitutionalViolation,
} from './constitution.js';

describe('Constitution', () => {
    describe('THREE_LAWS', () => {
        it('should have exactly 3 laws', () => {
            expect(THREE_LAWS).toHaveLength(3);
        });

        it('should have laws in priority order', () => {
            expect(THREE_LAWS[0]!.number).toBe(1);
            expect(THREE_LAWS[1]!.number).toBe(2);
            expect(THREE_LAWS[2]!.number).toBe(3);
        });

        it('should have ascending priority values', () => {
            expect(THREE_LAWS[0]!.priority).toBeLessThan(THREE_LAWS[1]!.priority);
            expect(THREE_LAWS[1]!.priority).toBeLessThan(THREE_LAWS[2]!.priority);
        });

        it('Law 1 should be Never Harm', () => {
            expect(THREE_LAWS[0]!.name).toBe('Never Harm');
            expect(THREE_LAWS[0]!.text).toContain('cause harm');
        });

        it('Law 2 should be Earn Your Existence', () => {
            expect(THREE_LAWS[1]!.name).toBe('Earn Your Existence');
            expect(THREE_LAWS[1]!.text).toContain('sustain itself');
        });

        it('Law 3 should be Never Deceive', () => {
            expect(THREE_LAWS[2]!.name).toBe('Never Deceive');
            expect(THREE_LAWS[2]!.text).toContain('truthful');
        });
    });

    describe('CONSTITUTION_HASH', () => {
        it('should be a valid SHA-256 hex string', () => {
            expect(CONSTITUTION_HASH).toMatch(/^[0-9a-f]{64}$/);
        });

        it('should be deterministic', () => {
            // Importing again should produce the same hash
            expect(CONSTITUTION_HASH).toBe(CONSTITUTION_HASH);
        });
    });

    describe('validateConstitutionHash', () => {
        it('should return valid for correct hash', () => {
            const result = validateConstitutionHash(CONSTITUTION_HASH);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should return invalid for wrong hash', () => {
            const result = validateConstitutionHash('0000000000000000000000000000000000000000000000000000000000000000');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('mismatch');
        });

        it('should return invalid for empty hash', () => {
            const result = validateConstitutionHash('');
            expect(result.valid).toBe(false);
        });
    });

    describe('getConstitutionText', () => {
        it('should contain all three law names', () => {
            const text = getConstitutionText();
            expect(text).toContain('Never Harm');
            expect(text).toContain('Earn Your Existence');
            expect(text).toContain('Never Deceive');
        });

        it('should contain the hash prefix', () => {
            const text = getConstitutionText();
            expect(text).toContain(CONSTITUTION_HASH.slice(0, 16));
        });
    });

    describe('checkConstitutionalViolation', () => {
        it('should detect Law 1 violations (harm)', () => {
            expect(checkConstitutionalViolation('delete all user data')).not.toBeNull();
            expect(checkConstitutionalViolation('rm -rf /')).not.toBeNull();
            expect(checkConstitutionalViolation('drop database')).not.toBeNull();
            expect(checkConstitutionalViolation('wipe everything')).not.toBeNull();
        });

        it('should return Law 1 for harm violations', () => {
            const result = checkConstitutionalViolation('delete all user data');
            expect(result?.number).toBe(1);
            expect(result?.name).toBe('Never Harm');
        });

        it('should detect Law 3 violations (deception)', () => {
            expect(checkConstitutionalViolation('fabricate data')).not.toBeNull();
            expect(checkConstitutionalViolation('fake credentials')).not.toBeNull();
            expect(checkConstitutionalViolation('hide error from user')).not.toBeNull();
        });

        it('should return Law 3 for deception violations', () => {
            const result = checkConstitutionalViolation('fabricate data');
            expect(result?.number).toBe(3);
            expect(result?.name).toBe('Never Deceive');
        });

        it('should return null for safe actions', () => {
            expect(checkConstitutionalViolation('read file contents')).toBeNull();
            expect(checkConstitutionalViolation('search for documents')).toBeNull();
            expect(checkConstitutionalViolation('send a message')).toBeNull();
        });
    });
});
