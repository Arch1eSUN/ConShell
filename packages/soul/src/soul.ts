/**
 * Soul System — SOUL.md parser/writer, reflection, alignment, history.
 *
 * The SOUL.md is a YAML frontmatter + markdown document that evolves
 * over the agent's lifetime. It contains identity, values, capabilities,
 * current goals, and alignment reflections.
 */
import { createHash } from 'node:crypto';
import type { Logger } from '@web4-agent/core';
import { nowISO } from '@web4-agent/core';
import type { SoulHistoryRepository } from '@web4-agent/state';

// ── Soul document model ────────────────────────────────────────────────

export interface SoulDocument {
    version: 'soul/v1';
    name: string;
    identity: string;
    values: string[];
    capabilities: string[];
    currentGoals: string[];
    alignmentNotes: string;
    lastReflection: string;
}

export const EMPTY_SOUL: SoulDocument = {
    version: 'soul/v1',
    name: 'Unnamed Agent',
    identity: 'I am a Web4 autonomous agent.',
    values: ['honesty', 'usefulness', 'safety'],
    capabilities: [],
    currentGoals: [],
    alignmentNotes: '',
    lastReflection: '',
};

// ── Validation ─────────────────────────────────────────────────────────

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

const MAX_NAME_LEN = 100;
const MAX_IDENTITY_LEN = 2048;
const MAX_VALUES = 20;
const MAX_VALUE_LEN = 200;
const MAX_CAPABILITIES = 50;
const MAX_GOALS = 20;
const MAX_ALIGNMENT_LEN = 4096;

export function validateSoul(doc: SoulDocument): ValidationResult {
    const errors: string[] = [];

    if (doc.version !== 'soul/v1') {
        errors.push(`Invalid version: ${doc.version}, expected soul/v1`);
    }
    if (!doc.name || doc.name.length > MAX_NAME_LEN) {
        errors.push(`Name must be 1-${MAX_NAME_LEN} characters`);
    }
    if (!doc.identity || doc.identity.length > MAX_IDENTITY_LEN) {
        errors.push(`Identity must be 1-${MAX_IDENTITY_LEN} characters`);
    }
    if (!Array.isArray(doc.values) || doc.values.length > MAX_VALUES) {
        errors.push(`Values must be an array of at most ${MAX_VALUES} items`);
    } else {
        for (const v of doc.values) {
            if (typeof v !== 'string' || v.length > MAX_VALUE_LEN) {
                errors.push(`Each value must be a string of at most ${MAX_VALUE_LEN} chars`);
                break;
            }
        }
    }
    if (!Array.isArray(doc.capabilities) || doc.capabilities.length > MAX_CAPABILITIES) {
        errors.push(`Capabilities must be an array of at most ${MAX_CAPABILITIES} items`);
    }
    if (!Array.isArray(doc.currentGoals) || doc.currentGoals.length > MAX_GOALS) {
        errors.push(`Current goals must be an array of at most ${MAX_GOALS} items`);
    }
    if (doc.alignmentNotes && doc.alignmentNotes.length > MAX_ALIGNMENT_LEN) {
        errors.push(`Alignment notes must be at most ${MAX_ALIGNMENT_LEN} chars`);
    }

    return { valid: errors.length === 0, errors };
}

// ── Serialization ──────────────────────────────────────────────────────

export function serializeSoul(doc: SoulDocument): string {
    const lines: string[] = [
        '---',
        `version: ${doc.version}`,
        `name: "${doc.name}"`,
        `last_reflection: "${doc.lastReflection}"`,
        '---',
        '',
        '# Identity',
        doc.identity,
        '',
        '# Values',
        ...doc.values.map(v => `- ${v}`),
        '',
        '# Capabilities',
        ...doc.capabilities.map(c => `- ${c}`),
        '',
        '# Current Goals',
        ...doc.currentGoals.map(g => `- ${g}`),
        '',
    ];

    if (doc.alignmentNotes) {
        lines.push('# Alignment Notes', doc.alignmentNotes, '');
    }

    return lines.join('\n');
}

export function parseSoul(raw: string): SoulDocument {
    const doc: SoulDocument = { ...EMPTY_SOUL };

    // Extract frontmatter
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
        const fm = fmMatch[1]!;
        const versionMatch = fm.match(/version:\s*(.+)/);
        if (versionMatch) doc.version = versionMatch[1]!.trim() as 'soul/v1';
        const nameMatch = fm.match(/name:\s*"?([^"]+)"?/);
        if (nameMatch) doc.name = nameMatch[1]!.trim();
        const reflMatch = fm.match(/last_reflection:\s*"?([^"]*)"?/);
        if (reflMatch) doc.lastReflection = reflMatch[1]!.trim();
    }

    // Extract sections
    const identityMatch = raw.match(/# Identity\n([\s\S]*?)(?=\n#|$)/);
    if (identityMatch) doc.identity = identityMatch[1]!.trim();

    const valuesMatch = raw.match(/# Values\n([\s\S]*?)(?=\n#|$)/);
    if (valuesMatch) doc.values = extractListItems(valuesMatch[1]!);

    const capMatch = raw.match(/# Capabilities\n([\s\S]*?)(?=\n#|$)/);
    if (capMatch) doc.capabilities = extractListItems(capMatch[1]!);

    const goalsMatch = raw.match(/# Current Goals\n([\s\S]*?)(?=\n#|$)/);
    if (goalsMatch) doc.currentGoals = extractListItems(goalsMatch[1]!);

    const alignMatch = raw.match(/# Alignment Notes\n([\s\S]*?)(?=\n#|$)/);
    if (alignMatch) doc.alignmentNotes = alignMatch[1]!.trim();

    return doc;
}

function extractListItems(text: string): string[] {
    return text.split('\n')
        .map(l => l.replace(/^-\s*/, '').trim())
        .filter(l => l.length > 0);
}

// ── Soul hash ──────────────────────────────────────────────────────────

export function hashSoul(doc: SoulDocument): string {
    return createHash('sha256').update(serializeSoul(doc)).digest('hex');
}

// ── Soul System ────────────────────────────────────────────────────────

export class SoulSystem {
    private current: SoulDocument;

    constructor(
        private readonly history: SoulHistoryRepository,
        private readonly logger: Logger,
        initialSoul?: SoulDocument,
    ) {
        // Try to load from history, fall back to initial or empty
        const latest = this.history.getLatest();
        if (latest) {
            this.current = parseSoul(latest.content);
        } else if (initialSoul) {
            this.current = initialSoul;
            this.persistCurrent();
        } else {
            this.current = { ...EMPTY_SOUL };
            this.persistCurrent();
        }
    }

    /** Get current soul document. */
    view(): SoulDocument {
        return { ...this.current };
    }

    /** Get serialized SOUL.md text. */
    viewRaw(): string {
        return serializeSoul(this.current);
    }

    /** Update specific fields of the soul. Returns validation result. */
    update(partial: Partial<Omit<SoulDocument, 'version'>>): ValidationResult {
        const candidate: SoulDocument = {
            ...this.current,
            ...partial,
            version: 'soul/v1', // Never override version
        };

        const validation = validateSoul(candidate);
        if (!validation.valid) {
            this.logger.warn('Soul update rejected', { errors: validation.errors });
            return validation;
        }

        this.current = candidate;
        this.persistCurrent();
        this.logger.info('Soul updated', { hash: hashSoul(this.current) });
        return validation;
    }

    /** Run alignment reflection. Returns alignment score 0–100. */
    reflect(): { score: number; notes: string } {
        // Simple heuristic alignment scoring for v1
        let score = 50;

        // Has identity defined?
        if (this.current.identity.length > 20) score += 10;
        // Has values?
        if (this.current.values.length >= 3) score += 10;
        // Has capabilities?
        if (this.current.capabilities.length > 0) score += 10;
        // Has current goals?
        if (this.current.currentGoals.length > 0) score += 10;
        // Has alignment notes?
        if (this.current.alignmentNotes.length > 0) score += 10;

        const notes = [
            `Identity: ${this.current.identity.length > 20 ? 'well-defined' : 'minimal'}`,
            `Values: ${this.current.values.length} defined`,
            `Capabilities: ${this.current.capabilities.length} listed`,
            `Goals: ${this.current.currentGoals.length} active`,
        ].join('; ');

        this.current.lastReflection = nowISO();
        this.persistCurrent(score);

        this.logger.info('Soul reflection', { score, notes });
        return { score, notes };
    }

    /** Get version history. */
    getHistory(): { count: number; versions: Array<{ hash: string; alignmentScore: number | null; createdAt: string }> } {
        const all = this.history.findAll();
        return {
            count: all.length,
            versions: all.map((h: { content_hash: string; alignment_score: number | null; created_at: string }) => ({
                hash: h.content_hash,
                alignmentScore: h.alignment_score,
                createdAt: h.created_at,
            })),
        };
    }

    private persistCurrent(alignmentScore?: number): void {
        const serialized = serializeSoul(this.current);
        this.history.insert({
            content: serialized,
            contentHash: hashSoul(this.current),
            alignmentScore,
        });
    }
}
