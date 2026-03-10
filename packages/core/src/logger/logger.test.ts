import { describe, it, expect } from 'vitest';
import { createTestLogger } from './logger.js';
import type { LogEntry } from './logger.js';

describe('StructuredLogger', () => {
    it('writes JSON log lines at or above configured level', () => {
        const { logger, lines } = createTestLogger();

        logger.debug('debug message');
        logger.info('info message');
        logger.warn('warn message');
        logger.error('error message');

        expect(lines).toHaveLength(4);
        expect(lines[0]!.level).toBe('debug');
        expect(lines[1]!.level).toBe('info');
        expect(lines[2]!.level).toBe('warn');
        expect(lines[3]!.level).toBe('error');
    });

    it('includes timestamp in ISO 8601 format', () => {
        const { logger, lines } = createTestLogger();
        logger.info('test');

        const entry = lines[0] as LogEntry;
        expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('includes extra fields', () => {
        const { logger, lines } = createTestLogger();
        logger.info('payment', { amountCents: 500, txHash: '0xabc' });

        const entry = lines[0] as LogEntry;
        expect(entry['amountCents']).toBe(500);
        expect(entry['txHash']).toBe('0xabc');
    });

    it('creates child loggers with module path', () => {
        const { logger, lines } = createTestLogger();
        const child = logger.child('policy-engine');

        child.info('rule evaluated');

        const entry = lines[0] as LogEntry;
        expect(entry.module).toBe('policy-engine');
    });

    it('creates nested child loggers with dotted module path', () => {
        const { logger, lines } = createTestLogger();
        const child = logger.child('policy-engine').child('authority');

        child.warn('denied');

        const entry = lines[0] as LogEntry;
        expect(entry.module).toBe('policy-engine.authority');
    });

    it('serializes Error objects with name, message, and stack', () => {
        const { logger, lines } = createTestLogger();
        const error = new Error('something broke');
        logger.error('failure', { error });

        const entry = lines[0] as LogEntry;
        const serializedError = entry['error'] as Record<string, unknown>;
        expect(serializedError['name']).toBe('Error');
        expect(serializedError['message']).toBe('something broke');
        expect(typeof serializedError['stack']).toBe('string');
    });
});
