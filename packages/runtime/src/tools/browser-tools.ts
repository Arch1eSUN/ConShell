/**
 * Browser Tools — Playwright-based browser automation for autonomous operation.
 *
 * Requires: browser_control capability
 *
 * NOTE: Playwright is an optional peer dependency. If not installed,
 * these handlers will return error messages guiding the user to install it.
 */
import type { ToolDefinition } from '@web4-agent/core';
import type { ToolHandler } from './web-tools.js';

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

// ── Handlers ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeBrowser: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activePage: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureBrowser(): Promise<{ browser: any; page: any }> {
    if (activeBrowser && activePage) {
        return { browser: activeBrowser, page: activePage };
    }
    try {
        // Dynamic import to make playwright optional
        const pw = await import('playwright' as string);
        const browser = await pw.chromium.launch({ headless: true });
        const page = await browser.newPage();
        activeBrowser = browser;
        activePage = page;
        return { browser, page };
    } catch {
        throw new Error('Playwright is not installed. Run: pnpm add playwright');
    }
}

const browserOpenHandler: ToolHandler = async (args) => {
    const url = args['url'] as string;
    const waitFor = (args['waitFor'] as number) ?? 3000;
    const { page } = await ensureBrowser();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(waitFor);
    const text = await page.evaluate(() => (globalThis as any).document.body.innerText);
    const title = await page.title();
    return JSON.stringify({ title, url, textLength: text.length, text: text.slice(0, 8000) });
};

const browserClickHandler: ToolHandler = async (args) => {
    const selector = args['selector'] as string;
    const { page } = await ensureBrowser();
    await page.click(selector, { timeout: 5000 });
    return JSON.stringify({ clicked: selector, success: true });
};

const browserTypeHandler: ToolHandler = async (args) => {
    const selector = args['selector'] as string;
    const text = args['text'] as string;
    const { page } = await ensureBrowser();
    await page.fill(selector, text, { timeout: 5000 });
    return JSON.stringify({ typed: selector, textLength: text.length, success: true });
};

const browserScreenshotHandler: ToolHandler = async (args) => {
    const fullPage = (args['fullPage'] as boolean) ?? false;
    const { page } = await ensureBrowser();
    const buffer = await page.screenshot({ fullPage, type: 'png' });
    const base64 = buffer.toString('base64');
    return JSON.stringify({ format: 'png', base64Length: base64.length, base64: base64.slice(0, 4000) + '...' });
};

const browserNavigateHandler: ToolHandler = async (args) => {
    const url = args['url'] as string;
    const waitFor = (args['waitFor'] as number) ?? 2000;
    const { page } = await ensureBrowser();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(waitFor);
    const title = await page.title();
    return JSON.stringify({ navigated: url, title, success: true });
};

export const BROWSER_TOOL_HANDLERS: ReadonlyMap<string, ToolHandler> = new Map([
    ['browser_open', browserOpenHandler],
    ['browser_click', browserClickHandler],
    ['browser_type', browserTypeHandler],
    ['browser_screenshot', browserScreenshotHandler],
    ['browser_navigate', browserNavigateHandler],
]);
