import { useState } from 'react';
import type { AgentStatus } from '../lib/api';
import { api } from '../lib/api';
import './FinancialCard.css';

interface Props {
    status: AgentStatus | null;
    onFunded?: () => void;
}

export function FinancialCard({ status, onFunded }: Props) {
    const [fundAmount, setFundAmount] = useState('');
    const [funding, setFunding] = useState(false);
    const [fundResult, setFundResult] = useState<string | null>(null);

    const fin = status?.financial;

    const handleFund = async () => {
        const cents = parseInt(fundAmount, 10);
        if (isNaN(cents) || cents <= 0) return;

        setFunding(true);
        setFundResult(null);
        try {
            const result = await api.fund(cents);
            if (result.success) {
                setFundResult(`✓ Funded ${cents}¢`);
                setFundAmount('');
                onFunded?.();
            } else {
                setFundResult(`✗ ${result.error}`);
            }
        } catch (err) {
            setFundResult(`✗ ${err instanceof Error ? err.message : 'Failed'}`);
        } finally {
            setFunding(false);
        }
    };

    return (
        <div className="financial-card">
            <h3 className="financial-title">Financial</h3>

            <div className="financial-balance">
                <span className="balance-label">Net Balance</span>
                <span className="balance-amount">
                    {fin ? (fin.netBalanceCents / 100).toFixed(2) : '—'}
                    <span className="balance-unit">USDC</span>
                </span>
            </div>

            <div className="financial-grid">
                <div className="financial-stat">
                    <span className="stat-label">Top-ups</span>
                    <span className="stat-value positive">
                        +{fin ? (fin.totalTopupCents / 100).toFixed(2) : '0.00'}
                    </span>
                </div>
                <div className="financial-stat">
                    <span className="stat-label">Spent</span>
                    <span className="stat-value negative">
                        −{fin ? (fin.totalSpendCents / 100).toFixed(2) : '0.00'}
                    </span>
                </div>
                <div className="financial-stat">
                    <span className="stat-label">Hour</span>
                    <span className="stat-value">
                        {fin ? (fin.currentHourSpendCents / 100).toFixed(2) : '0.00'}
                    </span>
                </div>
                <div className="financial-stat">
                    <span className="stat-label">Today</span>
                    <span className="stat-value">
                        {fin ? (fin.currentDaySpendCents / 100).toFixed(2) : '0.00'}
                    </span>
                </div>
            </div>

            <div className="fund-section">
                <input
                    type="number"
                    className="fund-input"
                    placeholder="Amount (cents)"
                    value={fundAmount}
                    onChange={e => setFundAmount(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFund()}
                    min="1"
                    disabled={funding}
                    aria-label="Fund amount in cents"
                />
                <button
                    className="fund-button"
                    onClick={handleFund}
                    disabled={funding || !fundAmount}
                >
                    {funding ? 'Funding…' : 'Fund'}
                </button>
            </div>

            {fundResult && (
                <div className={`fund-result ${fundResult.startsWith('✓') ? 'success' : 'error'}`}>
                    {fundResult}
                </div>
            )}
        </div>
    );
}
