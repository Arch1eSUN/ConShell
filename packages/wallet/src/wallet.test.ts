/**
 * Tests for @conshell/wallet
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTestLogger } from '@conshell/core';
import { LocalWalletProvider } from './local-wallet.js';

function tmpWalletPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-wallet-'));
    return path.join(dir, 'wallet.json');
}

const cleanupPaths: string[] = [];

afterEach(() => {
    for (const p of cleanupPaths) {
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
            const dir = path.dirname(p);
            if (fs.existsSync(dir)) fs.rmdirSync(dir);
        } catch { /* best effort */ }
    }
    cleanupPaths.length = 0;
});

describe('LocalWalletProvider', () => {
    it('generates a valid wallet file', async () => {
        const { logger } = createTestLogger();
        const provider = new LocalWalletProvider(logger);
        const walletPath = tmpWalletPath();
        cleanupPaths.push(walletPath);

        const account = await provider.generate(walletPath);

        // Account has a valid Ethereum address
        expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

        // File exists
        expect(fs.existsSync(walletPath)).toBe(true);

        // File content is valid JSON
        const raw = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
        expect(raw.version).toBe(1);
        expect(raw.address).toBe(account.address);
        expect(raw.encryptedKey).toBeTruthy();
        expect(raw.iv).toBeTruthy();
        expect(raw.salt).toBeTruthy();
    });

    it('loads a generated wallet and returns same address', async () => {
        const { logger } = createTestLogger();
        const provider = new LocalWalletProvider(logger);
        const walletPath = tmpWalletPath();
        cleanupPaths.push(walletPath);

        const generated = await provider.generate(walletPath);
        const loaded = await provider.load(walletPath);

        expect(loaded.address).toBe(generated.address);
    });

    it('signs messages correctly', async () => {
        const { logger } = createTestLogger();
        const provider = new LocalWalletProvider(logger);
        const walletPath = tmpWalletPath();
        cleanupPaths.push(walletPath);

        const account = await provider.generate(walletPath);
        const signature = await account.sign('test message');

        // Ethereum signature format: 0x + 130 hex chars
        expect(signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    });

    it('signs typed data', async () => {
        const { logger } = createTestLogger();
        const provider = new LocalWalletProvider(logger);
        const walletPath = tmpWalletPath();
        cleanupPaths.push(walletPath);

        const account = await provider.generate(walletPath);
        const domain = { name: 'Test', version: '1', chainId: 1 };
        const types = { Test: [{ name: 'value', type: 'string' }] };
        const value = { value: 'hello' };

        const signature = await account.signTypedData(domain, types, value);
        expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);
    });

    it('throws on missing wallet file', async () => {
        const { logger } = createTestLogger();
        const provider = new LocalWalletProvider(logger);

        await expect(provider.load('/nonexistent/wallet.json'))
            .rejects.toThrow('not found');
    });

    it('throws on corrupted wallet file', async () => {
        const { logger } = createTestLogger();
        const provider = new LocalWalletProvider(logger);
        const walletPath = tmpWalletPath();
        cleanupPaths.push(walletPath);

        fs.writeFileSync(walletPath, 'not json', { mode: 0o600 });

        await expect(provider.load(walletPath))
            .rejects.toThrow('corrupted');
    });

    it('each generate creates a unique address', async () => {
        const { logger } = createTestLogger();
        const provider = new LocalWalletProvider(logger);
        const path1 = tmpWalletPath();
        const path2 = tmpWalletPath();
        cleanupPaths.push(path1, path2);

        const a1 = await provider.generate(path1);
        const a2 = await provider.generate(path2);

        expect(a1.address).not.toBe(a2.address);
    });
});
