/**
 * SIWE — Sign-In With Ethereum helpers (EIP-4361).
 *
 * Pure string construction for message creation.
 * Signature verification uses dynamic import of viem (optional dependency).
 */
import { randomBytes } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────

export interface SiweMessageOptions {
    readonly domain: string;
    readonly address: string;
    readonly statement?: string;
    readonly uri: string;
    readonly version?: string;
    readonly chainId?: number;
    readonly nonce: string;
    readonly issuedAt?: string;
    readonly expirationTime?: string;
    readonly resources?: readonly string[];
}

// ── Message Creation ───────────────────────────────────────────────────

/**
 * Create a SIWE message string per EIP-4361.
 *
 * Format:
 * ```
 * {domain} wants you to sign in with your Ethereum account:
 * {address}
 *
 * {statement}
 *
 * URI: {uri}
 * Version: {version}
 * Chain ID: {chainId}
 * Nonce: {nonce}
 * Issued At: {issuedAt}
 * ```
 */
export function createSiweMessage(opts: SiweMessageOptions): string {
    const lines: string[] = [];

    lines.push(`${opts.domain} wants you to sign in with your Ethereum account:`);
    lines.push(opts.address);
    lines.push('');

    if (opts.statement) {
        lines.push(opts.statement);
        lines.push('');
    }

    lines.push(`URI: ${opts.uri}`);
    lines.push(`Version: ${opts.version ?? '1'}`);
    lines.push(`Chain ID: ${opts.chainId ?? 1}`);
    lines.push(`Nonce: ${opts.nonce}`);
    lines.push(`Issued At: ${opts.issuedAt ?? new Date().toISOString()}`);

    if (opts.expirationTime) {
        lines.push(`Expiration Time: ${opts.expirationTime}`);
    }

    if (opts.resources && opts.resources.length > 0) {
        lines.push('Resources:');
        for (const resource of opts.resources) {
            lines.push(`- ${resource}`);
        }
    }

    return lines.join('\n');
}

// ── Verification ───────────────────────────────────────────────────────

/**
 * Verify a SIWE message signature.
 * Uses dynamic import of viem — if viem is not installed, returns false.
 */
export async function verifySiweSignature(
    message: string,
    signature: string,
    expectedAddress: string,
): Promise<boolean> {
    try {
        // @ts-ignore — viem is an optional peer dependency
        const viem = await import('viem');
        const valid = await viem.verifyMessage({
            address: expectedAddress as `0x${string}`,
            message,
            signature: signature as `0x${string}`,
        });
        return valid;
    } catch {
        return false;
    }
}

// ── Nonce Generation ───────────────────────────────────────────────────

/**
 * Generate a random alphanumeric nonce for SIWE messages.
 */
export function generateNonce(length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[bytes[i]! % chars.length];
    }
    return result;
}
