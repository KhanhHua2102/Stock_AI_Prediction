import { useEffect, useState, useCallback } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { accountApi } from '../../services/api';
import { HoldingChart } from './HoldingChart';

interface PortfolioItem {
  asset: string;
  balance: number;
  value_aud: number;
}

export function AccountTab() {
  const { accountChartMode, setAccountChartMode } = useSettingsStore();
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchPortfolio = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await accountApi.getPortfolio();
      setPortfolio(data.portfolio);
      setLastUpdated(new Date(data.timestamp * 1000));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch portfolio');
    }
    setLoading(false);
  }, []);

  // Fetch portfolio on mount
  useEffect(() => {
    fetchPortfolio();
    // Refresh every 30 seconds
    const interval = setInterval(fetchPortfolio, 30000);
    return () => clearInterval(interval);
  }, [fetchPortfolio]);

  // Calculate totals
  const totalValue = portfolio.reduce((sum, item) => sum + item.value_aud, 0);
  const holdings = portfolio.filter((item) => item.asset !== 'AUD');
  const audBalance = portfolio.find((item) => item.asset === 'AUD')?.balance ?? 0;

  // Build tabs: TOTAL + individual holdings
  const holdingAssets = holdings.map((h) => h.asset);
  const tabs = ['TOTAL', ...holdingAssets];

  const formatMoney = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatBalance = (value: number) => {
    if (value >= 1) return value.toFixed(4);
    if (value >= 0.0001) return value.toFixed(6);
    return value.toFixed(8);
  };

  // Get data for selected view
  const getSelectedData = () => {
    if (accountChartMode === 'TOTAL') {
      return {
        title: 'Total Portfolio',
        value: totalValue,
        items: [
          { label: 'Holdings Value', value: holdings.reduce((sum, h) => sum + h.value_aud, 0) },
          { label: 'AUD Balance', value: audBalance },
        ],
      };
    }
    const holding = holdings.find((h) => h.asset === accountChartMode);
    if (holding) {
      return {
        title: `${holding.asset} Holdings`,
        value: holding.value_aud,
        balance: holding.balance,
        items: [],
      };
    }
    return { title: accountChartMode, value: 0, items: [] };
  };

  const selectedData = getSelectedData();

  return (
    <div className="flex flex-col h-full">
      {/* Account Tab Bar with Reload Button */}
      <div className="flex items-center justify-between px-4 py-2 bg-dark-bg2 border-b border-dark-border">
        <div className="flex gap-1 flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setAccountChartMode(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                accountChartMode === tab
                  ? 'bg-dark-accent text-dark-bg'
                  : 'bg-dark-panel text-dark-muted hover:text-dark-fg hover:bg-dark-panel2'
              }`}
            >
              {tab === 'TOTAL' ? 'Total (AUD)' : tab}
            </button>
          ))}
        </div>

        {/* Reload Button */}
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-dark-muted">
              Updated: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchPortfolio}
            disabled={loading}
            className="py-1.5 px-3 bg-dark-panel hover:bg-dark-panel2 text-dark-fg text-xs font-medium rounded border border-dark-border disabled:opacity-50 flex items-center gap-1.5"
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
            {loading ? 'Loading...' : 'Reload'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <span className="text-red-500 block">{error}</span>
              <button
                onClick={fetchPortfolio}
                className="mt-4 py-2 px-4 bg-dark-panel hover:bg-dark-panel2 text-dark-fg text-sm rounded border border-dark-border"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : accountChartMode === 'TOTAL' ? (
          /* TOTAL view - Portfolio summary */
          <div className="overflow-auto p-6 h-full">
            <div className="max-w-2xl mx-auto">
              {/* Main Value Display */}
              <div className="text-center mb-8">
                <h2 className="text-lg text-dark-muted mb-2">{selectedData.title}</h2>
                <div className="text-4xl font-bold text-dark-accent">
                  {formatMoney(selectedData.value)}
                </div>
              </div>

              {/* Summary */}
              <div className="space-y-6">
                <div className="bg-dark-panel rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-dark-fg mb-3">Summary</h3>
                  {selectedData.items.map((item) => (
                    <div key={item.label} className="flex justify-between text-sm">
                      <span className="text-dark-muted">{item.label}</span>
                      <span className="text-dark-fg">{formatMoney(item.value)}</span>
                    </div>
                  ))}
                </div>

                {/* Holdings List */}
                {holdings.length > 0 && (
                  <div className="bg-dark-panel rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-dark-fg mb-3">Holdings</h3>
                    <div className="space-y-3">
                      {holdings.map((holding) => (
                        <div
                          key={holding.asset}
                          className="flex items-center justify-between text-sm cursor-pointer hover:bg-dark-panel2 -mx-2 px-2 py-1 rounded"
                          onClick={() => setAccountChartMode(holding.asset)}
                        >
                          <div>
                            <span className="text-dark-fg font-medium">{holding.asset}</span>
                            <span className="text-dark-muted ml-2 text-xs">
                              {formatBalance(holding.balance)}
                            </span>
                          </div>
                          <span className="text-dark-fg">{formatMoney(holding.value_aud)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AUD Balance */}
                {audBalance > 0 && (
                  <div className="bg-dark-panel rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-dark-fg mb-3">Cash</h3>
                    <div className="flex justify-between text-sm">
                      <span className="text-dark-muted">AUD Balance</span>
                      <span className="text-dark-fg">{formatMoney(audBalance)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Empty state */}
              {!loading && portfolio.length === 0 && (
                <div className="text-center text-dark-muted">
                  <p>No holdings found</p>
                  <p className="text-xs mt-2">
                    Make sure your Kraken API credentials are configured correctly
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Individual holding view - Chart with info panel */
          <div className="flex flex-col h-full">
            {/* Info bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-dark-panel border-b border-dark-border">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-dark-fg">{accountChartMode}</span>
                <span className="text-xs text-dark-muted">
                  Balance: {selectedData.balance !== undefined ? formatBalance(selectedData.balance) : '0'} {accountChartMode}
                </span>
              </div>
              <span className="text-sm font-medium text-dark-accent">
                {formatMoney(selectedData.value)}
              </span>
            </div>
            {/* Chart */}
            <div className="flex-1">
              <HoldingChart asset={accountChartMode} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
