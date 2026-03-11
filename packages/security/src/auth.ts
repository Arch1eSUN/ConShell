/**
 * Auth Middleware — Express middleware for token/password authentication.
 *
 * Three modes:
 *   - 'none':     No authentication (development only)
 *   - 'token':    Auto-generated 32-byte random token, printed at startup
 *   - 'password': User-configured password
 *
 * Uses crypto.timingSafeEqual() to prevent timing attacks.
 */
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ── Types ───────────────────────────────────────────────────────────────

export type AuthMode = 'none' | 'token' | 'password';

export interface AuthConfig {
    readonly mode: AuthMode;
    /** The secret (token or password). Auto-generated if mode is 'token'. */
    readonly secret?: string;
    /** Paths that skip authentication. Default: ['/health', '/api/health'] */
    readonly skipPaths?: readonly string[];
}

export interface AuthResult {
    readonly authenticated: boolean;
    readonly reason?: string;
}

// ── Token generation ────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure random token (32 bytes, base64url).
 */
export function generateToken(): string {
    return crypto.randomBytes(32).toString('base64url');
}

// ── Timing-safe comparison ──────────────────────────────────────────────

/**
 * Compare two strings in constant time to prevent timing attacks.
 */
function timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
        // Still do a comparison to maintain constant time
        const dummy = Buffer.alloc(b.length);
        crypto.timingSafeEqual(dummy, Buffer.from(b));
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ── Default skip paths ──────────────────────────────────────────────────

const DEFAULT_SKIP_PATHS = ['/health', '/api/health'] as const;

// ── Middleware ───────────────────────────────────────────────────────────

/**
 * Creates an Express-compatible auth middleware.
 *
 * Usage:
 * ```ts
 * const token = generateToken();
 * app.use(createAuthMiddleware({ mode: 'token', secret: token }));
 * console.log(`Auth token: ${token}`);
 * ```
 */
export function createAuthMiddleware(config: AuthConfig): (
    req: IncomingMessage & { path?: string; query?: Record<string, string> },
    res: ServerResponse & { status?: (code: number) => any; json?: (data: any) => any },
    next: () => void,
) => void {
    const skipPaths = new Set(config.skipPaths ?? DEFAULT_SKIP_PATHS);

    return (req, res, next) => {
        // Extract path
        const urlPath = req.path ?? new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

        // Skip authentication for excluded paths
        if (skipPaths.has(urlPath)) {
            next();
            return;
        }

        // No auth mode — pass through
        if (config.mode === 'none') {
            next();
            return;
        }

        // Extract token from Authorization header or query param
        const authHeader = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ')
            ? authHeader.slice(7)
            : (req.query?.['token'] as string | undefined);

        if (!token) {
            sendUnauthorized(res, 'Missing authentication token');
            return;
        }

        if (!config.secret) {
            sendUnauthorized(res, 'Server auth not configured');
            return;
        }

        if (!timingSafeCompare(token, config.secret)) {
            sendUnauthorized(res, 'Invalid authentication token');
            return;
        }

        next();
    };
}

/**
 * Verify a token/password for WebSocket authentication.
 */
export function verifyAuth(config: AuthConfig, token: string | undefined): AuthResult {
    if (config.mode === 'none') {
        return { authenticated: true };
    }

    if (!token) {
        return { authenticated: false, reason: 'Missing token' };
    }

    if (!config.secret) {
        return { authenticated: false, reason: 'Auth not configured' };
    }

    if (!timingSafeCompare(token, config.secret)) {
        return { authenticated: false, reason: 'Invalid token' };
    }

    return { authenticated: true };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function sendUnauthorized(
    res: ServerResponse & { status?: (code: number) => any; json?: (data: any) => any },
    message: string,
): void {
    // Express-style response
    if (typeof res.status === 'function' && typeof res.json === 'function') {
        res.status(401).json({ error: 'Unauthorized', message });
        return;
    }
    // Raw Node.js response
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized', message }));
}
