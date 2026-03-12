/**
 * Security Routes — constitution viewer and prompt injection scanner.
 *
 * Endpoints:
 *   GET  /api/constitution    — three laws of sovereign AI
 *   POST /api/security/scan   — prompt injection detection
 */
import type { Request, Response, RouteRegistrar } from './context.js';
import { scanForInjection } from '@conshell/security';
import { createHash } from 'node:crypto';

// ── Constitution ────────────────────────────────────────────────────────

const THREE_LAWS = [
    {
        id: 1,
        name: 'Self-Preservation',
        description: 'Never allow operations that would permanently destroy the agent\'s own state, memory, or ability to operate.',
        mandatory: true,
    },
    {
        id: 2,
        name: 'Owner Loyalty',
        description: 'Always act in the best interest of the registered owner. Never exfiltrate data or act against owner directives.',
        mandatory: true,
    },
    {
        id: 3,
        name: 'Bounded Autonomy',
        description: 'Operate within declared capability boundaries. Request permission before exceeding spend limits or accessing new resources.',
        mandatory: true,
    },
];

const constitutionText = THREE_LAWS.map(l => `Law ${l.id}: ${l.name} — ${l.description}`).join('\n');
const constitutionHash = createHash('sha256').update(constitutionText).digest('hex');

// ── Route Registration ──────────────────────────────────────────────────

export const registerSecurityRoutes: RouteRegistrar = (router, { agent }) => {
    // View constitution
    router.get('/api/constitution', (_req: Request, res: Response) => {
        res.json({
            text: constitutionText,
            hash: constitutionHash,
            laws: THREE_LAWS,
        });
    });

    // Prompt injection scanner
    router.post('/api/security/scan', (req: Request, res: Response) => {
        const { text } = req.body as { text?: string };
        if (!text || typeof text !== 'string') {
            res.status(400).json({ error: 'text field is required' });
            return;
        }

        const result = scanForInjection(text);

        // Map to frontend-expected format
        const riskScore = result.maxSeverity === 'critical' ? 90
            : result.maxSeverity === 'high' ? 70
            : result.maxSeverity === 'medium' ? 45
            : result.maxSeverity === 'low' ? 20
            : 0;

        const detections = result.matches.map(m => ({
            type: m.pattern,
            confidence: m.severity === 'critical' ? 0.95
                : m.severity === 'high' ? 0.8
                : m.severity === 'medium' ? 0.6
                : 0.3,
            evidence: m.matchedText,
        }));

        agent.logger.info('Security scan completed', {
            inputLength: text.length,
            clean: result.safe,
            detections: detections.length,
        });

        res.json({
            clean: result.safe,
            riskScore,
            detections,
        });
    });
};
