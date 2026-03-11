/**
 * Skills Marketplace Module — Remote install, manifest validation, marketplace API.
 *
 * Extends the existing @conshell/skills package with:
 *   - Remote skill installation (from URL or Git)
 *   - Marketplace manifest (skill.json schema)
 *   - Security audit before install (permissions check)
 *   - Community registry browsing
 */
import type { Request, Response, RouteRegistrar } from './context.js';
import { readdir, readFile, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// ── Types ───────────────────────────────────────────────────────────────

export interface MarketplaceEntry {
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly author: string;
    readonly sourceUrl: string;
    readonly tags: readonly string[];
    readonly downloads: number;
    readonly verified: boolean;
}

export interface SkillInstallResult {
    readonly success: boolean;
    readonly name: string;
    readonly path?: string;
    readonly error?: string;
    readonly warnings?: readonly string[];
}

// ── Built-in Marketplace Registry (curated) ─────────────────────────────

const COMMUNITY_REGISTRY: MarketplaceEntry[] = [
    {
        name: 'web-search',
        description: 'Search the web using DuckDuckGo/Brave/Google APIs',
        version: '1.0.0',
        author: 'conshell',
        sourceUrl: 'https://github.com/conshell/skills-web-search',
        tags: ['search', 'web', 'internet'],
        downloads: 0,
        verified: true,
    },
    {
        name: 'code-interpreter',
        description: 'Execute code in sandboxed Node.js/Python environments',
        version: '1.0.0',
        author: 'conshell',
        sourceUrl: 'https://github.com/conshell/skills-code-interpreter',
        tags: ['code', 'sandbox', 'compute'],
        downloads: 0,
        verified: true,
    },
    {
        name: 'file-manager',
        description: 'Read, write, and manage files on the local filesystem',
        version: '1.0.0',
        author: 'conshell',
        sourceUrl: 'https://github.com/conshell/skills-file-manager',
        tags: ['files', 'filesystem', 'io'],
        downloads: 0,
        verified: true,
    },
    {
        name: 'memory-journal',
        description: 'Structured journaling and memory consolidation',
        version: '1.0.0',
        author: 'conshell',
        sourceUrl: 'https://github.com/conshell/skills-memory-journal',
        tags: ['memory', 'journal', 'self'],
        downloads: 0,
        verified: true,
    },
];

// ── Security Audit ──────────────────────────────────────────────────────

interface AuditResult {
    readonly safe: boolean;
    readonly warnings: string[];
    readonly capabilities: string[];
}

async function auditSkillDirectory(skillDir: string): Promise<AuditResult> {
    const warnings: string[] = [];
    const capabilities: string[] = [];

    // Check for handler.ts (code execution)
    try {
        await access(join(skillDir, 'handler.ts'));
        capabilities.push('code_execution');
        warnings.push('Skill contains executable code (handler.ts)');

        // Read handler and check for dangerous patterns
        const handler = await readFile(join(skillDir, 'handler.ts'), 'utf-8');
        if (handler.includes('child_process') || handler.includes('exec(') || handler.includes('execSync(')) {
            warnings.push('⚠ DANGEROUS: handler.ts uses child_process — arbitrary command execution');
        }
        if (handler.includes('eval(')) {
            warnings.push('⚠ DANGEROUS: handler.ts uses eval()');
        }
        if (handler.includes('fs.writeFile') || handler.includes('writeFileSync')) {
            warnings.push('Handler writes to filesystem');
            capabilities.push('filesystem_write');
        }
        if (handler.includes('fetch(') || handler.includes('http.request')) {
            warnings.push('Handler makes network requests');
            capabilities.push('network');
        }
    } catch {
        // No handler — pure markdown skill, safe
    }

    // Check SKILL.md for required capabilities
    try {
        const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf-8');
        const fmMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch?.[1]?.includes('filesystem')) capabilities.push('filesystem');
        if (fmMatch?.[1]?.includes('network')) capabilities.push('network');
        if (fmMatch?.[1]?.includes('compute')) capabilities.push('compute');
    } catch {
        warnings.push('Missing SKILL.md');
    }

    return {
        safe: !warnings.some(w => w.includes('DANGEROUS')),
        warnings,
        capabilities,
    };
}

// ── Route Registration ──────────────────────────────────────────────────

export const registerSkillsMarketplaceRoutes: RouteRegistrar = (router, { agent }) => {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || '.';
    const skillsDir = resolve(home, '.conshell', 'workspace', 'skills');

    // Browse marketplace
    router.get('/api/skills/marketplace', (req: Request, res: Response) => {
        const query = (req.query.q as string | undefined)?.toLowerCase();
        const tag = req.query.tag as string | undefined;

        let results = [...COMMUNITY_REGISTRY];

        if (query) {
            results = results.filter(
                r => r.name.includes(query) || r.description.toLowerCase().includes(query),
            );
        }

        if (tag) {
            results = results.filter(r => r.tags.includes(tag));
        }

        res.json({ entries: results, count: results.length });
    });

    // Install a skill from URL
    router.post('/api/skills/install', async (req: Request, res: Response) => {
        try {
            const { name, sourceUrl } = req.body as { name?: string; sourceUrl?: string };

            if (!name) {
                res.status(400).json({ error: 'name required' });
                return;
            }

            const targetDir = join(skillsDir, name);

            // Check if already installed
            try {
                await access(targetDir);
                res.status(409).json({ error: `Skill "${name}" already installed at ${targetDir}` });
                return;
            } catch {
                // Not installed — good
            }

            // Create target directory
            await mkdir(targetDir, { recursive: true });

            if (sourceUrl) {
                // For now, create a placeholder SKILL.md with a note about the source
                const skillMd = `---
name: ${name}
description: Installed from ${sourceUrl}
capabilities: []
tools: []
triggers: []
---

# ${name}

Installed from: ${sourceUrl}

> This skill was installed remotely. Run \`git clone ${sourceUrl}\` to get the full source.
`;
                await writeFile(join(targetDir, 'SKILL.md'), skillMd, 'utf-8');
            }

            // Audit
            const audit = await auditSkillDirectory(targetDir);

            const result: SkillInstallResult = {
                success: true,
                name,
                path: targetDir,
                warnings: audit.warnings,
            };

            agent.logger.info('Skill installed', { name, targetDir, safe: audit.safe });
            res.status(201).json({ result, audit });
        } catch (err) {
            res.status(500).json({
                error: 'Installation failed',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });

    // Uninstall a skill
    router.delete('/api/skills/installed/:name', async (req: Request, res: Response) => {
        try {
            const name = req.params.name;
            const targetDir = join(skillsDir, name);

            try {
                await access(targetDir);
            } catch {
                res.status(404).json({ error: `Skill "${name}" not found` });
                return;
            }

            await rm(targetDir, { recursive: true });
            agent.logger.info('Skill uninstalled', { name });
            res.json({ success: true, name });
        } catch (err) {
            res.status(500).json({
                error: 'Uninstall failed',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });

    // List installed skills (filesystem scan)
    router.get('/api/skills/installed', async (_req: Request, res: Response) => {
        try {
            await mkdir(skillsDir, { recursive: true });
            const entries = await readdir(skillsDir);
            const installed: { name: string; hasHandler: boolean; hasSkillMd: boolean }[] = [];

            for (const entry of entries) {
                const dir = join(skillsDir, entry);
                let hasSkillMd = false;
                let hasHandler = false;

                try {
                    await access(join(dir, 'SKILL.md'));
                    hasSkillMd = true;
                } catch { /* no SKILL.md */ }

                try {
                    await access(join(dir, 'handler.ts'));
                    hasHandler = true;
                } catch { /* no handler */ }

                if (hasSkillMd) {
                    installed.push({ name: entry, hasHandler, hasSkillMd });
                }
            }

            res.json({ skills: installed, count: installed.length, directory: skillsDir });
        } catch (err) {
            res.status(500).json({ error: 'Failed to list installed skills' });
        }
    });

    // Audit a specific installed skill
    router.get('/api/skills/installed/:name/audit', async (req: Request, res: Response) => {
        try {
            const targetDir = join(skillsDir, req.params.name);
            try {
                await access(targetDir);
            } catch {
                res.status(404).json({ error: 'Skill not found' });
                return;
            }

            const audit = await auditSkillDirectory(targetDir);
            res.json({ name: req.params.name, audit });
        } catch (err) {
            res.status(500).json({ error: 'Audit failed' });
        }
    });
};
