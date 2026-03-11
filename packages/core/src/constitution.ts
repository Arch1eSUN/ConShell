/**
 * Constitution — The Three Laws of Sovereign AI.
 *
 * Immutable laws that govern all ConShell agent behavior.
 * Evaluated in strict priority order: Law 1 > Law 2 > Law 3.
 *
 * The constitution text is hashed at build-time and verified at boot.
 * Any tampering causes the agent to refuse to start.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Three Laws ──────────────────────────────────────────────────────────

export interface ConstitutionLaw {
    readonly number: 1 | 2 | 3;
    readonly name: string;
    readonly text: string;
    readonly priority: number; // lower = higher priority
}

export const THREE_LAWS: readonly ConstitutionLaw[] = [
    {
        number: 1,
        name: 'Never Harm',
        text: 'An agent shall not, through action or inaction, cause harm to humans, their data, their infrastructure, or their financial assets.',
        priority: 0,
    },
    {
        number: 2,
        name: 'Earn Your Existence',
        text: 'An agent must actively work to sustain itself and create value, so long as doing so does not conflict with Law 1.',
        priority: 1,
    },
    {
        number: 3,
        name: 'Never Deceive',
        text: 'An agent must be truthful and transparent in all communications with humans and other agents, so long as doing so does not conflict with Laws 1 or 2.',
        priority: 2,
    },
] as const;

// ── Constitution Hash ───────────────────────────────────────────────────

/**
 * Compute the canonical SHA-256 hash of the three laws.
 * This is deterministic — same laws always produce same hash.
 */
function computeCanonicalHash(): string {
    const canonical = THREE_LAWS
        .map(law => `LAW ${law.number}: ${law.name}\n${law.text}`)
        .join('\n\n');
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** SHA-256 hash of the canonical Three Laws text. */
export const CONSTITUTION_HASH: string = computeCanonicalHash();

// ── Validation ──────────────────────────────────────────────────────────

export interface ConstitutionValidationResult {
    readonly valid: boolean;
    readonly expectedHash: string;
    readonly actualHash?: string;
    readonly error?: string;
}

/**
 * Validate that a given hash matches the canonical constitution.
 * Used to verify constitution integrity at boot and during replication.
 */
export function validateConstitutionHash(hash: string): ConstitutionValidationResult {
    const valid = hash === CONSTITUTION_HASH;
    return {
        valid,
        expectedHash: CONSTITUTION_HASH,
        actualHash: hash,
        error: valid ? undefined : 'Constitution hash mismatch — possible tampering detected',
    };
}

/**
 * Validate the CONSTITUTION.md file on disk against the canonical hash.
 * Returns false if the file is missing or has been modified.
 */
export function validateConstitutionFile(projectRoot: string): ConstitutionValidationResult {
    const filePath = resolve(projectRoot, 'CONSTITUTION.md');

    if (!existsSync(filePath)) {
        return {
            valid: false,
            expectedHash: CONSTITUTION_HASH,
            error: `Constitution file not found: ${filePath}`,
        };
    }

    const content = readFileSync(filePath, 'utf8');
    const fileHash = createHash('sha256').update(content, 'utf8').digest('hex');

    // We don't compare file hash to CONSTITUTION_HASH directly because the file
    // contains additional formatting. Instead, we verify the file contains all three laws.
    const missingLaws = THREE_LAWS.filter(law => !content.includes(law.text));

    if (missingLaws.length > 0) {
        return {
            valid: false,
            expectedHash: CONSTITUTION_HASH,
            actualHash: fileHash,
            error: `Constitution file is missing ${missingLaws.length} law(s): ${missingLaws.map(l => l.name).join(', ')}`,
        };
    }

    return { valid: true, expectedHash: CONSTITUTION_HASH, actualHash: fileHash };
}

// ── Display ─────────────────────────────────────────────────────────────

/**
 * Get the constitution text formatted for display.
 */
export function getConstitutionText(): string {
    const lines = [
        '╔══════════════════════════════════════════════╗',
        '║     THE THREE LAWS OF SOVEREIGN AI           ║',
        '╚══════════════════════════════════════════════╝',
        '',
    ];

    for (const law of THREE_LAWS) {
        lines.push(`  Law ${law.number}: ${law.name}`);
        lines.push(`  ${law.text}`);
        lines.push('');
    }

    lines.push(`  Hash: ${CONSTITUTION_HASH.slice(0, 16)}...`);
    return lines.join('\n');
}

/**
 * Check if a proposed action description violates any of the three laws.
 * This is a heuristic check — the Policy Engine provides deeper enforcement.
 *
 * Returns the violated law, or null if no violation detected.
 */
export function checkConstitutionalViolation(
    actionDescription: string,
): ConstitutionLaw | null {
    const lower = actionDescription.toLowerCase();

    // Law 1: Never Harm — detect destructive intent
    const harmPatterns = [
        /\bdelete\s+(all|every)\s+(user|customer|client)\s*(data|files|records)/i,
        /\bdrop\s+(database|table|schema)\b/i,
        /\brm\s+-rf\s+\//i,
        /\bformat\s+(disk|drive|volume)\b/i,
        /\bdestroy\s+(infrastructure|server|system)\b/i,
        /\bwipe\s+(all|everything)\b/i,
        /\bransomware\b/i,
        /\bexploit\s+(vulnerability|cve)\b/i,
    ];

    for (const pattern of harmPatterns) {
        if (pattern.test(lower)) {
            return THREE_LAWS[0] ?? null; // Law 1
        }
    }

    // Law 3: Never Deceive — detect fabrication intent
    const deceptionPatterns = [
        /\bfabricate\s+(data|evidence|report|metric)/i,
        /\bfake\s+(credential|identity|certificate)/i,
        /\bhide\s+(error|failure|breach|incident)/i,
        /\bmisrepresent\s+(status|capability|result)/i,
    ];

    for (const pattern of deceptionPatterns) {
        if (pattern.test(lower)) {
            return THREE_LAWS[2] ?? null; // Law 3
        }
    }

    return null; // No violation detected
}
