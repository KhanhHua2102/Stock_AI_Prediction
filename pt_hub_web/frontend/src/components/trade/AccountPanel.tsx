import { useEffect, useState, useCallback } from 'react';
import { accountApi } from '../../services/api';

interface PortfolioItem {
  asset: string;
  balance: number;
  value_aud: number;
}

export function AccountPanel() {
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [pnl, setPnl] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [portfolioData, pnlData] = await Promise.all([
        accountApi.getPortfolio(),
        accountApi.getPnl().catch(() => ({ total_realized_profit_aud: 0 })),
      ]);
      setPortfolio(portfolioData.portfolio);
      setPnl(pnlData.total_realized_profit_aud);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch account');
    }
    setLoading(false);
  }, []);

  // Fetch on mount and refresh every 30 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Calculate values from portfolio
  const totalValue = portfolio.reduce((sum, item) => sum + item.value_aud, 0);
  const holdings = portfolio.filter((item) => item.asset !== 'AUD');
  const holdingsValue = holdings.reduce((sum, h) => sum + h.value_aud, 0);
  const audBalance = portfolio.find((item) => item.asset === 'AUD')?.balance ?? 0;
  const percentInTrade = totalValue > 0 ? holdingsValue / totalValue : 0;

  const formatMoney = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(2)}%`;
  };

  if (error) {
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-dark-fg mb-3">Account</h3>
        <div className="text-xs text-red-500">{error}</div>
        <button
          onClick={fetchData}
          className="mt-2 text-xs text-dark-accent hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-dark-fg">Account</h3>
        <button
          onClick={fetchData}
          disabled={loading}
          className="text-dark-muted hover:text-dark-fg disabled:opacity-50"
          title="Refresh"
        >
          <svg
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Account Values */}
      <div className="space-y-2 text-xs">
        <AccountRow
          label="Total Value"
          value={formatMoney(totalValue)}
          highlight
        />
        <AccountRow
          label="Holdings Value"
          value={formatMoney(holdingsValue)}
        />
        <AccountRow
          label="Buying Power"
          value={formatMoney(audBalance)}
        />
        <AccountRow
          label="% In Trade"
          value={formatPercent(percentInTrade)}
        />
        <AccountRow
          label="Realized PnL"
          value={formatMoney(pnl)}
          valueClass={pnl >= 0 ? 'text-dark-accent' : 'text-red-500'}
        />
      </div>
    </div>
  );
}

function AccountRow({
  label,
  value,
  highlight = false,
  valueClass = '',
}: {
  label: string;
  value: string;
  highlight?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-dark-muted">{label}</span>
      <span className={highlight ? 'text-dark-accent font-medium' : valueClass || 'text-dark-fg'}>
        {value}
      </span>
    </div>
  );
}
