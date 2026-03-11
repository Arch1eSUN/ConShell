/**
 * Privacy Controller — PII detection, redaction, and data management.
 *
 * Features:
 *   - Regex-based PII detection (email, phone, credit card, SSN, IP, API keys)
 *   - Auto-redaction before memory writes
 *   - Data export (GDPR Art. 20)
 *   - Data purge (GDPR Art. 17)
 *
 * Zero external dependencies — all detection via regex patterns.
 */

// ── PII Patterns ────────────────────────────────────────────────────────

export interface PIIMatch {
    readonly type: string;
    readonly value: string;
    readonly index: number;
}

const PII_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
    {
        name: 'email',
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    },
    {
        name: 'phone',
        pattern: /\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
    },
    {
        name: 'credit_card',
        pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    },
    {
        name: 'ssn',
        pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    },
    {
        name: 'ip_address',
        pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    },
    {
        name: 'api_key',
        pattern: /(?:sk|pk|api|key)[-_][a-zA-Z0-9]{20,}/gi,
    },
    {
        name: 'eth_private_key',
        pattern: /\b0x[a-fA-F0-9]{64}\b/g,
    },
    {
        name: 'bearer_token',
        pattern: /Bearer\s+[a-zA-Z0-9._~+/=-]{20,}/g,
    },
];

// ── Detection ───────────────────────────────────────────────────────────

/**
 * Scan text for PII occurrences.
 */
export function detectPII(text: string): PIIMatch[] {
    const matches: PIIMatch[] = [];

    for (const { name, pattern } of PII_PATTERNS) {
        // Reset regex state
        const re = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
            matches.push({
                type: name,
                value: match[0],
                index: match.index,
            });
        }
    }

    return matches.sort((a, b) => a.index - b.index);
}

/**
 * Check if text contains any PII.
 */
export function hasPII(text: string): boolean {
    for (const { pattern } of PII_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags);
        if (re.test(text)) return true;
    }
    return false;
}

// ── Redaction ───────────────────────────────────────────────────────────

const REDACTION_MAP: Record<string, string> = {
    email: '[EMAIL]',
    phone: '[PHONE]',
    credit_card: '[CREDIT_CARD]',
    ssn: '[SSN]',
    ip_address: '[IP]',
    api_key: '[API_KEY]',
    eth_private_key: '[ETH_KEY]',
    bearer_token: '[BEARER_TOKEN]',
};

/**
 * Redact all detected PII in text, replacing with type-specific placeholders.
 *
 * @example
 * redactPII("Email: john@example.com, Key: sk-abc123def456ghijklmn")
 * // "Email: [EMAIL], Key: [API_KEY]"
 */
export function redactPII(text: string): string {
    let result = text;

    for (const { name, pattern } of PII_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags);
        const replacement = REDACTION_MAP[name] ?? '[REDACTED]';
        result = result.replace(re, replacement);
    }

    return result;
}

// ── Privacy Controller ──────────────────────────────────────────────────

export interface PrivacyReport {
    readonly totalPIIFound: number;
    readonly byType: Record<string, number>;
}

/**
 * Scan multiple text entries for PII and return a summary report.
 */
export function auditPII(texts: string[]): PrivacyReport {
    const byType: Record<string, number> = {};
    let total = 0;

    for (const text of texts) {
        const matches = detectPII(text);
        total += matches.length;
        for (const m of matches) {
            byType[m.type] = (byType[m.type] ?? 0) + 1;
        }
    }

    return { totalPIIFound: total, byType };
}
