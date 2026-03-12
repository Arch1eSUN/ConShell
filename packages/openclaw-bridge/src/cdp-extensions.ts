/**
 * CDP Network Interceptor — Advanced CDP capabilities for network interception, 
 * anti-detection, and request modification.
 *
 * Extends the base CdpBrowserProvider with:
 * - Network request/response interception
 * - Anti-detection middleware pipeline
 * - Request header injection
 * - Response body extraction
 */

import type { BrowserSession } from './types.js';

// ── Network Interception Types ──────────────────────────────────────────

export interface NetworkInterceptRule {
    /** URL pattern to match (glob-style). */
    readonly urlPattern: string;
    /** Action to take on match. */
    readonly action: 'block' | 'modify' | 'log' | 'passthrough';
    /** Headers to inject (for 'modify' action). */
    readonly injectHeaders?: Readonly<Record<string, string>>;
    /** Resource types to match (document, stylesheet, image, etc.). */
    readonly resourceTypes?: readonly string[];
}

export interface InterceptedRequest {
    readonly requestId: string;
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly resourceType: string;
    readonly timestamp: number;
    readonly matchedRule?: string;
    readonly action: string;
}

export interface NetworkInterceptorConfig {
    /** Rules to apply to intercepted requests. */
    readonly rules: readonly NetworkInterceptRule[];
    /** Whether to log all requests (default false). */
    readonly logAll?: boolean;
    /** Maximum log buffer size (default 1000). */
    readonly maxLogSize?: number;
}

// ── Anti-Detection Middleware Types ──────────────────────────────────────

export type AntiDetectProfile = 'stealth' | 'residential' | 'mobile' | 'minimal';

export interface AntiDetectConfig {
    /** Preset profile to apply. */
    readonly profile: AntiDetectProfile;
    /** Override user agent string. */
    readonly userAgent?: string;
    /** Override navigator.webdriver property. */
    readonly hideWebdriver?: boolean;
    /** Randomize canvas fingerprint. */
    readonly randomizeCanvas?: boolean;
    /** Override WebGL renderer info. */
    readonly spoofWebGL?: boolean;
    /** Override timezone. */
    readonly timezone?: string;
    /** Override locale. */
    readonly locale?: string;
}

// ── Anti-Detection Profiles ─────────────────────────────────────────────

const PROFILES: Record<AntiDetectProfile, AntiDetectConfig> = {
    stealth: {
        profile: 'stealth',
        hideWebdriver: true,
        randomizeCanvas: true,
        spoofWebGL: true,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    residential: {
        profile: 'residential',
        hideWebdriver: true,
        randomizeCanvas: false,
        spoofWebGL: false,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    mobile: {
        profile: 'mobile',
        hideWebdriver: true,
        randomizeCanvas: false,
        spoofWebGL: false,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    },
    minimal: {
        profile: 'minimal',
        hideWebdriver: true,
        randomizeCanvas: false,
        spoofWebGL: false,
    },
};

// ── Network Interceptor ─────────────────────────────────────────────────

export class NetworkInterceptor {
    private readonly config: NetworkInterceptorConfig;
    private readonly log: InterceptedRequest[] = [];

    constructor(config: NetworkInterceptorConfig) {
        this.config = config;
    }

    /**
     * Evaluate a request against configured rules.
     */
    evaluateRequest(url: string, method: string, headers: Record<string, string>, resourceType: string): {
        action: 'block' | 'modify' | 'log' | 'passthrough';
        matchedRule?: NetworkInterceptRule;
        modifiedHeaders?: Record<string, string>;
    } {
        for (const rule of this.config.rules) {
            if (!this.matchesPattern(url, rule.urlPattern)) continue;
            if (rule.resourceTypes && !rule.resourceTypes.includes(resourceType)) continue;

            const intercepted: InterceptedRequest = {
                requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                url,
                method,
                headers,
                resourceType,
                timestamp: Date.now(),
                matchedRule: rule.urlPattern,
                action: rule.action,
            };

            this.addToLog(intercepted);

            if (rule.action === 'modify' && rule.injectHeaders) {
                return {
                    action: 'modify',
                    matchedRule: rule,
                    modifiedHeaders: { ...headers, ...rule.injectHeaders },
                };
            }

            return { action: rule.action, matchedRule: rule };
        }

        if (this.config.logAll) {
            this.addToLog({
                requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                url, method, headers, resourceType,
                timestamp: Date.now(),
                action: 'passthrough',
            });
        }

        return { action: 'passthrough' };
    }

    /**
     * Get the request log.
     */
    getLog(): readonly InterceptedRequest[] {
        return this.log;
    }

    /**
     * Clear the request log.
     */
    clearLog(): void {
        this.log.length = 0;
    }

    private matchesPattern(url: string, pattern: string): boolean {
        // Convert glob to regex: * → [^/]*, ** → .*, ? → .
        const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '§DOUBLESTAR§')
            .replace(/\*/g, '[^/]*')
            .replace(/§DOUBLESTAR§/g, '.*')
            .replace(/\?/g, '.');
        return new RegExp(`^${escaped}$`).test(url);
    }

    private addToLog(entry: InterceptedRequest): void {
        const maxSize = this.config.maxLogSize ?? 1000;
        if (this.log.length >= maxSize) {
            this.log.shift();
        }
        this.log.push(entry);
    }
}

// ── Anti-Detection Middleware ────────────────────────────────────────────

export class AntiDetectMiddleware {
    private readonly config: AntiDetectConfig;

    constructor(profileOrConfig: AntiDetectProfile | AntiDetectConfig) {
        this.config = typeof profileOrConfig === 'string'
            ? PROFILES[profileOrConfig]
            : { ...PROFILES[profileOrConfig.profile], ...profileOrConfig };
    }

    /**
     * Generate JavaScript to inject into the page to evade bot detection.
     */
    generateEvasionScript(): string {
        const scripts: string[] = [];

        if (this.config.hideWebdriver) {
            scripts.push(`
                // Remove webdriver flag
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                // Chrome DevTools detection
                if (window.chrome) {
                    window.chrome.runtime = window.chrome.runtime || {};
                }
            `);
        }

        if (this.config.randomizeCanvas) {
            scripts.push(`
                // Canvas fingerprint randomization
                const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
                HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
                    const ctx = this.getContext('2d');
                    if (ctx) {
                        const noise = Math.random() * 0.01;
                        const imgData = ctx.getImageData(0, 0, this.width, this.height);
                        for (let i = 0; i < imgData.data.length; i += 4) {
                            imgData.data[i] = Math.min(255, imgData.data[i] + Math.floor(noise * 255));
                        }
                        ctx.putImageData(imgData, 0, 0);
                    }
                    return origToDataURL.call(this, type, quality);
                };
            `);
        }

        if (this.config.spoofWebGL) {
            scripts.push(`
                // WebGL renderer spoofing
                const origGetParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(param) {
                    if (param === 37445) return 'Intel Inc.';
                    if (param === 37446) return 'Intel Iris OpenGL Engine';
                    return origGetParameter.call(this, param);
                };
            `);
        }

        if (this.config.timezone) {
            scripts.push(`
                // Timezone override
                const origDateTimeFormat = Intl.DateTimeFormat;
                Intl.DateTimeFormat = function(...args) {
                    if (args.length === 0 || !args[1]) args[1] = {};
                    args[1].timeZone = '${this.config.timezone}';
                    return new origDateTimeFormat(...args);
                };
            `);
        }

        return scripts.join('\n');
    }

    /**
     * Apply anti-detection to a browser session.
     */
    async apply(session: BrowserSession): Promise<void> {
        const script = this.generateEvasionScript();
        if (script.trim()) {
            await session.evaluate(script);
        }
    }

    /**
     * Get the user agent for this profile.
     */
    getUserAgent(): string | undefined {
        return this.config.userAgent;
    }

    /**
     * Get the full config for inspection.
     */
    getConfig(): Readonly<AntiDetectConfig> {
        return this.config;
    }
}

// ── Exports ─────────────────────────────────────────────────────────────

export { PROFILES as ANTI_DETECT_PROFILES };
