import type { SoulDocument } from '../lib/api';
import './SoulPanel.css';

interface Props {
    soul: SoulDocument | null;
    loading: boolean;
}

export function SoulPanel({ soul, loading }: Props) {
    if (loading || !soul) {
        return (
            <div className="soul-panel">
                <h3 className="soul-title">Constitution</h3>
                <div className="soul-skeleton" />
            </div>
        );
    }

    return (
        <div className="soul-panel">
            <h3 className="soul-title">Constitution</h3>

            <div className="soul-identity">
                <blockquote className="soul-quote">{soul.identity}</blockquote>
            </div>

            {soul.values.length > 0 && (
                <div className="soul-section">
                    <h4 className="soul-section-title">Values</h4>
                    <div className="soul-tags">
                        {soul.values.map((v, i) => (
                            <span key={i} className="soul-tag value">{v}</span>
                        ))}
                    </div>
                </div>
            )}

            {soul.capabilities.length > 0 && (
                <div className="soul-section">
                    <h4 className="soul-section-title">Capabilities</h4>
                    <div className="soul-tags">
                        {soul.capabilities.map((c, i) => (
                            <span key={i} className="soul-tag capability">{c}</span>
                        ))}
                    </div>
                </div>
            )}

            {soul.currentGoals.length > 0 && (
                <div className="soul-section">
                    <h4 className="soul-section-title">Current Goals</h4>
                    <ul className="soul-goals">
                        {soul.currentGoals.map((g, i) => (
                            <li key={i}>{g}</li>
                        ))}
                    </ul>
                </div>
            )}

            {soul.alignmentNotes && (
                <div className="soul-section">
                    <h4 className="soul-section-title">Alignment</h4>
                    <p className="soul-alignment">{soul.alignmentNotes}</p>
                </div>
            )}

            <div className="soul-meta">
                <span className="soul-version">v{soul.version}</span>
            </div>
        </div>
    );
}
