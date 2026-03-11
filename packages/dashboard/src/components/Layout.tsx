import { type ReactNode } from 'react';
import './Layout.css';

interface Props {
    connected: boolean;
    children: ReactNode;
}

type Tab = 'overview' | 'chat' | 'logs' | 'heartbeat' | 'children' | 'soul'
    | 'identity' | 'social' | 'plugins' | 'channels' | 'backup' | 'health' | 'metrics'
    | 'onboard' | 'settings';

interface LayoutProps extends Props {
    activeTab: Tab;
    onTabChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'chat', label: 'Terminal' },
    { id: 'logs', label: 'Logs' },
    { id: 'heartbeat', label: 'Heartbeat' },
    { id: 'children', label: 'Children' },
    { id: 'soul', label: 'Soul' },
    { id: 'identity', label: '🪪 Identity' },
    { id: 'social', label: '💬 Social' },
    { id: 'plugins', label: '🧩 Plugins' },
    { id: 'channels', label: '📡 Channels' },
    { id: 'backup', label: '💾 Backup' },
    { id: 'health', label: '🩺 Health' },
    { id: 'metrics', label: '📊 Metrics' },
    { id: 'onboard', label: '🧭 Onboard' },
    { id: 'settings', label: '⚙ Settings' },
];

export function Layout({ connected, activeTab, onTabChange, children }: LayoutProps) {
    return (
        <div className="layout">
            {/* Sidebar */}
            <aside className="sidebar" role="navigation" aria-label="Main navigation">
                <div className="sidebar-brand">
                    <h1 className="sidebar-logo">Conway</h1>
                    <span className="sidebar-version mono">Automaton v0.1</span>
                </div>

                <nav className="sidebar-nav">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            className={`sidebar-item ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => onTabChange(tab.id)}
                            aria-current={activeTab === tab.id ? 'page' : undefined}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <div className={`connection-badge ${connected ? 'online' : 'offline'}`}>
                        <span className="connection-dot" />
                        <span className="connection-text mono">
                            {connected ? 'Live' : 'Offline'}
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
