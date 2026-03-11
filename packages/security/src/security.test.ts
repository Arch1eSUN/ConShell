/**
 * Tests for @conshell/security — vault, auth, rate-limiter, privacy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Vault Tests ─────────────────────────────────────────────────────────

describe('FileVault', () => {
    let tmpDir: string;
    let vaultPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conshell-vault-'));
        vaultPath = path.join(tmpDir, 'vault.enc');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should create a new vault and store/retrieve secrets', async () => {
        const { FileVault } = await import('./vault.js');
        const vault = new FileVault(vaultPath, 'test-password');

        vault.setSecret('openai_api_key', 'sk-test-123456');
        vault.setSecret('anthropic_api_key', 'sk-ant-test-789');

        expect(vault.size).toBe(2);
        expect(vault.getSecret('openai_api_key')).toBe('sk-test-123456');
        expect(vault.getSecret('anthropic_api_key')).toBe('sk-ant-test-789');
        expect(vault.getSecret('nonexistent')).toBeUndefined();
    });

    it('should list keys without exposing values', async () => {
        const { FileVault } = await import('./vault.js');
        const vault = new FileVault(vaultPath, 'test-password');

        vault.setSecret('key_a', 'value_a');
        vault.setSecret('key_b', 'value_b');

        const keys = vault.listKeys();
        expect(keys).toEqual(['key_a', 'key_b']);
    });

    it('should delete secrets', async () => {
        const { FileVault } = await import('./vault.js');
        const vault = new FileVault(vaultPath, 'test-password');

        vault.setSecret('to_delete', 'temp-value');
        expect(vault.deleteSecret('to_delete')).toBe(true);
        expect(vault.getSecret('to_delete')).toBeUndefined();
        expect(vault.deleteSecret('nonexistent')).toBe(false);
    });

    it('should persist and reload from disk', async () => {
        const { FileVault } = await import('./vault.js');

        // Write
        const vault1 = new FileVault(vaultPath, 'persist-test');
        vault1.setSecret('persist_key', 'persist_value');

        // Reload
        const vault2 = new FileVault(vaultPath, 'persist-test');
        expect(vault2.getSecret('persist_key')).toBe('persist_value');
    });

    it('should fail decryption with wrong password', async () => {
        const { FileVault } = await import('./vault.js');

        const vault1 = new FileVault(vaultPath, 'correct-password');
        vault1.setSecret('secret', 'hidden-value');

        const vault2 = new FileVault(vaultPath, 'wrong-password');
        expect(vault2.getSecret('secret')).toBeUndefined();
    });

    it('should rotate password', async () => {
        const { FileVault } = await import('./vault.js');

        const vault = new FileVault(vaultPath, 'old-pass');
        vault.setSecret('api_key', 'sk-12345');

        vault.rotatePassword('old-pass', 'new-pass');

        // Reload with new password
        const reloaded = new FileVault(vaultPath, 'new-pass');
        expect(reloaded.getSecret('api_key')).toBe('sk-12345');
    });

    it('should normalize key names to lowercase', async () => {
        const { FileVault } = await import('./vault.js');
        const vault = new FileVault(vaultPath, 'test');

        vault.setSecret('OPENAI_API_KEY', 'test-val');
        expect(vault.getSecret('openai_api_key')).toBe('test-val');
    });
});

// ── Auth Tests ──────────────────────────────────────────────────────────

describe('Auth', () => {
    it('should pass through in "none" mode', async () => {
        const { createAuthMiddleware } = await import('./auth.js');
        const mw = createAuthMiddleware({ mode: 'none' });

        let nextCalled = false;
        const req = { headers: {}, path: '/api/chat' } as any;
        const res = {} as any;
        mw(req, res, () => { nextCalled = true; });

        expect(nextCalled).toBe(true);
    });

    it('should reject requests without token in "token" mode', async () => {
        const { createAuthMiddleware, generateToken } = await import('./auth.js');
        const secret = generateToken();
        const mw = createAuthMiddleware({ mode: 'token', secret });

        let statusCode = 0;
        let responseBody: any = {};
        const req = { headers: {}, path: '/api/chat' } as any;
        const res = {
            status: (code: number) => { statusCode = code; return res; },
            json: (body: any) => { responseBody = body; },
        } as any;

        mw(req, res, () => {});

        expect(statusCode).toBe(401);
        expect(responseBody.error).toBe('Unauthorized');
    });

    it('should accept valid Bearer token', async () => {
        const { createAuthMiddleware, generateToken } = await import('./auth.js');
        const secret = generateToken();
        const mw = createAuthMiddleware({ mode: 'token', secret });

        let nextCalled = false;
        const req = { headers: { authorization: `Bearer ${secret}` }, path: '/api/chat' } as any;
        const res = {} as any;
        mw(req, res, () => { nextCalled = true; });

        expect(nextCalled).toBe(true);
    });

    it('should skip auth for health endpoints', async () => {
        const { createAuthMiddleware } = await import('./auth.js');
        const mw = createAuthMiddleware({ mode: 'token', secret: 'some-secret' });

        let nextCalled = false;
        const req = { headers: {}, path: '/api/health' } as any;
        const res = {} as any;
        mw(req, res, () => { nextCalled = true; });

        expect(nextCalled).toBe(true);
    });

    it('should verify WebSocket auth', async () => {
        const { verifyAuth, generateToken } = await import('./auth.js');
        const secret = generateToken();

        expect(verifyAuth({ mode: 'none' }, undefined).authenticated).toBe(true);
        expect(verifyAuth({ mode: 'token', secret }, secret).authenticated).toBe(true);
        expect(verifyAuth({ mode: 'token', secret }, 'wrong').authenticated).toBe(false);
        expect(verifyAuth({ mode: 'token', secret }, undefined).authenticated).toBe(false);
    });
});

// ── Rate Limiter Tests ──────────────────────────────────────────────────

describe('RateLimiter', () => {
    it('should allow requests within limit', async () => {
        const { RateLimiter } = await import('./rate-limiter.js');
        const limiter = new RateLimiter(5, 60_000);

        for (let i = 0; i < 5; i++) {
            const result = limiter.check('test-ip');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4 - i);
        }

        limiter.destroy();
    });

    it('should block requests exceeding limit', async () => {
        const { RateLimiter } = await import('./rate-limiter.js');
        const limiter = new RateLimiter(3, 60_000);

        limiter.check('test-ip');
        limiter.check('test-ip');
        limiter.check('test-ip');

        const result = limiter.check('test-ip');
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);

        limiter.destroy();
    });

    it('should track IPs independently', async () => {
        const { RateLimiter } = await import('./rate-limiter.js');
        const limiter = new RateLimiter(2, 60_000);

        limiter.check('ip-a');
        limiter.check('ip-a');
        const resultA = limiter.check('ip-a');
        const resultB = limiter.check('ip-b');

        expect(resultA.allowed).toBe(false);
        expect(resultB.allowed).toBe(true);

        limiter.destroy();
    });
});

// ── Privacy Tests ───────────────────────────────────────────────────────

describe('Privacy', () => {
    it('should detect email addresses', async () => {
        const { detectPII } = await import('./privacy.js');
        const matches = detectPII('Contact john@example.com for info');
        expect(matches).toHaveLength(1);
        expect(matches[0]!.type).toBe('email');
        expect(matches[0]!.value).toBe('john@example.com');
    });

    it('should detect API keys', async () => {
        const { detectPII } = await import('./privacy.js');
        const matches = detectPII('Use key sk-abc123def456ghijklmnopqrst');
        expect(matches).toHaveLength(1);
        expect(matches[0]!.type).toBe('api_key');
    });

    it('should detect credit card numbers', async () => {
        const { detectPII } = await import('./privacy.js');
        const matches = detectPII('Card: 4111-1111-1111-1111');
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(matches.some(m => m.type === 'credit_card')).toBe(true);
    });

    it('should detect Ethereum private keys', async () => {
        const { detectPII } = await import('./privacy.js');
        const matches = detectPII('Key: 0x' + 'a'.repeat(64));
        expect(matches).toHaveLength(1);
        expect(matches[0]!.type).toBe('eth_private_key');
    });

    it('should redact PII with type-specific placeholders', async () => {
        const { redactPII } = await import('./privacy.js');
        const result = redactPII('Email john@test.com and key sk-abc123def456ghijklmnopqrst');
        expect(result).toContain('[EMAIL]');
        expect(result).toContain('[API_KEY]');
        expect(result).not.toContain('john@test.com');
    });

    it('should check for PII existence', async () => {
        const { hasPII } = await import('./privacy.js');
        expect(hasPII('Hello world')).toBe(false);
        expect(hasPII('Contact me at alice@example.org')).toBe(true);
    });

    it('should produce audit reports', async () => {
        const { auditPII } = await import('./privacy.js');
        const report = auditPII([
            'Email: bob@test.com',
            'Phone: +1-555-123-4567',
            'No PII here',
        ]);
        expect(report.totalPIIFound).toBe(2);
        expect(report.byType['email']).toBe(1);
        expect(report.byType['phone']).toBe(1);
    });
});
