/**
 * LocalWalletProvider — viem-based Ethereum wallet management.
 *
 * Generates new wallets or loads existing ones from encrypted JSON files.
 * Private key never exposed via any public API. File permissions enforced at 0600.
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { WalletProvider, WalletAccount, EthAddress, Logger } from '@web4-agent/core';
import { WALLET_FILE_MODE } from '@web4-agent/core';

/** Internal wallet file format */
interface WalletFile {
    readonly version: 1;
    readonly address: string;
    readonly encryptedKey: string;
    readonly iv: string;
    readonly salt: string;
    readonly createdAt: string;
}

/**
 * Derives an AES-256 key from a passphrase using PBKDF2.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
}

/**
 * Encrypts a private key for storage.
 */
function encryptKey(privateKey: string, passphrase: string): { encrypted: string; iv: string; salt: string } {
    const salt = crypto.randomBytes(32);
    const key = deriveKey(passphrase, salt);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        encrypted: Buffer.concat([encrypted, tag]).toString('hex'),
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
    };
}

/**
 * Decrypts a private key from storage.
 */
function decryptKey(encrypted: string, iv: string, salt: string, passphrase: string): string {
    const key = deriveKey(passphrase, Buffer.from(salt, 'hex'));
    const data = Buffer.from(encrypted, 'hex');
    const tag = data.subarray(data.length - 16);
    const ciphertext = data.subarray(0, data.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Wraps a viem account into our WalletAccount interface.
 */
function wrapAccount(account: ReturnType<typeof privateKeyToAccount>): WalletAccount {
    return {
        address: account.address as EthAddress,
        async sign(message: string): Promise<string> {
            return account.signMessage({ message });
        },
        async signTypedData(
            domain: Record<string, unknown>,
            types: Record<string, unknown>,
            value: Record<string, unknown>,
        ): Promise<string> {
            return account.signTypedData({
                domain: domain as any,
                types: types as any,
                primaryType: (domain as any).primaryType ?? Object.keys(types).find((k) => k !== 'EIP712Domain') ?? '',
                message: value as any,
            });
        },
    };
}

/**
 * The default passphrase is the agent's home directory path.
 * In production, this should be derived from a user-supplied secret.
 */
function defaultPassphrase(walletPath: string): string {
    return `web4-agent-wallet-${path.dirname(path.resolve(walletPath))}`;
}

export class LocalWalletProvider implements WalletProvider {
    constructor(private readonly logger: Logger) { }

    /**
     * Generate a new wallet, encrypt and save to disk.
     */
    async generate(walletPath: string): Promise<WalletAccount> {
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);
        const passphrase = defaultPassphrase(walletPath);
        const { encrypted, iv, salt } = encryptKey(privateKey, passphrase);

        const walletFile: WalletFile = {
            version: 1,
            address: account.address,
            encryptedKey: encrypted,
            iv,
            salt,
            createdAt: new Date().toISOString(),
        };

        // Ensure directory exists
        const dir = path.dirname(walletPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(walletPath, JSON.stringify(walletFile, null, 2), { mode: WALLET_FILE_MODE });
        this.logger.info('Wallet generated', { address: account.address, path: walletPath });

        return wrapAccount(account);
    }

    /**
     * Load an existing wallet from disk.
     */
    async load(walletPath: string): Promise<WalletAccount> {
        if (!fs.existsSync(walletPath)) {
            throw new Error(`Wallet file not found: ${walletPath}`);
        }

        // Verify file permissions (owner-only)
        const stats = fs.statSync(walletPath);
        const mode = stats.mode & 0o777;
        if (mode !== WALLET_FILE_MODE) {
            this.logger.warn('Wallet file permissions incorrect', {
                path: walletPath,
                expected: WALLET_FILE_MODE.toString(8),
                actual: mode.toString(8),
            });
            // Fix permissions
            fs.chmodSync(walletPath, WALLET_FILE_MODE);
        }

        const raw = fs.readFileSync(walletPath, 'utf8');
        let walletFile: WalletFile;
        try {
            walletFile = JSON.parse(raw) as WalletFile;
        } catch {
            throw new Error('Wallet file is corrupted (invalid JSON)');
        }

        if (walletFile.version !== 1) {
            throw new Error(`Unsupported wallet version: ${walletFile.version}`);
        }

        const passphrase = defaultPassphrase(walletPath);
        let privateKey: string;
        try {
            privateKey = decryptKey(walletFile.encryptedKey, walletFile.iv, walletFile.salt, passphrase);
        } catch {
            throw new Error('Wallet decryption failed — file may be corrupted or moved');
        }

        const account = privateKeyToAccount(privateKey as `0x${string}`);

        // Verify address matches
        if (account.address.toLowerCase() !== walletFile.address.toLowerCase()) {
            throw new Error('Wallet address mismatch — file may be tampered');
        }

        this.logger.info('Wallet loaded', { address: account.address, path: walletPath });
        return wrapAccount(account);
    }
}
