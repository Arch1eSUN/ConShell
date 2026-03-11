import { useState, useEffect } from 'react';
import { ConwayBackground } from './components/ConwayBackground';
import { LoginGate } from './components/LoginGate';
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
import { IdentityPage } from './components/IdentityPage';
import { SocialPage } from './components/SocialPage';
import { PluginsPage } from './components/PluginsPage';
import { ChannelsPage } from './components/ChannelsPage';
import { BackupPage } from './components/BackupPage';
import { HealthPage } from './components/HealthPage';
import { MetricsPage } from './components/MetricsPage';
import { OnboardPage } from './components/OnboardPage';
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

            <LoginGate>
                <Layout
                    connected={connected}
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                >
                    {activeTab === 'overview' && (
                        <div className="page-overview">
                            <header className="page-header">
                                <span className="page-label label">Sovereign AI Runtime</span>
                                <h2 className="page-title">ConShell</h2>
                            </header>

                            <section className="overview-status">
                                <StatusPanel
                                    status={status}
                                    connected={connected}
                                    loading={statusLoading}
                                />
                            </section>

                            <section className="overview-grid">
                                <FinancialCard
                                    status={status}
                                    onFunded={refreshStatus}
                                />
                                <ProviderPanel />
                            </section>

                            <section className="overview-full">
                                <MemoryPanel />
                            </section>
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

                    {activeTab === 'identity' && <IdentityPage />}
                    {activeTab === 'social' && <SocialPage />}
                    {activeTab === 'plugins' && <PluginsPage />}
                    {activeTab === 'channels' && <ChannelsPage />}
                    {activeTab === 'backup' && <BackupPage />}
                    {activeTab === 'health' && <HealthPage />}
                    {activeTab === 'metrics' && <MetricsPage />}
                    {activeTab === 'onboard' && <OnboardPage />}

                    {activeTab === 'settings' && (
                        <SettingsPage />
                    )}
                </Layout>
            </LoginGate>
        </ErrorBoundary>
    );
}
