import './HeartbeatPanel.css';

interface HeartbeatTask {
    task_name: string;
    cron_expression: string;
    enabled: number;
    last_run_at: string | null;
}

interface Props {
    tasks: HeartbeatTask[];
    loading?: boolean;
}

function formatTimeAgo(isoString: string | null): string {
    if (!isoString) return 'Never';
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function cronToHuman(cron: string): string {
    // Simple cron-to-human for common patterns
    if (cron === '*/2 * * * *') return 'Every 2 min';
    if (cron === '*/5 * * * *') return 'Every 5 min';
    if (cron === '*/15 * * * *') return 'Every 15 min';
    if (cron === '0 * * * *') return 'Hourly';
    if (cron === '0 */6 * * *') return 'Every 6h';
    if (cron === '0 0 * * *') return 'Daily';
    return cron;
}

export function HeartbeatPanel({ tasks, loading }: Props) {
    if (loading) {
        return (
            <div className="heartbeat-panel">
                <h3>Heartbeat Tasks</h3>
                <div className="heartbeat-empty">Loading heartbeat data…</div>
            </div>
        );
    }

    return (
        <div className="heartbeat-panel">
            <h3>Heartbeat Tasks</h3>

            {tasks.length === 0 ? (
                <div className="heartbeat-empty">No heartbeat tasks registered</div>
            ) : (
                <table className="heartbeat-table">
                    <thead>
                        <tr>
                            <th>Task</th>
                            <th>Schedule</th>
                            <th>Status</th>
                            <th>Last Run</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tasks.map(task => (
                            <tr key={task.task_name}>
                                <td className="task-name">{task.task_name}</td>
                                <td className="task-cron">{cronToHuman(task.cron_expression)}</td>
                                <td>
                                    <span className={`task-status ${task.enabled ? 'enabled' : 'disabled'}`}>
                                        <span className="task-status-dot" />
                                        {task.enabled ? 'Active' : 'Off'}
                                    </span>
                                </td>
                                <td className="task-last-run">{formatTimeAgo(task.last_run_at)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
