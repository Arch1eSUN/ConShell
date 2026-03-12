/**
 * PlaywrightBrowserProvider — BrowserProvider implementation using Playwright.
 *
 * Refactored from the global singleton in runtime/browser-tools.ts
 * into a proper session-based provider. Playwright is an optional peer dep.
 */
import { randomUUID } from 'node:crypto';
import type {
    BrowserProvider,
    BrowserLaunchOptions,
    BrowserSession,
    NavigateOptions,
    PageInfo,
    ScreenshotOptions,
    ScreenshotResult,
    ElementInfo,
} from './types.js';

export class PlaywrightBrowserProvider implements BrowserProvider {
    readonly name = 'playwright';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private browser: any = null;
    private readonly sessions = new Map<string, PlaywrightSession>();

    async launch(options?: BrowserLaunchOptions): Promise<BrowserSession> {
        await this.ensureBrowser(options);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const page = await (this.browser as any).newPage();

        if (options?.viewport) {
            await page.setViewportSize(options.viewport);
        }
        if (options?.userAgent) {
            await page.setExtraHTTPHeaders({ 'User-Agent': options.userAgent });
        }

        const session = new PlaywrightSession(page, randomUUID());
        this.sessions.set(session.sessionId, session);
        return session;
    }

    async isAvailable(): Promise<boolean> {
        try {
            await import('playwright' as string);
            return true;
        } catch {
            return false;
        }
    }

    async shutdown(): Promise<void> {
        for (const session of this.sessions.values()) {
            try {
                await session.close();
            } catch {
                // Ignore close errors during shutdown
            }
        }
        this.sessions.clear();

        if (this.browser) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (this.browser as any).close();
            } catch {
                // Ignore
            }
            this.browser = null;
        }
    }

    private async ensureBrowser(options?: BrowserLaunchOptions): Promise<void> {
        if (this.browser) return;

        try {
            const pw = await import('playwright' as string);
            this.browser = await pw.chromium.launch({
                headless: options?.headless ?? true,
            });
        } catch {
            throw new Error(
                'Playwright is not installed. Run: pnpm add playwright',
            );
        }
    }
}

class PlaywrightSession implements BrowserSession {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly page: any;
    readonly sessionId: string;
    private currentUrl = 'about:blank';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(page: any, sessionId: string) {
        this.page = page;
        this.sessionId = sessionId;
    }

    async navigate(urlTarget: string, opts?: NavigateOptions): Promise<PageInfo> {
        const waitUntil = opts?.waitUntil ?? 'domcontentloaded';
        const timeout = opts?.timeout ?? 15_000;

        await this.page.goto(urlTarget, { waitUntil, timeout });

        if (opts?.waitAfter) {
            await this.page.waitForTimeout(opts.waitAfter);
        }

        this.currentUrl = urlTarget;
        const pageTitle = await this.page.title();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text: string = await this.page.evaluate(() => (globalThis as any).document.body.innerText);

        return {
            url: urlTarget,
            title: pageTitle,
            textContent: text.slice(0, 8000),
            textLength: text.length,
        };
    }

    async evaluate<T = unknown>(expression: string): Promise<T> {
        return this.page.evaluate(expression) as Promise<T>;
    }

    async screenshot(opts?: ScreenshotOptions): Promise<ScreenshotResult> {
        const format = opts?.format ?? 'png';
        const buffer: Buffer = await this.page.screenshot({
            fullPage: opts?.fullPage ?? false,
            type: format,
            quality: format === 'jpeg' ? (opts?.quality ?? 80) : undefined,
        });

        return {
            format,
            data: buffer,
            width: 0, // Playwright doesn't return dimensions inline
            height: 0,
        };
    }

    async querySelector(selector: string): Promise<ElementInfo[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const elements: ElementInfo[] = await this.page.evaluate((sel: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const doc = (globalThis as any).document;
            const els = doc.querySelectorAll(sel);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return Array.from(els).slice(0, 50).map((el: any) => ({
                tagName: el.tagName.toLowerCase(),
                text: (el.textContent ?? '').slice(0, 200),
                attributes: Object.fromEntries(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    Array.from(el.attributes).map((a: any) => [a.name, a.value]),
                ),
                visible: el.offsetParent !== null,
            }));
        }, selector);

        return elements;
    }

    async click(selector: string): Promise<void> {
        await this.page.click(selector, { timeout: 5000 });
    }

    async type(selector: string, text: string): Promise<void> {
        await this.page.fill(selector, text, { timeout: 5000 });
    }

    async title(): Promise<string> {
        return this.page.title();
    }

    url(): string {
        return this.currentUrl;
    }

    async close(): Promise<void> {
        await this.page.close();
    }
}
