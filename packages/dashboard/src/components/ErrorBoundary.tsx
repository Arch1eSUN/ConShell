import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * ErrorBoundary — catches render errors and shows a recovery UI.
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary] Caught:', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="error-boundary">
                    <div className="error-boundary-card">
                        <div className="error-icon">⚠️</div>
                        <h3>Something went wrong</h3>
                        <p className="error-message">
                            {this.state.error?.message ?? 'An unexpected error occurred'}
                        </p>
                        <button
                            className="error-retry-btn"
                            onClick={() => this.setState({ hasError: false, error: null })}
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

/**
 * Skeleton loading placeholder
 */
export function Skeleton({ width = '100%', height = '1.2rem', rounded = false }: {
    width?: string;
    height?: string;
    rounded?: boolean;
}) {
    return (
        <div
            className={`skeleton ${rounded ? 'skeleton-rounded' : ''}`}
            style={{ width, height }}
        />
    );
}

/**
 * Card-level skeleton placeholder
 */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
    return (
        <div className="card-skeleton">
            <Skeleton width="60%" height="1.4rem" />
            {Array.from({ length: lines }, (_, i) => (
                <Skeleton key={i} width={`${80 - i * 10}%`} height="1rem" />
            ))}
        </div>
    );
}
