/**
 * OAuth Manager — Multi-provider OAuth login integration.
 *
 * Supports 4 providers with mixed authentication strategies:
 *
 * | Provider         | Flow                      |
 * |------------------|---------------------------|
 * | GitHub Copilot   | Device Code Flow (RFC 8628) |
 * | Google Antigravity | Authorization Code + PKCE |
 * | Claude (Anthropic) | Guided API Key           |
 * | OpenAI Codex     | Guided API Key             |
 */

import { randomBytes, createHash } from 'node:crypto';
import type { Logger } from '@conshell/core';

// ── Types ──────────────────────────────────────────────────────────────

export type OAuthProvider = 'github' | 'google' | 'claude' | 'openai';
export type OAuthFlowType = 'device_code' | 'authorization_code' | 'guided_key';
export type OAuthFlowStatus = 'idle' | 'awaiting_user' | 'polling' | 'success' | 'error';

export interface OAuthFlowState {
    readonly provider: OAuthProvider;
    readonly flowType: OAuthFlowType;
    status: OAuthFlowStatus;
    /** For device_code: user verification URI */
    verificationUri?: string;
    /** For device_code: code the user must enter */
    userCode?: string;
    /** For authorization_code: URL to open in browser */
    authUrl?: string;
    /** For guided_key: URL to console/platform */
    guideUrl?: string;
    /** Resulting credential after successful flow */
    credential?: OAuthCredential;
    /** Error message on failure */
    error?: string;
    /** Timestamp of flow start */
    startedAt: number;
}

export interface OAuthCredential {
    readonly provider: OAuthProvider;
    readonly accessToken: string;
    readonly refreshToken?: string;
    readonly expiresAt?: number;
    readonly tokenType: 'bearer' | 'api_key';
    readonly scope?: string;
}

export interface OAuthProviderConfig {
    readonly github?: { clientId: string };
    readonly google?: { clientId: string; clientSecret: string; redirectUri: string };
}

// ── Constants ──────────────────────────────────────────────────────────

const GITHUB_DEVICE_CODE_URL     = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL           = 'https://github.com/login/oauth/access_token';
const GITHUB_COPILOT_SCOPE       = 'read:user';

const GOOGLE_AUTH_URL             = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL            = 'https://oauth2.googleapis.com/token';
const GOOGLE_SCOPE                = 'https://www.googleapis.com/auth/generative-language https://www.googleapis.com/auth/cloud-platform';

const CLAUDE_CONSOLE_URL          = 'https://console.anthropic.com/settings/keys';
const OPENAI_PLATFORM_URL         = 'https://platform.openai.com/api-keys';

const POLL_INTERVAL_MS            = 5_000;
const FLOW_TIMEOUT_MS             = 300_000; // 5 minutes

// ── OAuthManager ───────────────────────────────────────────────────────

export class OAuthManager {
    private readonly flows = new Map<OAuthProvider, OAuthFlowState>();
    private readonly credentials = new Map<OAuthProvider, OAuthCredential>();
    private readonly pollTimers = new Map<OAuthProvider, ReturnType<typeof setInterval>>();

    constructor(
        private readonly config: OAuthProviderConfig,
        private readonly logger: Logger,
    ) {}

    // ── Public API ──────────────────────────────────────────────────

    /**
     * Start an OAuth flow for the given provider.
     */
    async startFlow(provider: OAuthProvider): Promise<OAuthFlowState> {
        // Cancel any existing flow
        this.cancelFlow(provider);

        switch (provider) {
            case 'github':  return this.startGitHubDeviceFlow();
            case 'google':  return this.startGoogleAuthCodeFlow();
            case 'claude':  return this.startGuidedFlow('claude', CLAUDE_CONSOLE_URL);
            case 'openai':  return this.startGuidedFlow('openai', OPENAI_PLATFORM_URL);
        }
    }

    /**
     * Get current flow status.
     */
    getFlowStatus(provider: OAuthProvider): OAuthFlowState | undefined {
        return this.flows.get(provider);
    }

    /**
     * Handle OAuth callback (for authorization_code flows).
     */
    async handleCallback(provider: OAuthProvider, code: string): Promise<OAuthCredential> {
        if (provider !== 'google') {
            throw new Error(`Callback not supported for ${provider}`);
        }
        return this.exchangeGoogleCode(code);
    }

    /**
     * Submit a manually-obtained API key (for guided flows).
     */
    async submitManualKey(provider: OAuthProvider, apiKey: string): Promise<OAuthCredential> {
        if (provider !== 'claude' && provider !== 'openai') {
            throw new Error(`Manual key not supported for ${provider}`);
        }

        // Validate the key by making a test request
        const valid = await this.validateApiKey(provider, apiKey);
        if (!valid) {
            const flow = this.flows.get(provider);
            if (flow) {
                flow.status = 'error';
                flow.error = 'API key validation failed — key is invalid or expired';
            }
            throw new Error('API key validation failed');
        }

        const credential: OAuthCredential = {
            provider,
            accessToken: apiKey,
            tokenType: 'api_key',
        };

        this.credentials.set(provider, credential);
        const flow = this.flows.get(provider);
        if (flow) {
            flow.status = 'success';
            flow.credential = credential;
        }
        this.logger.info(`OAuth: ${provider} API key validated and stored`);
        return credential;
    }

    /**
     * Disconnect / remove a provider credential.
     */
    disconnect(provider: OAuthProvider): boolean {
        this.cancelFlow(provider);
        const had = this.credentials.has(provider);
        this.credentials.delete(provider);
        this.flows.delete(provider);
        if (had) this.logger.info(`OAuth: ${provider} disconnected`);
        return had;
    }

    /**
     * Get stored credential for a provider.
     */
    getCredential(provider: OAuthProvider): OAuthCredential | undefined {
        return this.credentials.get(provider);
    }

    /**
     * List all connected providers.
     */
    listConnected(): OAuthProvider[] {
        return [...this.credentials.keys()];
    }

    /**
     * Clean up all resources.
     */
    destroy(): void {
        for (const provider of this.pollTimers.keys()) {
            this.cancelFlow(provider);
        }
    }

    // ── GitHub Device Code Flow ─────────────────────────────────────

    private async startGitHubDeviceFlow(): Promise<OAuthFlowState> {
        const clientId = this.config.github?.clientId;
        if (!clientId) {
            return this.errorFlow('github', 'device_code', 'GitHub OAuth client_id not configured');
        }

        this.logger.info('OAuth: Starting GitHub Device Code Flow');

        try {
            const res = await fetch(GITHUB_DEVICE_CODE_URL, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    client_id: clientId,
                    scope: GITHUB_COPILOT_SCOPE,
                }),
            });

            if (!res.ok) {
                return this.errorFlow('github', 'device_code', `GitHub device code request failed: ${res.status}`);
            }

            const data = await res.json() as {
                device_code: string;
                user_code: string;
                verification_uri: string;
                expires_in: number;
                interval: number;
            };

            const flow: OAuthFlowState = {
                provider: 'github',
                flowType: 'device_code',
                status: 'awaiting_user',
                userCode: data.user_code,
                verificationUri: data.verification_uri,
                startedAt: Date.now(),
            };
            this.flows.set('github', flow);

            // Start polling for token
            const interval = Math.max((data.interval ?? 5) * 1000, POLL_INTERVAL_MS);
            const deviceCode = data.device_code;
            this.startPolling('github', interval, () => this.pollGitHubToken(clientId, deviceCode));

            return flow;
        } catch (err) {
            return this.errorFlow('github', 'device_code', `Network error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private async pollGitHubToken(clientId: string, deviceCode: string): Promise<void> {
        try {
            const res = await fetch(GITHUB_TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    client_id: clientId,
                    device_code: deviceCode,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                }),
            });

            const data = await res.json() as {
                access_token?: string;
                token_type?: string;
                scope?: string;
                error?: string;
            };

            if (data.access_token) {
                const credential: OAuthCredential = {
                    provider: 'github',
                    accessToken: data.access_token,
                    tokenType: 'bearer',
                    scope: data.scope,
                };
                this.credentials.set('github', credential);
                const flow = this.flows.get('github');
                if (flow) {
                    flow.status = 'success';
                    flow.credential = credential;
                }
                this.cancelPolling('github');
                this.logger.info('OAuth: GitHub authorization complete');
            } else if (data.error === 'slow_down') {
                // Slow down polling — handled by interval
            } else if (data.error === 'authorization_pending') {
                // Continue polling
            } else if (data.error === 'expired_token') {
                this.flowError('github', 'Device code expired — please try again');
                this.cancelPolling('github');
            } else if (data.error === 'access_denied') {
                this.flowError('github', 'Access denied by user');
                this.cancelPolling('github');
            }
        } catch {
            // Network error during poll — continue trying
        }
    }

    // ── Google Authorization Code + PKCE ────────────────────────────

    private startGoogleAuthCodeFlow(): OAuthFlowState {
        const googleConfig = this.config.google;
        if (!googleConfig) {
            return this.errorFlow('google', 'authorization_code', 'Google OAuth not configured (clientId, clientSecret, redirectUri required)');
        }

        this.logger.info('OAuth: Starting Google Auth Code + PKCE Flow');

        // Generate PKCE
        const codeVerifier = randomBytes(32).toString('base64url');
        const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

        // Store verifier for callback exchange
        (this as any)._googleCodeVerifier = codeVerifier;

        const params = new URLSearchParams({
            client_id: googleConfig.clientId,
            redirect_uri: googleConfig.redirectUri,
            response_type: 'code',
            scope: GOOGLE_SCOPE,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            access_type: 'offline',
            prompt: 'consent',
        });

        const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

        const flow: OAuthFlowState = {
            provider: 'google',
            flowType: 'authorization_code',
            status: 'awaiting_user',
            authUrl,
            startedAt: Date.now(),
        };
        this.flows.set('google', flow);
        return flow;
    }

    private async exchangeGoogleCode(code: string): Promise<OAuthCredential> {
        const googleConfig = this.config.google;
        if (!googleConfig) throw new Error('Google OAuth not configured');

        const codeVerifier = (this as any)._googleCodeVerifier as string | undefined;
        if (!codeVerifier) throw new Error('No PKCE code verifier — start flow first');

        const res = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: googleConfig.clientId,
                client_secret: googleConfig.clientSecret,
                code,
                code_verifier: codeVerifier,
                grant_type: 'authorization_code',
                redirect_uri: googleConfig.redirectUri,
            }).toString(),
        });

        if (!res.ok) {
            const text = await res.text();
            this.flowError('google', `Token exchange failed: ${res.status} ${text}`);
            throw new Error(`Google token exchange failed: ${res.status}`);
        }

        const data = await res.json() as {
            access_token: string;
            refresh_token?: string;
            expires_in: number;
            token_type: string;
            scope: string;
        };

        const credential: OAuthCredential = {
            provider: 'google',
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
            tokenType: 'bearer',
            scope: data.scope,
        };

        this.credentials.set('google', credential);
        const flow = this.flows.get('google');
        if (flow) {
            flow.status = 'success';
            flow.credential = credential;
        }
        delete (this as any)._googleCodeVerifier;
        this.logger.info('OAuth: Google authorization complete');
        return credential;
    }

    // ── Guided API Key Flow (Claude + OpenAI) ───────────────────────

    private startGuidedFlow(provider: OAuthProvider, guideUrl: string): OAuthFlowState {
        this.logger.info(`OAuth: Starting guided key flow for ${provider}`);

        const flow: OAuthFlowState = {
            provider,
            flowType: 'guided_key',
            status: 'awaiting_user',
            guideUrl,
            startedAt: Date.now(),
        };
        this.flows.set(provider, flow);
        return flow;
    }

    // ── Key Validation ──────────────────────────────────────────────

    private async validateApiKey(provider: OAuthProvider, apiKey: string): Promise<boolean> {
        try {
            if (provider === 'claude') {
                const res = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 1,
                        messages: [{ role: 'user', content: 'ping' }],
                    }),
                });
                // 200 = valid, 401 = invalid key, anything else = check further
                if (res.status === 401 || res.status === 403) return false;
                return true; // 200 or 400 (bad request but key works)
            }

            if (provider === 'openai') {
                const res = await fetch('https://api.openai.com/v1/models', {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                });
                return res.status !== 401;
            }

            return false;
        } catch {
            return false;
        }
    }

    // ── Helper ──────────────────────────────────────────────────────

    private cancelFlow(provider: OAuthProvider): void {
        this.cancelPolling(provider);
    }

    private cancelPolling(provider: OAuthProvider): void {
        const timer = this.pollTimers.get(provider);
        if (timer) {
            clearInterval(timer);
            this.pollTimers.delete(provider);
        }
    }

    private startPolling(provider: OAuthProvider, intervalMs: number, fn: () => Promise<void>): void {
        const flow = this.flows.get(provider);
        if (flow) flow.status = 'polling';

        const timer = setInterval(async () => {
            // Check timeout
            const f = this.flows.get(provider);
            if (f && Date.now() - f.startedAt > FLOW_TIMEOUT_MS) {
                this.flowError(provider, 'Flow timed out after 5 minutes');
                this.cancelPolling(provider);
                return;
            }
            // Check if already succeeded
            if (f?.status === 'success' || f?.status === 'error') {
                this.cancelPolling(provider);
                return;
            }
            await fn();
        }, intervalMs);

        this.pollTimers.set(provider, timer);
    }

    private flowError(provider: OAuthProvider, message: string): void {
        const flow = this.flows.get(provider);
        if (flow) {
            flow.status = 'error';
            flow.error = message;
        }
        this.logger.error(`OAuth: ${provider} — ${message}`);
    }

    private errorFlow(provider: OAuthProvider, flowType: OAuthFlowType, message: string): OAuthFlowState {
        this.logger.error(`OAuth: ${provider} — ${message}`);
        const flow: OAuthFlowState = {
            provider,
            flowType,
            status: 'error',
            error: message,
            startedAt: Date.now(),
        };
        this.flows.set(provider, flow);
        return flow;
    }
}
