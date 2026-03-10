import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) { return { error }; }
    componentDidCatch(error: Error, info: { componentStack?: string | null }) {
        console.error('[ErrorBoundary]', error, info.componentStack);
    }
    render() {
        if (this.state.error) {
            return (
                <div style={{ padding: 40, color: '#F43F5E', fontFamily: 'monospace', background: '#1a1a1a', minHeight: '100vh' }}>
                    <h1>⚠ Dashboard Error</h1>
                    <pre style={{ whiteSpace: 'pre-wrap', marginTop: 16 }}>{this.state.error.message}</pre>
                    <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8, color: '#6B7280', fontSize: 12 }}>{this.state.error.stack}</pre>
                </div>
            );
        }
        return this.props.children;
    }
}

console.log('[Dashboard] Mounting React app...');
try {
    const root = document.getElementById('root');
    createRoot(root!).render(
        <StrictMode>
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </StrictMode>,
    );
} catch (err) {
    console.error('[Dashboard] FATAL: React failed to mount', err);
    document.getElementById('root')!.innerHTML = `<pre style="color:red;padding:40px">${err}</pre>`;
}
