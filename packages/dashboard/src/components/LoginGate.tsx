import { useState, useEffect, type ReactNode, createContext, useContext } from 'react';
import './LoginGate.css';

// ── Auth context (shared with API hooks) ────────────────────────────────

interface AuthContextValue {
    token: string | null;
    setToken: (t: string | null) => void;
}

const AuthContext = createContext<AuthContextValue>({ token: null, setToken: () => {} });

/** Hook for other components to access the auth token. */
export function useAuthToken(): string | null {
    return useContext(AuthContext).token;
}

// ── LoginGate ───────────────────────────────────────────────────────────

interface Props {
    children: ReactNode;
}

export function LoginGate({ children }: Props) {
    const [authRequired, setAuthRequired] = useState<boolean | null>(null); // null = loading
    const [token, setToken] = useState<string | null>(() =>
        sessionStorage.getItem('conshell_auth_token'),
    );
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const [verifying, setVerifying] = useState(false);

    // ── Step 1: Check if auth is required ────────────────────────────
    useEffect(() => {
        fetch('/api/health')
            .then(r => r.json())
            .then((data: { authRequired?: boolean }) => {
                setAuthRequired(data.authRequired ?? false);
            })
            .catch(() => {
                // If health check fails, assume no auth required
                setAuthRequired(false);
            });
    }, []);

    // ── Step 2: Verify stored token on mount ─────────────────────────
    useEffect(() => {
        if (!authRequired || !token) return;
        fetch('/api/health', {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => {
                if (!r.ok) {
                    // Token invalid, clear it
                    sessionStorage.removeItem('conshell_auth_token');
                    setToken(null);
                }
            })
            .catch(() => {
                // Network error, keep token (optimistic)
            });
    }, [authRequired, token]);

    // ── Loading state ────────────────────────────────────────────────
    if (authRequired === null) {
        return (
            <div className="login-gate">
                <div className="login-card">
                    <div className="login-icon">⧗</div>
                    <p style={{ color: 'var(--muted)' }}>Connecting…</p>
                </div>
            </div>
        );
    }

    // ── No auth needed or already authenticated ──────────────────────
    if (!authRequired || token) {
        return (
            <AuthContext.Provider value={{ token, setToken }}>
                {children}
            </AuthContext.Provider>
        );
    }

    // ── Login form ───────────────────────────────────────────────────
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setVerifying(true);

        try {
            const res = await fetch('/api/health', {
                headers: { Authorization: `Bearer ${input}` },
            });

            if (res.ok) {
                sessionStorage.setItem('conshell_auth_token', input);
                setToken(input);
            } else {
                setError('Invalid token. Check your CONSHELL_AUTH_SECRET.');
            }
        } catch {
            setError('Connection failed. Is the agent running?');
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="login-gate">
            <div className="login-card">
                <div className="login-icon">*</div>
                <h1>ConShell</h1>
                <p className="login-subtitle">Sovereign AI Runtime</p>

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="login-input-group">
                        <label htmlFor="auth-token">Access Token</label>
                        <input
                            id="auth-token"
                            className="login-input"
                            type="password"
                            placeholder="Enter your auth token…"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            autoFocus
                            autoComplete="current-password"
                        />
                    </div>

                    {error && <div className="login-error">{error}</div>}

                    <button
                        type="submit"
                        className="login-submit"
                        disabled={!input.trim() || verifying}
                    >
                        {verifying ? 'Verifying…' : 'Unlock Dashboard'}
                    </button>
                </form>
            </div>
        </div>
    );
}
