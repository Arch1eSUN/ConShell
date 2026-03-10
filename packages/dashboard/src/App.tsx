import { useState, useEffect } from 'react';
import { ConwayBackground } from './components/ConwayBackground';
import { Layout, type Tab } from './components/Layout';
import { StatusPanel } from './components/StatusPanel';
import { FinancialCard } from './components/FinancialCard';
import { ChatInterface } from './components/ChatInterface';
import { LogsViewer } from './components/LogsViewer';
import { SoulPanel } from './components/SoulPanel';
import { MemoryPanel } from './components/MemoryPanel';
import { ProviderPanel } from './components/ProviderPanel';
import { HeartbeatPanel } from './components/HeartbeatPanel';
import { ChildrenPanel } from './components/ChildrenPanel';
import { SettingsPage } from './components/SettingsPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useWebSocket } from './lib/useWebSocket';
import { useAgentStatus, useLogs, useSoul } from './lib/hooks';
import './App.css';
import './components/ErrorBoundary.css';

export default function App() {
    const [activeTab, setActiveTab] = useState<Tab>('overview');

    const { connected, on } = useWebSocket();
    const { data: status, loading: statusLoading, refresh: refreshStatus } = useAgentStatus();
    const { data: logsData, loading: logsLoading, refresh: refreshLogs } = useLogs();
    const { data: soul, loading: soulLoading } = useSoul();

    // Real-time WebSocket event consumption → auto-refresh panels
    useEffect(() => {
        const unsubs = [
            on('status_update', () => refreshStatus()),
            on('state_change', () => refreshStatus()),
            on('heartbeat_tick', () => refreshStatus()),
            on('balance', () => refreshStatus()),
            on('new_turn', () => { refreshStatus(); refreshLogs(); }),
            on('capabilities_changed', () => refreshStatus()),
            on('skill_changed', () => refreshStatus()),
        ];
        return () => unsubs.forEach(u => u());
    }, [on, refreshStatus, refreshLogs]);

    return (
        <ErrorBoundary>
            <ConwayBackground />

            <Layout
                connected={connected}
                activeTab={activeTab}
                onTabChange={setActiveTab}
            >
                {activeTab === 'overview' && (
                    <div className="page-overview">
                        <header className="page-header">
                            <h2 className="page-title">Dashboard</h2>
                            <p className="page-subtitle">Conway Automaton — Sovereign AI Runtime</p>
                        </header>

                        <div className="overview-grid">
                            <StatusPanel
                                status={status}
                                connected={connected}
                                loading={statusLoading}
                            />
                            <FinancialCard
                                status={status}
                                onFunded={refreshStatus}
                            />
                        </div>

                        <div className="overview-grid">
                            <MemoryPanel />
                            <ProviderPanel />
                        </div>

                        <div className="overview-chat">
                            <ChatInterface />
                        </div>
                    </div>
                )}

                {activeTab === 'chat' && (
                    <div className="page-chat">
                        <header className="page-header">
                            <h2 className="page-title">Terminal</h2>
                            <p className="page-subtitle">Interactive agent communication</p>
                        </header>
                        <ChatInterface />
                    </div>
                )}

                {activeTab === 'logs' && (
                    <div className="page-logs">
                        <header className="page-header">
                            <h2 className="page-title">Turn Logs</h2>
                            <p className="page-subtitle">Inference history and cost tracking</p>
                        </header>
                        <LogsViewer
                            turns={logsData?.turns ?? []}
                            loading={logsLoading}
                        />
                    </div>
                )}

                {activeTab === 'soul' && (
                    <div className="page-soul">
                        <header className="page-header">
                            <h2 className="page-title">Soul</h2>
                            <p className="page-subtitle">Agent constitution and values</p>
                        </header>
                        <SoulPanel soul={soul} loading={soulLoading} />
                    </div>
                )}

                {activeTab === 'heartbeat' && (
                    <div className="page-heartbeat">
                        <header className="page-header">
                            <h2 className="page-title">Heartbeat</h2>
                            <p className="page-subtitle">Autonomous task scheduling and execution</p>
                        </header>
                        <HeartbeatPanel
                            tasks={status?.heartbeatTasks ?? []}
                            loading={statusLoading}
                        />
                    </div>
                )}

                {activeTab === 'children' && (
                    <div className="page-children">
                        <header className="page-header">
                            <h2 className="page-title">Children</h2>
                            <p className="page-subtitle">Spawned child agent replicas</p>
                        </header>
                        <ChildrenPanel />
                    </div>
                )}

                {activeTab === 'settings' && (
                    <SettingsPage />
                )}
            </Layout>
        </ErrorBoundary>
    );
}
