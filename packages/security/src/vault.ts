/**
 * Encrypted Config Vault — AES-256-GCM storage for sensitive values.
 *
 * Reuses the same crypto primitives as @conshell/wallet (PBKDF2 + AES-256-GCM).
 * Each secret gets its own IV and salt for maximum isolation.
 *
 * Storage format: ~/.conshell/vault.enc (JSON, 0600 permissions)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** File permission: owner read/write only (0600). */
const VAULT_FILE_MODE = 0o600;

// ── Constants ───────────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const DIGEST = 'sha256';
const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_LENGTH = 16;

// ── Types ───────────────────────────────────────────────────────────────

interface EncryptedEntry {
    readonly ciphertext: string; // hex
    readonly iv: string;        // hex
    readonly salt: string;      // hex
}

interface VaultFile {
    readonly version: 1;
    readonly entries: Record<string, EncryptedEntry>;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface SecureVault {
    /** Store a secret (encrypts automatically). */
    setSecret(key: string, value: string): void;
    /** Retrieve a secret (decrypts on demand). Returns undefined if not found. */
    getSecret(key: string): string | undefined;
    /** List all stored keys (values not exposed). */
    listKeys(): string[];
    /** Delete a secret. Returns true if it existed. */
    deleteSecret(key: string): boolean;
    /** Change the master password (re-encrypts all entries). */
    rotatePassword(oldPassword: string, newPassword: string): void;
    /** Number of stored secrets. */
    readonly size: number;
    /** Whether the vault file exists on disk. */
    readonly exists: boolean;
}

// ── Crypto helpers ──────────────────────────────────────────────────────

function deriveKey(passphrase: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST);
}

function encrypt(plaintext: string, passphrase: string): EncryptedEntry {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = deriveKey(passphrase, salt);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        ciphertext: Buffer.concat([encrypted, tag]).toString('hex'),
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
    };
}

function decrypt(entry: EncryptedEntry, passphrase: string): string {
    const key = deriveKey(passphrase, Buffer.from(entry.salt, 'hex'));
    const data = Buffer.from(entry.ciphertext, 'hex');
    const tag = data.subarray(data.length - AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(0, data.length - AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(entry.iv, 'hex'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ── Vault Implementation ────────────────────────────────────────────────

export class FileVault implements SecureVault {
    private data: VaultFile;
    private dirty = false;

    constructor(
        private readonly filePath: string,
        private masterPassword: string,
    ) {
        this.data = this.loadOrCreate();
    }

    get size(): number {
        return Object.keys(this.data.entries).length;
    }

    get exists(): boolean {
        return fs.existsSync(this.filePath);
    }

    setSecret(key: string, value: string): void {
        const normalized = key.toLowerCase().trim();
        this.data = {
            ...this.data,
            entries: {
                ...this.data.entries,
                [normalized]: encrypt(value, this.masterPassword),
            },
            updatedAt: new Date().toISOString(),
        };
        this.dirty = true;
        this.save();
    }

    getSecret(key: string): string | undefined {
        const normalized = key.toLowerCase().trim();
        const entry = this.data.entries[normalized];
        if (!entry) return undefined;
        try {
            return decrypt(entry, this.masterPassword);
        } catch {
            return undefined; // Decryption failed (wrong password or corrupted)
        }
    }

    listKeys(): string[] {
        return Object.keys(this.data.entries).sort();
    }

    deleteSecret(key: string): boolean {
        const normalized = key.toLowerCase().trim();
        if (!(normalized in this.data.entries)) return false;
        const { [normalized]: _, ...rest } = this.data.entries;
        this.data = {
            ...this.data,
            entries: rest,
            updatedAt: new Date().toISOString(),
        };
        this.dirty = true;
        this.save();
        return true;
    }

    rotatePassword(oldPassword: string, newPassword: string): void {
        // Verify old password by trying to decrypt first entry
        const keys = this.listKeys();
        if (keys.length > 0) {
            const testEntry = this.data.entries[keys[0]!]!;
            try {
                decrypt(testEntry, oldPassword);
            } catch {
                throw new Error('Old password is incorrect');
            }
        }

        // Re-encrypt all entries with new password
        const newEntries: Record<string, EncryptedEntry> = {};
        for (const [k, entry] of Object.entries(this.data.entries)) {
            const plaintext = decrypt(entry, oldPassword);
            newEntries[k] = encrypt(plaintext, newPassword);
        }

        this.data = {
            ...this.data,
            entries: newEntries,
            updatedAt: new Date().toISOString(),
        };
        this.masterPassword = newPassword;
        this.dirty = true;
        this.save();
    }

    // ── Private ─────────────────────────────────────────────────────────

    private loadOrCreate(): VaultFile {
        if (fs.existsSync(this.filePath)) {
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw) as VaultFile;
            if (parsed.version !== 1) {
                throw new Error(`Unsupported vault version: ${parsed.version}`);
            }
            return parsed;
        }
        return {
            version: 1,
            entries: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    }

    private save(): void {
        if (!this.dirty) return;

        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(
            this.filePath,
            JSON.stringify(this.data, null, 2),
            { mode: VAULT_FILE_MODE },
        );
        this.dirty = false;
    }
}

/**
 * Known secret keys that should be migrated from .env to vault.
 */
export const KNOWN_SECRET_KEYS = [
    'openai_api_key',
    'anthropic_api_key',
    'gemini_api_key',
    'nvidia_api_key',
    'openclaw_oauth_token',
    'cliproxyapi_api_key',
    'telegram_bot_token',
    'discord_bot_token',
    'wallet_passphrase',
] as const;
