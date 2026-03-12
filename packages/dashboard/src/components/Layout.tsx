import { type ReactNode } from 'react';
import './Layout.css';

interface Props {
    connected: boolean;
    children: ReactNode;
}

type Tab = 'overview' | 'chat' | 'logs' | 'heartbeat' | 'tasks' | 'children' | 'soul'
    | 'identity' | 'social' | 'plugins' | 'channels' | 'backup' | 'health' | 'metrics'
    | 'onboard' | 'canvas' | 'voice' | 'media' | 'settings';

interface LayoutProps extends Props {
    activeTab: Tab;
    onTabChange: (tab: Tab) => void;
}

interface NavGroup {
    label: string;
    items: { id: Tab; label: string }[];
}

const NAV_GROUPS: NavGroup[] = [
    {
        label: 'Core',
        items: [
            { id: 'overview', label: 'Overview' },
            { id: 'chat', label: 'Terminal' },
            { id: 'logs', label: 'Logs' },
        ],
    },
    {
        label: 'Agent',
        items: [
            { id: 'heartbeat', label: 'Heartbeat' },
            { id: 'tasks', label: 'Tasks' },
            { id: 'children', label: 'Children' },
            { id: 'soul', label: 'Soul' },
            { id: 'identity', label: 'Identity' },
            { id: 'social', label: 'Social' },
        ],
    },
    {
        label: 'System',
        items: [
            { id: 'plugins', label: 'Plugins' },
            { id: 'channels', label: 'Channels' },
            { id: 'canvas', label: 'Canvas' },
            { id: 'voice', label: 'Voice' },
            { id: 'media', label: 'Media' },
            { id: 'backup', label: 'Backup' },
            { id: 'health', label: 'Health' },
            { id: 'metrics', label: 'Metrics' },
            { id: 'onboard', label: 'Onboard' },
            { id: 'settings', label: 'Settings' },
        ],
    },
];

export function Layout({ connected, activeTab, onTabChange, children }: LayoutProps) {
    return (
        <div className="layout">
            {/* Sidebar */}
            <aside className="sidebar" role="navigation" aria-label="Main navigation">
                <div className="sidebar-brand">
                    <h1 className="sidebar-logo">ConShell</h1>
                    <span className="sidebar-version">RUNTIME v0.1</span>
                </div>

                <nav className="sidebar-nav">
                    {NAV_GROUPS.map((group, gi) => (
                        <div className="sidebar-group" key={group.label}>
                            {gi > 0 && <div className="sidebar-divider" />}
                            <span className="sidebar-group-label">{group.label}</span>
                            {group.items.map(tab => (
                                <button
                                    key={tab.id}
                                    className={`sidebar-item ${activeTab === tab.id ? 'active' : ''}`}
                                    onClick={() => onTabChange(tab.id)}
                                    aria-current={activeTab === tab.id ? 'page' : undefined}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <div className={`connection-badge ${connected ? 'online' : 'offline'}`}>
                        <span className="connection-dot" />
                        <span className="connection-text">
                            {connected ? 'LIVE' : 'OFFLINE'}
                        </span>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <main className="main-content" role="main">
                {children}
            </main>
        </div>
    );
}

export type { Tab };
