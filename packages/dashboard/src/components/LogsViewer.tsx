import { useState } from 'react';
import type { TurnEntry } from '../lib/api';
import './LogsViewer.css';

interface Props {
    turns: TurnEntry[];
    loading: boolean;
}

export function LogsViewer({ turns, loading }: Props) {
    const [expanded, setExpanded] = useState<string | null>(null);

    if (loading) {
        return (
            <div className="logs-viewer">
                <h3 className="logs-title">Turn Logs</h3>
                <div className="logs-skeleton">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="log-skeleton-line" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="logs-viewer">
            <div className="logs-header">
                <h3 className="logs-title">Turn Logs</h3>
                <span className="logs-count mono">{turns.length} turns</span>
            </div>

            <div className="logs-container">
                {turns.length === 0 && (
                    <div className="logs-empty">No turns recorded yet.</div>
                )}

                {turns.map(turn => {
                    const isExpanded = expanded === turn.id;
                    const time = new Date(turn.created_at).toLocaleTimeString();
                    const severity = turn.cost_cents > 5 ? 'warn' : 'info';
                    const toolCalls = turn.tool_calls_json
                        ? JSON.parse(turn.tool_calls_json)
                        : null;

                    return (
                        <div
                            key={turn.id}
                            className={`log-entry ${isExpanded ? 'expanded' : ''}`}
                            onClick={() => setExpanded(isExpanded ? null : turn.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={e => e.key === 'Enter' && setExpanded(isExpanded ? null : turn.id)}
                        >
                            <div className="log-line">
                                <span className="log-time">{time}</span>
                                <span className={`log-severity ${severity}`}>
                                    {severity.toUpperCase()}
                                </span>
                                <span className="log-model">{turn.model}</span>
                                <span className="log-tokens">
                                    {turn.input_tokens + turn.output_tokens} tok
                                </span>
                                <span className="log-cost">
                                    {turn.cost_cents.toFixed(2)}¢
                                </span>
                            </div>

                            {isExpanded && (
                                <div className="log-details">
                                    {turn.thinking && (
                                        <div className="log-section">
                                            <span className="log-section-label">Thinking</span>
                                            <pre className="log-pre">{turn.thinking}</pre>
                                        </div>
                                    )}
                                    <div className="log-section">
                                        <span className="log-section-label">Tokens</span>
                                        <span className="log-mono">
                                            in: {turn.input_tokens} / out: {turn.output_tokens}
                                        </span>
                                    </div>
                                    {toolCalls && toolCalls.length > 0 && (
                                        <div className="log-section">
                                            <span className="log-section-label">Tool Calls</span>
                                            <pre className="log-pre">
                                                {JSON.stringify(toolCalls, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
