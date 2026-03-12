/**
 * CdpBrowserProvider — BrowserProvider implementation using Chrome DevTools Protocol.
 *
 * Uses chrome-remote-interface (optional peer dep) for direct CDP access,
 * enabling advanced capabilities like network interception and DOM inspection
 * that OpenClaw's Chrome automation provides.
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

export class CdpBrowserProvider implements BrowserProvider {
    readonly name = 'cdp';
    private readonly sessions = new Map<string, CdpSession>();

    async launch(options?: BrowserLaunchOptions): Promise<BrowserSession> {
        const targetUrl = options?.targetUrl ?? 'http://localhost:9222';

        let CDP: typeof import('chrome-remote-interface');
        try {
            CDP = await import('chrome-remote-interface' as string);
        } catch {
            throw new Error(
                'chrome-remote-interface is not installed. Run: pnpm add chrome-remote-interface',
            );
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const client = await (CDP as any)({ host: new URL(targetUrl).hostname, port: Number(new URL(targetUrl).port) || 9222 });
        const sessionId = randomUUID();
        const session = new CdpSession(client, sessionId);
        await session.initialize(options);

        this.sessions.set(sessionId, session);
        return session;
    }

    async isAvailable(): Promise<boolean> {
        try {
            await import('chrome-remote-interface' as string);
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
    }
}

class CdpSession implements BrowserSession {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly client: any;
    readonly sessionId: string;
    private currentUrl = 'about:blank';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(client: any, sessionId: string) {
        this.client = client;
        this.sessionId = sessionId;
    }

    async initialize(options?: BrowserLaunchOptions): Promise<void> {
        const { Page, Runtime, DOM, Network } = this.client;

        await Promise.all([
            Page.enable(),
            Runtime.enable(),
            DOM.enable(),
            Network.enable(),
        ]);

        if (options?.userAgent) {
            await Network.setUserAgentOverride({ userAgent: options.userAgent });
        }

        if (options?.viewport) {
            const { Emulation } = this.client;
            await Emulation.setDeviceMetricsOverride({
                width: options.viewport.width,
                height: options.viewport.height,
                deviceScaleFactor: 1,
                mobile: false,
            });
        }
    }

    async navigate(urlTarget: string, opts?: NavigateOptions): Promise<PageInfo> {
        const { Page, Runtime } = this.client;
        const timeout = opts?.timeout ?? 15_000;

        await Page.navigate({ url: urlTarget });

        // Wait for page load
        await Promise.race([
            Page.loadEventFired(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Navigation timeout')), timeout),
            ),
        ]);

        if (opts?.waitAfter) {
            await new Promise<void>(resolve => setTimeout(resolve, opts.waitAfter));
        }

        this.currentUrl = urlTarget;

        const titleResult = await Runtime.evaluate({
            expression: 'document.title',
            returnByValue: true,
        });
        const textResult = await Runtime.evaluate({
            expression: 'document.body.innerText',
            returnByValue: true,
        });

        const titleStr = (titleResult.result?.value as string) ?? '';
        const textStr = (textResult.result?.value as string) ?? '';

        return {
            url: urlTarget,
            title: titleStr,
            textContent: textStr.slice(0, 8000),
            textLength: textStr.length,
        };
    }

    async evaluate<T = unknown>(expression: string): Promise<T> {
        const { Runtime } = this.client;
        const result = await Runtime.evaluate({
            expression,
            returnByValue: true,
            awaitPromise: true,
        });

        if (result.exceptionDetails) {
            throw new Error(
                `CDP evaluate error: ${result.exceptionDetails.text ?? 'Unknown error'}`,
            );
        }

        return result.result?.value as T;
    }

    async screenshot(opts?: ScreenshotOptions): Promise<ScreenshotResult> {
        const { Page } = this.client;
        const format = opts?.format ?? 'png';

        const captureParams: Record<string, unknown> = {
            format,
            captureBeyondViewport: opts?.fullPage ?? false,
        };
        if (format === 'jpeg' && opts?.quality) {
            captureParams['quality'] = opts.quality;
        }

        const result = await Page.captureScreenshot(captureParams);
        const data = Buffer.from(result.data as string, 'base64');

        return {
            format,
            data,
            width: 0,
            height: 0,
        };
    }

    async querySelector(selector: string): Promise<ElementInfo[]> {
        const { Runtime } = this.client;

        const result = await Runtime.evaluate({
            expression: `
                JSON.stringify(
                    Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
                        .slice(0, 50)
                        .map(el => ({
                            tagName: el.tagName.toLowerCase(),
                            text: (el.textContent ?? '').slice(0, 200),
                            attributes: Object.fromEntries(
                                Array.from(el.attributes).map(a => [a.name, a.value])
                            ),
                            visible: el.offsetParent !== null,
                        }))
                )
            `,
            returnByValue: true,
        });

        try {
            return JSON.parse(result.result?.value as string) as ElementInfo[];
        } catch {
            return [];
        }
    }

    async click(selector: string): Promise<void> {
        await this.evaluate<void>(
            `document.querySelector(${JSON.stringify(selector)})?.click()`,
        );
    }

    async type(selector: string, text: string): Promise<void> {
        await this.evaluate<void>(
            `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`,
        );
    }

    async title(): Promise<string> {
        return this.evaluate<string>('document.title');
    }

    url(): string {
        return this.currentUrl;
    }

    async close(): Promise<void> {
        try {
            await this.client.close();
        } catch {
            // Ignore close errors
        }
    }
}
