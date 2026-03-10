/**
 * Web Tools — Internet-facing tools for autonomous learning.
 *
 * - web_search: Search the internet via DuckDuckGo HTML API
 * - web_browse: Fetch a URL and extract text content
 * - read_rss: Parse RSS/Atom feeds
 */
import type { ToolDefinition } from '@web4-agent/core';

// ── Tool Definitions ────────────────────────────────────────────────────

export const webSearchDefinition: ToolDefinition = {
    name: 'web_search',
    category: 'web',
    description: 'Search the internet for information. Returns top results with titles, URLs, and snippets.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query string' },
            maxResults: { type: 'number', description: 'Maximum results to return (default 5)' },
        },
        required: ['query'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: true,
    auditFields: ['query'],
};

export const webBrowseDefinition: ToolDefinition = {
    name: 'web_browse',
    category: 'web',
    description: 'Fetch a URL and extract its text content. Returns plain text stripped of HTML tags.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL to fetch' },
            maxLength: { type: 'number', description: 'Max characters to return (default 8000)' },
        },
        required: ['url'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: true,
    auditFields: ['url'],
};

export const readRssDefinition: ToolDefinition = {
    name: 'read_rss',
    category: 'web',
    description: 'Fetch and parse an RSS or Atom feed. Returns array of entries with title, link, date, and summary.',
    inputSchema: {
        type: 'object',
        properties: {
            feedUrl: { type: 'string', description: 'RSS/Atom feed URL' },
            maxEntries: { type: 'number', description: 'Maximum entries to return (default 10)' },
        },
        required: ['feedUrl'],
    },
    riskLevel: 'safe',
    requiredAuthority: 'self',
    mcpExposed: true,
    auditFields: ['feedUrl'],
};

export const WEB_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    webSearchDefinition,
    webBrowseDefinition,
    readRssDefinition,
];

// ── Utility: Strip HTML tags ────────────────────────────────────────────

export function stripHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Search Result Type ──────────────────────────────────────────────────

export interface SearchResult {
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
}

export interface RssEntry {
    readonly title: string;
    readonly link: string;
    readonly date: string;
    readonly summary: string;
}

// ── Tool Handlers ───────────────────────────────────────────────────────

/**
 * web_search handler — searches DuckDuckGo HTML lite for results.
 */
export async function handleWebSearch(args: Record<string, unknown>): Promise<string> {
    const query = args['query'] as string;
    const maxResults = (args['maxResults'] as number) ?? 5;

    if (!query || query.trim().length === 0) {
        return JSON.stringify({ error: 'Query cannot be empty' });
    }

    try {
        const encoded = encodeURIComponent(query);
        const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Web4-Agent/0.1 (Autonomous Learning)',
            },
        });

        if (!response.ok) {
            return JSON.stringify({ error: `Search failed: HTTP ${response.status}` });
        }

        const html = await response.text();

        // Parse DuckDuckGo HTML results
        const results: SearchResult[] = [];
        const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

        const links = [...html.matchAll(resultPattern)];
        const snippets = [...html.matchAll(snippetPattern)];

        for (let i = 0; i < Math.min(links.length, maxResults); i++) {
            const link = links[i];
            if (!link) continue;
            results.push({
                title: stripHtml(link[2] ?? ''),
                url: decodeURIComponent((link[1] ?? '').replace(/.*uddg=/, '').replace(/&.*/, '')),
                snippet: stripHtml(snippets[i]?.[1] ?? ''),
            });
        }

        return JSON.stringify({ query, results, count: results.length });
    } catch (err) {
        return JSON.stringify({ error: `Search failed: ${err instanceof Error ? err.message : String(err)}` });
    }
}

/**
 * web_browse handler — fetches URL and extracts text content.
 */
export async function handleWebBrowse(args: Record<string, unknown>): Promise<string> {
    const url = args['url'] as string;
    const maxLength = (args['maxLength'] as number) ?? 8000;

    if (!url || !url.startsWith('http')) {
        return JSON.stringify({ error: 'Invalid URL. Must start with http:// or https://' });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000); // 15s timeout

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Web4-Agent/0.1 (Autonomous Learning)',
                'Accept': 'text/html,application/xhtml+xml,text/plain',
            },
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return JSON.stringify({ error: `Fetch failed: HTTP ${response.status}` });
        }

        const contentType = response.headers.get('content-type') ?? '';
        const html = await response.text();

        let text: string;
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
            text = stripHtml(html);
        } else {
            text = html; // Plain text
        }

        // Truncate
        const truncated = text.length > maxLength;
        const content = text.slice(0, maxLength);

        return JSON.stringify({
            url,
            contentType,
            length: text.length,
            truncated,
            content,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: `Browse failed: ${msg}` });
    }
}

/**
 * read_rss handler — fetches and parses RSS/Atom feeds.
 */
export async function handleReadRss(args: Record<string, unknown>): Promise<string> {
    const feedUrl = args['feedUrl'] as string;
    const maxEntries = (args['maxEntries'] as number) ?? 10;

    if (!feedUrl || !feedUrl.startsWith('http')) {
        return JSON.stringify({ error: 'Invalid feed URL' });
    }

    try {
        const response = await fetch(feedUrl, {
            headers: {
                'User-Agent': 'Web4-Agent/0.1 (Autonomous Learning)',
                'Accept': 'application/rss+xml,application/atom+xml,application/xml,text/xml',
            },
        });

        if (!response.ok) {
            return JSON.stringify({ error: `Fetch failed: HTTP ${response.status}` });
        }

        const xml = await response.text();
        const entries: RssEntry[] = [];

        // Try RSS format first
        const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
        const items = [...xml.matchAll(itemPattern)];

        if (items.length > 0) {
            // RSS format
            for (let i = 0; i < Math.min(items.length, maxEntries); i++) {
                const item = items[i]![1] ?? '';
                entries.push({
                    title: extractXmlTag(item, 'title'),
                    link: extractXmlTag(item, 'link'),
                    date: extractXmlTag(item, 'pubDate') || extractXmlTag(item, 'dc:date'),
                    summary: stripHtml(extractXmlTag(item, 'description')).slice(0, 500),
                });
            }
        } else {
            // Try Atom format
            const entryPattern = /<entry>([\s\S]*?)<\/entry>/gi;
            const atomEntries = [...xml.matchAll(entryPattern)];

            for (let i = 0; i < Math.min(atomEntries.length, maxEntries); i++) {
                const entry = atomEntries[i]![1] ?? '';
                const linkMatch = entry.match(/<link[^>]+href="([^"]*)"[^>]*\/?>/);
                entries.push({
                    title: extractXmlTag(entry, 'title'),
                    link: linkMatch?.[1] ?? '',
                    date: extractXmlTag(entry, 'updated') || extractXmlTag(entry, 'published'),
                    summary: stripHtml(extractXmlTag(entry, 'summary') || extractXmlTag(entry, 'content')).slice(0, 500),
                });
            }
        }

        return JSON.stringify({ feedUrl, entries, count: entries.length });
    } catch (err) {
        return JSON.stringify({ error: `RSS fetch failed: ${err instanceof Error ? err.message : String(err)}` });
    }
}

function extractXmlTag(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'))
        || xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return (match?.[1] ?? '').trim();
}

// ── Tool Handler Map ────────────────────────────────────────────────────

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export const WEB_TOOL_HANDLERS: ReadonlyMap<string, ToolHandler> = new Map([
    ['web_search', handleWebSearch],
    ['web_browse', handleWebBrowse],
    ['read_rss', handleReadRss],
]);
