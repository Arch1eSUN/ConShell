/**
 * HTTP Tools — Make arbitrary HTTP requests.
 *
 * Requires: internet_access capability
 */
import type { ToolDefinition } from '@conshell/core';
import type { ToolHandler } from './web-tools.js';

// ── Tool Definitions ────────────────────────────────────────────────────

export const httpRequestDefinition: ToolDefinition = {
    name: 'http_request',
    category: 'http',
    description: 'Make an HTTP request (GET/POST/PUT/DELETE) and return the response.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Request URL' },
            method: { type: 'string', description: 'HTTP method (default GET)' },
            headers: { type: 'object', description: 'Request headers (optional)' },
            body: { type: 'string', description: 'Request body for POST/PUT (optional)' },
            timeout: { type: 'number', description: 'Timeout in ms (default 15000)' },
        },
        required: ['url'],
    },
    riskLevel: 'caution',
    requiredAuthority: 'self',
    mcpExposed: true,
    auditFields: ['url', 'method'],
    requiredCapabilities: ['internet_access'],
};

export const HTTP_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    httpRequestDefinition,
];

// ── Handlers ────────────────────────────────────────────────────────────

const httpRequestHandler: ToolHandler = async (args) => {
    const url = args['url'] as string;
    const method = ((args['method'] as string) ?? 'GET').toUpperCase();
    const headers = (args['headers'] as Record<string, string>) ?? {};
    const body = args['body'] as string | undefined;
    const timeout = (args['timeout'] as number) ?? 15000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            method,
            headers,
            body: body && ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
            signal: controller.signal,
        });

        const contentType = response.headers.get('content-type') ?? '';
        let responseBody: string;

        if (contentType.includes('application/json')) {
            const json = await response.json();
            responseBody = JSON.stringify(json);
        } else {
            responseBody = await response.text();
        }

        // Truncate large responses
        const maxLen = 16000;
        const truncated = responseBody.length > maxLen;

        return JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            contentType,
            body: responseBody.slice(0, maxLen),
            bodyLength: responseBody.length,
            truncated,
        });
    } finally {
        clearTimeout(timer);
    }
};

export const HTTP_TOOL_HANDLERS: ReadonlyMap<string, ToolHandler> = new Map([
    ['http_request', httpRequestHandler],
]);
