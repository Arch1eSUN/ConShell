/**
 * Skill Marketplace — Backend CRUD for skill discovery, install, publish, and rating.
 *
 * Features:
 * - Local skill registry (SQLite-backed)
 * - Install/uninstall skills
 * - Publish skills (serialize to JSON)
 * - Search/filter skills
 * - Rating + review system
 *
 * Conway equivalent: skill_marketplace + skill_registry
 */
import type { Logger } from '@conshell/core';

// ── Types ──────────────────────────────────────────────────────────────

export interface Skill {
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly author: string;
    readonly category: SkillCategory;
    readonly triggers: readonly string[];
    readonly content: string;
    readonly source: SkillSource;
    readonly rating: number;
    readonly ratingCount: number;
    readonly downloads: number;
    readonly installedAt?: string;
    readonly publishedAt?: string;
}

export type SkillCategory =
    | 'automation'
    | 'analysis'
    | 'communication'
    | 'development'
    | 'finance'
    | 'security'
    | 'utility'
    | 'ai'
    | 'other';

export type SkillSource = 'local' | 'marketplace' | 'peer' | 'builtin';

export interface SkillSearchQuery {
    readonly keyword?: string;
    readonly category?: SkillCategory;
    readonly source?: SkillSource;
    readonly minRating?: number;
    readonly sortBy?: 'name' | 'rating' | 'downloads' | 'installedAt';
    readonly limit?: number;
    readonly offset?: number;
}

export interface SkillReview {
    readonly skillName: string;
    readonly rating: number; // 1-5
    readonly comment?: string;
    readonly reviewerAddress?: string;
    readonly createdAt: string;
}

export interface SkillPublishRequest {
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly author: string;
    readonly category: SkillCategory;
    readonly triggers: readonly string[];
    readonly content: string;
}

export interface SkillInstallResult {
    readonly success: boolean;
    readonly skill: Skill;
    readonly message: string;
}

// ── Dependencies ───────────────────────────────────────────────────────

export interface SkillMarketplaceDeps {
    /** Database query executor. */
    query: (sql: string, params?: unknown[]) => unknown[];
    /** Database run executor. */
    run: (sql: string, params?: unknown[]) => void;
}

// ── Skill Marketplace ──────────────────────────────────────────────────

export class SkillMarketplace {
    private readonly logger: Logger;
    private readonly deps: SkillMarketplaceDeps;

    constructor(logger: Logger, deps: SkillMarketplaceDeps) {
        this.logger = logger;
        this.deps = deps;
        this.ensureTables();
    }

    // ── Install / Uninstall ─────────────────────────────────────────────

    install(skill: SkillPublishRequest): SkillInstallResult {
        const now = new Date().toISOString();
        this.deps.run(
            `INSERT OR REPLACE INTO skills (name, version, description, author, category, triggers_json, content, source, rating, rating_count, downloads, installed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'marketplace', 0, 0, 0, ?)`,
            [skill.name, skill.version, skill.description, skill.author, skill.category, JSON.stringify(skill.triggers), skill.content, now],
        );

        this.logger.info('Skill installed', { name: skill.name, version: skill.version });

        return {
            success: true,
            skill: { ...skill, source: 'marketplace', rating: 0, ratingCount: 0, downloads: 0, installedAt: now },
            message: `Skill "${skill.name}" v${skill.version} installed successfully.`,
        };
    }

    uninstall(name: string): boolean {
        this.deps.run('DELETE FROM skills WHERE name = ?', [name]);
        this.logger.info('Skill uninstalled', { name });
        return true;
    }

    // ── Search / Get ────────────────────────────────────────────────────

    search(query: SkillSearchQuery): readonly Skill[] {
        const conditions: string[] = ['1=1'];
        const params: unknown[] = [];

        if (query.keyword) {
            conditions.push('(name LIKE ? OR description LIKE ?)');
            params.push(`%${query.keyword}%`, `%${query.keyword}%`);
        }
        if (query.category) {
            conditions.push('category = ?');
            params.push(query.category);
        }
        if (query.source) {
            conditions.push('source = ?');
            params.push(query.source);
        }
        if (query.minRating !== undefined) {
            conditions.push('rating >= ?');
            params.push(query.minRating);
        }

        const sortMap: Record<string, string> = {
            name: 'name ASC',
            rating: 'rating DESC',
            downloads: 'downloads DESC',
            installedAt: 'installed_at DESC',
        };
        const orderBy = sortMap[query.sortBy ?? 'name'] ?? 'name ASC';
        const limit = query.limit ?? 50;
        const offset = query.offset ?? 0;

        const sql = `SELECT * FROM skills WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const rows = this.deps.query(sql, params) as Array<Record<string, unknown>>;
        return rows.map(this.rowToSkill);
    }

    get(name: string): Skill | null {
        const rows = this.deps.query('SELECT * FROM skills WHERE name = ?', [name]) as Array<Record<string, unknown>>;
        if (rows.length === 0) return null;
        return this.rowToSkill(rows[0]!);
    }

    listInstalled(): readonly Skill[] {
        const rows = this.deps.query('SELECT * FROM skills WHERE installed_at IS NOT NULL ORDER BY installed_at DESC', []) as Array<Record<string, unknown>>;
        return rows.map(this.rowToSkill);
    }

    // ── Publish ─────────────────────────────────────────────────────────

    publish(request: SkillPublishRequest): Skill {
        const now = new Date().toISOString();
        this.deps.run(
            `INSERT OR REPLACE INTO skills (name, version, description, author, category, triggers_json, content, source, rating, rating_count, downloads, installed_at, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'local', 0, 0, 0, ?, ?)`,
            [request.name, request.version, request.description, request.author, request.category, JSON.stringify(request.triggers), request.content, now, now],
        );

        this.logger.info('Skill published', { name: request.name });
        return {
            ...request,
            source: 'local',
            rating: 0,
            ratingCount: 0,
            downloads: 0,
            installedAt: now,
            publishedAt: now,
        };
    }

    // ── Rating ──────────────────────────────────────────────────────────

    rate(review: SkillReview): boolean {
        const skill = this.get(review.skillName);
        if (!skill) return false;

        // Recalculate average rating
        const newCount = skill.ratingCount + 1;
        const newRating = ((skill.rating * skill.ratingCount) + review.rating) / newCount;

        this.deps.run(
            'UPDATE skills SET rating = ?, rating_count = ? WHERE name = ?',
            [Math.round(newRating * 10) / 10, newCount, review.skillName],
        );

        // Store review
        this.deps.run(
            `INSERT INTO skill_reviews (skill_name, rating, comment, reviewer_address, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [review.skillName, review.rating, review.comment ?? '', review.reviewerAddress ?? 'anonymous', review.createdAt],
        );

        this.logger.info('Skill rated', { name: review.skillName, rating: review.rating });
        return true;
    }

    getReviews(skillName: string, limit = 20): readonly SkillReview[] {
        const rows = this.deps.query(
            'SELECT * FROM skill_reviews WHERE skill_name = ? ORDER BY created_at DESC LIMIT ?',
            [skillName, limit],
        ) as Array<Record<string, unknown>>;

        return rows.map(r => ({
            skillName: String(r['skill_name']),
            rating: Number(r['rating']),
            comment: r['comment'] ? String(r['comment']) : undefined,
            reviewerAddress: r['reviewer_address'] ? String(r['reviewer_address']) : undefined,
            createdAt: String(r['created_at']),
        }));
    }

    // ── Stats ───────────────────────────────────────────────────────────

    get totalSkills(): number {
        const rows = this.deps.query('SELECT COUNT(*) as cnt FROM skills', []) as Array<{ cnt: number }>;
        return rows[0]?.cnt ?? 0;
    }

    getCategories(): readonly { category: string; count: number }[] {
        const rows = this.deps.query(
            'SELECT category, COUNT(*) as cnt FROM skills GROUP BY category ORDER BY cnt DESC',
            [],
        ) as Array<{ category: string; cnt: number }>;
        return rows.map(r => ({ category: r.category, count: r.cnt }));
    }

    // ── Private helpers ─────────────────────────────────────────────────

    private ensureTables(): void {
        this.deps.run(`
            CREATE TABLE IF NOT EXISTS skills (
                name           TEXT PRIMARY KEY,
                version        TEXT NOT NULL DEFAULT '1.0.0',
                description    TEXT,
                author         TEXT,
                category       TEXT NOT NULL DEFAULT 'utility',
                triggers_json  TEXT,
                content        TEXT NOT NULL,
                source         TEXT NOT NULL DEFAULT 'local',
                rating         REAL NOT NULL DEFAULT 0,
                rating_count   INTEGER NOT NULL DEFAULT 0,
                downloads      INTEGER NOT NULL DEFAULT 0,
                installed_at   TEXT,
                published_at   TEXT
            )
        `);

        this.deps.run(`
            CREATE TABLE IF NOT EXISTS skill_reviews (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                skill_name       TEXT NOT NULL REFERENCES skills(name),
                rating           INTEGER NOT NULL,
                comment          TEXT,
                reviewer_address TEXT,
                created_at       TEXT NOT NULL
            )
        `);
    }

    private rowToSkill(row: Record<string, unknown>): Skill {
        return {
            name: String(row['name']),
            version: String(row['version'] ?? '1.0.0'),
            description: String(row['description'] ?? ''),
            author: String(row['author'] ?? ''),
            category: (row['category'] as SkillCategory) ?? 'other',
            triggers: row['triggers_json'] ? JSON.parse(String(row['triggers_json'])) : [],
            content: String(row['content']),
            source: (row['source'] as SkillSource) ?? 'local',
            rating: Number(row['rating'] ?? 0),
            ratingCount: Number(row['rating_count'] ?? 0),
            downloads: Number(row['downloads'] ?? 0),
            installedAt: row['installed_at'] ? String(row['installed_at']) : undefined,
            publishedAt: row['published_at'] ? String(row['published_at']) : undefined,
        };
    }
}
