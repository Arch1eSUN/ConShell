/**
 * Browser Tools — Provider-based browser automation for autonomous operation.
 *
 * Requires: browser_control capability
 *
 * Uses the BrowserProvider abstraction from @conshell/openclaw-bridge to support
 * multiple backends (Playwright, Chrome DevTools Protocol). Falls back to a
 * lightweight inline Playwright provider if the bridge is not available.
 *
 * NOTE: At least one browser backend (playwright or chrome-remote-interface)
 * must be installed as an optional dependency for these tools to function.
 */
import type { ToolDefinition } from '@conshell/core';
import type { ToolHandler } from './web-tools.js';

/** BrowserSession interface (mirrors @conshell/openclaw-bridge types). */
interface BrowserSession {
    navigate(url: string, opts?: { waitUntil?: string; timeout?: number; waitAfter?: number }): Promise<{ url: string; title: string; textContent: string; textLength: number }>;
    evaluate<T = unknown>(expression: string): Promise<T>;
    screenshot(opts?: { fullPage?: boolean; format?: string }): Promise<{ format: string; data: Buffer }>;
    querySelector(selector: string): Promise<{ tagName: string; text: string }[]>;
    click(selector: string): Promise<void>;
    type(selector: string, text: string): Promise<void>;
    title(): Promise<string>;
    url(): string;
    close(): Promise<void>;
}

/** BrowserProvider interface (mirrors @conshell/openclaw-bridge types). */
interface BrowserProvider {
    readonly name: string;
    launch(options?: Record<string, unknown>): Promise<BrowserSession>;
    isAvailable(): Promise<boolean>;
    shutdown(): Promise<void>;
}

/**
 * The active browser provider. Defaults to a built-in Playwright provider
 * but can be swapped to any provider from @conshell/openclaw-bridge.
 */
let activeProvider: BrowserProvider | null = null;
// Keep a persistent session for stateful tools (click, type, screenshot on current page)
let persistentSession: BrowserSession | null = null;

/**
 * Set the browser provider to use for all browser tools.
 * Call this during runtime initialization to inject a provider from the bridge.
 */
export function setBrowserProvider(provider: BrowserProvider): void {
    activeProvider = provider;
}

/** Ensure we have a provider and a persistent session. */
async function ensureSession(): Promise<BrowserSession> {
    if (persistentSession) return persistentSession;

    // If no provider was injected, create a default Playwright-based one
    if (!activeProvider) {
        activeProvider = await createDefaultPlaywrightProvider();
    }

    persistentSession = await activeProvider.launch();
    return persistentSession;
}

/** Fallback: create a lightweight Playwright provider inline. */
async function createDefaultPlaywrightProvider(): Promise<BrowserProvider> {
    return {
        name: 'playwright-default',
        async launch() {
            try {
                const pw = await import('playwright' as string);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const browser = await (pw as any).chromium.launch({ headless: true });
                const page = await browser.newPage();
                let currentUrl = 'about:blank';

                return {
                    async navigate(url: string, opts?: { waitUntil?: string; timeout?: number; waitAfter?: number }) {
                        await page.goto(url, {
                            waitUntil: opts?.waitUntil ?? 'domcontentloaded',
                            timeout: opts?.timeout ?? 15_000,
                        });
                        if (opts?.waitAfter) await page.waitForTimeout(opts.waitAfter);
                        currentUrl = url;
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const text: string = await page.evaluate(() => (globalThis as any).document.body.innerText);
                        const title: string = await page.title();
                        return { url, title, textContent: text.slice(0, 8000), textLength: text.length };
                    },
                    async evaluate<T>(expression: string): Promise<T> {
                        return page.evaluate(expression) as Promise<T>;
                    },
                    async screenshot(opts?: { fullPage?: boolean; format?: string }) {
                        const buf: Buffer = await page.screenshot({ fullPage: opts?.fullPage ?? false, type: 'png' });
                        return { format: 'png', data: buf };
                    },
                    async querySelector(selector: string) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        return page.evaluate((sel: string) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const doc = (globalThis as any).document;
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            return Array.from(doc.querySelectorAll(sel)).slice(0, 50).map((el: any) => ({
                                tagName: el.tagName.toLowerCase(),
                                text: (el.textContent ?? '').slice(0, 200),
                            }));
                        }, selector);
                    },
                    async click(selector: string) { await page.click(selector, { timeout: 5000 }); },
                    async type(selector: string, text: string) { await page.fill(selector, text, { timeout: 5000 }); },
                    async title() { return page.title(); },
                    url() { return currentUrl; },
                    async close() { await page.close(); await browser.close(); },
                };
            } catch {
                throw new Error('No browser backend available. Install playwright or chrome-remote-interface.');
            }
        },
        async isAvailable() {
            try { await import('playwright' as string); return true; } catch { return false; }
        },
        async shutdown() {
            if (persistentSession) {
                try { await persistentSession.close(); } catch { /* ignore */ }
                persistentSession = null;
            }
        },
    };
}

// ── Tool Definitions ────────────────────────────────────────────────────

export const browserOpenDefinition: ToolDefinition = {
    name: 'browser_open',
    category: 'browser',
    description: 'Open a URL in a headless browser and return the page text content.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL to open' },
            waitFor: { type: 'number', description: 'Milliseconds to wait for page load (default 3000)' },
        },
        required: ['url'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['url'],
    requiredCapabilities: ['browser_control'],
};

export const browserClickDefinition: ToolDefinition = {
    name: 'browser_click',
    category: 'browser',
    description: 'Click an element on the current page by CSS selector.',
    inputSchema: {
        type: 'object',
        properties: {
            selector: { type: 'string', description: 'CSS selector of the element to click' },
        },
        required: ['selector'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['selector'],
    requiredCapabilities: ['browser_control'],
};

export const browserTypeDefinition: ToolDefinition = {
    name: 'browser_type',
    category: 'browser',
    description: 'Type text into an input field on the current page.',
    inputSchema: {
        type: 'object',
        properties: {
            selector: { type: 'string', description: 'CSS selector of the input field' },
            text: { type: 'string', description: 'Text to type' },
        },
        required: ['selector', 'text'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['selector'],
    requiredCapabilities: ['browser_control'],
};

export const browserScreenshotDefinition: ToolDefinition = {
    name: 'browser_screenshot',
    category: 'browser',
    description: 'Take a screenshot of the current page and return it as a base64 PNG.',
    inputSchema: {
        type: 'object',
        properties: {
            fullPage: { type: 'boolean', description: 'Capture full scrollable page (default false)' },
        },
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: [],
    requiredCapabilities: ['browser_control'],
};

export const browserNavigateDefinition: ToolDefinition = {
    name: 'browser_navigate',
    category: 'browser',
    description: 'Navigate the current browser page to a new URL.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL to navigate to' },
            waitFor: { type: 'number', description: 'Milliseconds to wait after navigation (default 2000)' },
        },
        required: ['url'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: false,
    auditFields: ['url'],
    requiredCapabilities: ['browser_control'],
};

export const BROWSER_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    browserOpenDefinition,
    browserClickDefinition,
    browserTypeDefinition,
    browserScreenshotDefinition,
    browserNavigateDefinition,
];

// ── Handlers (now provider-delegated) ───────────────────────────────────

const browserOpenHandler: ToolHandler = async (args) => {
    const url = args['url'] as string;
    const waitFor = (args['waitFor'] as number) ?? 3000;
    const session = await ensureSession();
    const info = await session.navigate(url, { waitAfter: waitFor });
    return JSON.stringify({ title: info.title, url: info.url, textLength: info.textLength, text: info.textContent });
};

const browserClickHandler: ToolHandler = async (args) => {
    const selector = args['selector'] as string;
    const session = await ensureSession();
    await session.click(selector);
    return JSON.stringify({ clicked: selector, success: true });
};

const browserTypeHandler: ToolHandler = async (args) => {
    const selector = args['selector'] as string;
    const text = args['text'] as string;
    const session = await ensureSession();
    await session.type(selector, text);
    return JSON.stringify({ typed: selector, textLength: text.length, success: true });
};

const browserScreenshotHandler: ToolHandler = async (args) => {
    const fullPage = (args['fullPage'] as boolean) ?? false;
    const session = await ensureSession();
    const result = await session.screenshot({ fullPage });
    const base64 = result.data.toString('base64');
    return JSON.stringify({ format: result.format, base64Length: base64.length, base64: base64.slice(0, 4000) + '...' });
};

const browserNavigateHandler: ToolHandler = async (args) => {
    const url = args['url'] as string;
    const waitFor = (args['waitFor'] as number) ?? 2000;
    const session = await ensureSession();
    const info = await session.navigate(url, { waitAfter: waitFor });
    return JSON.stringify({ navigated: url, title: info.title, success: true });
};

export const BROWSER_TOOL_HANDLERS: ReadonlyMap<string, ToolHandler> = new Map([
    ['browser_open', browserOpenHandler],
    ['browser_click', browserClickHandler],
    ['browser_type', browserTypeHandler],
    ['browser_screenshot', browserScreenshotHandler],
    ['browser_navigate', browserNavigateHandler],
]);
