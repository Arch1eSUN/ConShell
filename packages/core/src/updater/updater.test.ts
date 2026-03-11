import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SelfUpdater, parseSemver } from './updater.js';

describe('SelfUpdater', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('detects available update', () => {
        const updater = new SelfUpdater('0.1.0');
        const info = updater.checkForUpdate('0.2.0');
        expect(info.hasUpdate).toBe(true);
        expect(info.current).toBe('0.1.0');
        expect(info.latest).toBe('0.2.0');
    });

    it('detects no update needed', () => {
        const updater = new SelfUpdater('1.0.0');
        const info = updater.checkForUpdate('1.0.0');
        expect(info.hasUpdate).toBe(false);
    });

    it('starts an update', () => {
        const updater = new SelfUpdater('0.1.0');
        const record = updater.startUpdate('0.2.0');
        expect(record.status).toBe('downloading');
        expect(record.fromVersion).toBe('0.1.0');
        expect(record.toVersion).toBe('0.2.0');
    });

    it('rejects downgrade', () => {
        const updater = new SelfUpdater('1.0.0');
        expect(() => updater.startUpdate('0.9.0')).toThrow('not newer');
    });

    it('completes update successfully', () => {
        const updater = new SelfUpdater('0.1.0');
        const record = updater.startUpdate('0.2.0');
        const completed = updater.completeUpdate(record.id, true);
        expect(completed.status).toBe('done');
        expect(updater.version).toBe('0.2.0');
    });

    it('handles failed update', () => {
        const updater = new SelfUpdater('0.1.0');
        const record = updater.startUpdate('0.2.0');
        const failed = updater.completeUpdate(record.id, false, 'Verification failed');
        expect(failed.status).toBe('failed');
        expect(failed.error).toBe('Verification failed');
        expect(updater.version).toBe('0.1.0'); // not changed
    });

    it('rollback reverts', () => {
        const updater = new SelfUpdater('0.1.0');
        const record = updater.startUpdate('0.2.0');
        const rolled = updater.rollback(record.id);
        expect(rolled.status).toBe('failed');
        expect(updater.version).toBe('0.1.0');
    });

    it('tracks history', () => {
        const updater = new SelfUpdater('0.1.0');
        updater.startUpdate('0.2.0');
        vi.advanceTimersByTime(1000);
        updater.startUpdate('0.3.0');
        expect(updater.historyCount).toBe(2);
    });

    it('evicts old history', () => {
        const updater = new SelfUpdater('0.1.0', { maxHistory: 2 });
        updater.startUpdate('0.2.0');
        vi.advanceTimersByTime(1000);
        updater.startUpdate('0.3.0');
        vi.advanceTimersByTime(1000);
        updater.startUpdate('0.4.0');
        expect(updater.historyCount).toBe(2);
    });
});

describe('parseSemver', () => {
    it('parses standard version', () => {
        expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('strips v prefix', () => {
        expect(parseSemver('v0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
    });
});
