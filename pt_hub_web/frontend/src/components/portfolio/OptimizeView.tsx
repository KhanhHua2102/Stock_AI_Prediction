import { useState, useEffect } from 'react';
import { useSettingsStore, selectTickers } from '../../store/settingsStore';
import { portfolioApi } from '../../services/api';
import type { PortfolioOptimizationResult, RebalanceResult, CorrelationResult } from '../../services/types';

type Strategy = 'mean-variance' | 'equal-weight';
type RebalanceStrategy = 'rebalance' | 'buy-only';
type InputMode = 'qty-price' | 'value';

interface HoldingInput {
  ticker: string;
  quantity: string;
  price: string;
  value: string;
  mode: InputMode;
}

const ACTION_COLORS: Record<string, string> = {
  BUY: 'bg-green-500/20 text-green-400 border-green-500/30',
  SELL: 'bg-red-500/20 text-red-400 border-red-500/30',
  HOLD: 'bg-dark-muted/20 text-dark-muted border-dark-border',
};

export function OptimizeView() {
  const allTickers = useSettingsStore(selectTickers);
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [results, setResults] = useState<PortfolioOptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [strategy, setStrategy] = useState<Strategy>('mean-variance');

  const [holdings, setHoldings] = useState<HoldingInput[]>([]);
  const [rebalanceStrategy, setRebalanceStrategy] = useState<RebalanceStrategy>('rebalance');
  const [additionalCapital, setAdditionalCapital] = useState('');
  const [rebalanceResult, setRebalanceResult] = useState<RebalanceResult | null>(null);
  const [rebalanceLoading, setRebalanceLoading] = useState(false);
  const [rebalanceError, setRebalanceError] = useState('');
  const [correlation, setCorrelation] = useState<CorrelationResult | null>(null);

  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!initialized && allTickers.length > 0) {
      setSelectedTickers(allTickers.slice(0, 5));
      setInitialized(true);
    }
  }, [allTickers, initialized]);

  useEffect(() => {
    if (results) {
      setHoldings(
        results.assets.map(a => ({
          ticker: a.ticker,
          quantity: '',
          price: '',
          value: '',
          mode: 'qty-price' as InputMode,
        }))
      );
      setRebalanceResult(null);
    }
  }, [results]);

  const toggleTicker = (ticker: string) => {
    setSelectedTickers(prev =>
      prev.includes(ticker) ? prev.filter(t => t !== ticker) : [...prev, ticker]
    );
  };

  const handleOptimize = async () => {
    if (selectedTickers.length < 2) {
      setError('Select at least 2 tickers for optimization');
      return;
    }
    setLoading(true);
    setError('');
    setResults(null);
    setRebalanceResult(null);
    try {
      const data = await portfolioApi.optimize(selectedTickers, strategy);
      setResults(data);
      portfolioApi.correlation(selectedTickers).then(setCorrelation).catch(() => setCorrelation(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimization failed');
    } finally {
      setLoading(false);
    }
  };

  const updateHolding = (index: number, field: keyof HoldingInput, value: string) => {
    setHoldings(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const toggleHoldingMode = (index: number) => {
    setHoldings(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        mode: updated[index].mode === 'qty-price' ? 'value' : 'qty-price',
      };
      return updated;
    });
  };

  const getHoldingValue = (h: HoldingInput): number => {
    if (h.mode === 'value') return parseFloat(h.value) || 0;
    return (parseFloat(h.quantity) || 0) * (parseFloat(h.price) || 0);
  };

  const totalHoldingValue = holdings.reduce((sum, h) => sum + getHoldingValue(h), 0);

  const handleRebalance = async () => {
    if (!results) return;
    const holdingsPayload = holdings
      .filter(h => getHoldingValue(h) > 0 || h.mode === 'qty-price')
      .map(h => {
        if (h.mode === 'value') return { ticker: h.ticker, value: parseFloat(h.value) || 0 };
        return { ticker: h.ticker, quantity: parseFloat(h.quantity) || 0, price: parseFloat(h.price) || undefined };
      });
    const holdingTickers = new Set(holdingsPayload.map(h => h.ticker));
    for (const asset of results.assets) {
      if (!holdingTickers.has(asset.ticker)) holdingsPayload.push({ ticker: asset.ticker, value: 0 });
    }
    const targetWeights = results.assets.map(a => ({ ticker: a.ticker, weight: a.weight }));
    const capital = parseFloat(additionalCapital) || 0;
    if (rebalanceStrategy === 'buy-only' && capital <= 0) {
      setRebalanceError('Buy-only strategy requires additional capital > 0');
      return;
    }
    setRebalanceLoading(true);
    setRebalanceError('');
    setRebalanceResult(null);
    try {
      const data = await portfolioApi.rebalance(holdingsPayload, targetWeights, rebalanceStrategy, capital);
      setRebalanceResult(data);
    } catch (e) {
      setRebalanceError(e instanceof Error ? e.message : 'Rebalance calculation failed');
    } finally {
      setRebalanceLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-bold text-dark-fg mb-1">Portfolio Optimization</h2>
        <p className="text-dark-muted text-sm">
          Select assets from your watchlist to calculate optimal portfolio allocations using
          Modern Portfolio Theory and Risk Parity.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Ticker Selection */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">
            Select Assets ({selectedTickers.length})
          </h3>
          <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              {allTickers.map(ticker => (
                <label
                  key={ticker}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-dark-panel2 transition-colors border-b border-dark-border last:border-0 ${
                    selectedTickers.includes(ticker) ? 'bg-dark-panel2/50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-dark-border bg-dark-bg text-dark-accent focus:ring-dark-accent"
                    checked={selectedTickers.includes(ticker)}
                    onChange={() => toggleTicker(ticker)}
                  />
                  <span className={`font-medium ${selectedTickers.includes(ticker) ? 'text-dark-fg' : 'text-dark-muted'}`}>
                    {ticker}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-dark-muted uppercase tracking-wider block mb-2">Strategy</label>
            <select
              value={strategy}
              onChange={e => setStrategy(e.target.value as Strategy)}
              className="w-full py-2 px-3 bg-dark-panel border border-dark-border rounded-lg text-dark-fg focus:ring-dark-accent focus:border-dark-accent"
            >
              <option value="mean-variance">Mean-Variance (Min Volatility)</option>
              <option value="equal-weight">Equal Weight</option>
            </select>
          </div>

          <button
            onClick={handleOptimize}
            disabled={loading || selectedTickers.length < 2}
            className="w-full py-3 px-4 bg-dark-accent text-white rounded-xl font-semibold shadow-lg shadow-dark-accent/20 hover:bg-dark-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? 'Optimizing...' : 'Optimize Portfolio'}
          </button>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Optimal Weights</h3>

          {results ? (
            <>
              <div className="bg-dark-panel border border-dark-border rounded-xl p-6">
                <div className="space-y-6">
                  {results.assets.sort((a, b) => b.weight - a.weight).map(asset => (
                    <div key={asset.ticker} className="space-y-2">
                      <div className="flex justify-between items-end">
                        <span className="text-lg font-bold text-dark-fg">{asset.ticker}</span>
                        <span className="text-dark-accent font-mono text-xl">{(asset.weight * 100).toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-dark-bg h-3 rounded-full overflow-hidden">
                        <div className="bg-dark-accent h-full rounded-full transition-all duration-1000" style={{ width: `${asset.weight * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-8 pt-6 border-t border-dark-border">
                  <div className="flex justify-between items-center">
                    <span className="text-dark-muted">Total Allocation</span>
                    <span className="text-dark-fg font-bold">{(results.assets.reduce((s, a) => s + a.weight, 0) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>

              {results.portfolio_return !== null && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-dark-panel border border-dark-border rounded-xl p-4 text-center">
                    <p className="text-xs text-dark-muted uppercase mb-1">Expected Return</p>
                    <p className={`text-2xl font-bold font-mono ${(results.portfolio_return ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {results.portfolio_return?.toFixed(1)}%
                    </p>
                    <p className="text-xs text-dark-muted mt-1">annualized</p>
                  </div>
                  <div className="bg-dark-panel border border-dark-border rounded-xl p-4 text-center">
                    <p className="text-xs text-dark-muted uppercase mb-1">Volatility</p>
                    <p className="text-2xl font-bold font-mono text-yellow-400">{results.portfolio_volatility?.toFixed(1)}%</p>
                    <p className="text-xs text-dark-muted mt-1">annualized</p>
                  </div>
                  <div className="bg-dark-panel border border-dark-border rounded-xl p-4 text-center">
                    <p className="text-xs text-dark-muted uppercase mb-1">Sharpe Ratio</p>
                    <p className={`text-2xl font-bold font-mono ${(results.sharpe_ratio ?? 0) >= 1 ? 'text-green-400' : (results.sharpe_ratio ?? 0) >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {results.sharpe_ratio?.toFixed(2)}
                    </p>
                    <p className="text-xs text-dark-muted mt-1">risk-adjusted</p>
                  </div>
                </div>
              )}

              <div className="p-4 bg-dark-panel2/50 border border-dark-border rounded-xl">
                <h4 className="text-xs font-semibold text-dark-muted uppercase mb-2">Strategy Used</h4>
                <p className="text-xs text-dark-muted leading-relaxed">
                  {results.strategy === 'mean-variance'
                    ? 'Mean-Variance Optimization (Minimum Volatility) via Portfolio Optimizer API. Weights are computed to minimize portfolio risk given historical return correlations.'
                    : results.strategy.includes('fallback')
                    ? 'Equal Weight (fallback). The optimization API was unavailable, so weights are distributed equally across selected assets.'
                    : 'Equal Weight allocation. Each asset receives an identical share of the portfolio.'}
                </p>
              </div>
            </>
          ) : (
            <div className="bg-dark-panel border border-dark-border rounded-xl h-64 flex flex-col items-center justify-center text-dark-muted gap-4">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20v-6M6 20V10M18 20V4" />
              </svg>
              <p>Click "Optimize Portfolio" to view weights</p>
            </div>
          )}
        </div>
      </div>

      {/* Correlation Heatmap */}
      {correlation && correlation.matrix.length > 0 && (
        <div className="space-y-4">
          <div className="border-t border-dark-border pt-8">
            <h3 className="text-xl font-bold text-dark-fg mb-1">Asset Correlation</h3>
            <p className="text-dark-muted text-sm">
              Pearson correlation between daily returns. Lower correlation = better diversification.
              <span className="text-dark-muted/60 ml-1">Source: {correlation.source}</span>
            </p>
          </div>
          <div className="bg-dark-panel border border-dark-border rounded-xl p-6 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-xs text-dark-muted" />
                  {correlation.tickers.map(t => (
                    <th key={t} className="px-3 py-2 text-xs font-semibold text-dark-fg text-center">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {correlation.tickers.map((rowTicker, i) => (
                  <tr key={rowTicker}>
                    <td className="px-3 py-2 text-xs font-semibold text-dark-fg">{rowTicker}</td>
                    {correlation.matrix[i].map((val, j) => {
                      const abs = Math.abs(val);
                      const isIdentity = i === j;
                      let bg: string;
                      if (isIdentity) bg = 'bg-dark-panel2';
                      else if (abs >= 0.7) bg = 'bg-red-500/30';
                      else if (abs >= 0.4) bg = 'bg-yellow-500/20';
                      else bg = 'bg-green-500/20';
                      return (
                        <td key={j} className={`px-3 py-2 text-center font-mono text-sm ${bg} ${isIdentity ? 'text-dark-muted' : 'text-dark-fg'}`}>
                          {val.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Holdings & Rebalance Section */}
      {results && (
        <div className="space-y-6">
          <div className="border-t border-dark-border pt-8">
            <h3 className="text-xl font-bold text-dark-fg mb-2">Rebalance Portfolio</h3>
            <p className="text-dark-muted text-sm">
              Enter your current holdings to get buy/sell recommendations that move you toward the optimal allocation.
            </p>
          </div>

          <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-dark-border">
              <h4 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Current Holdings</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dark-border text-xs text-dark-muted uppercase">
                    <th className="px-6 py-3 text-left">Ticker</th>
                    <th className="px-6 py-3 text-left">Input Mode</th>
                    <th className="px-6 py-3 text-right">Quantity</th>
                    <th className="px-6 py-3 text-right">Price ($)</th>
                    <th className="px-6 py-3 text-right">Value ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => (
                    <tr key={h.ticker} className="border-b border-dark-border last:border-0">
                      <td className="px-6 py-3"><span className="font-bold text-dark-fg">{h.ticker}</span></td>
                      <td className="px-6 py-3">
                        <button
                          onClick={() => toggleHoldingMode(i)}
                          className="text-xs px-2 py-1 rounded border border-dark-border text-dark-muted hover:text-dark-fg hover:border-dark-accent transition-colors"
                        >
                          {h.mode === 'qty-price' ? 'Qty + Price' : 'Value Only'}
                        </button>
                      </td>
                      <td className="px-6 py-3 text-right">
                        {h.mode === 'qty-price' ? (
                          <input type="number" min="0" step="any" placeholder="0" value={h.quantity}
                            onChange={e => updateHolding(i, 'quantity', e.target.value)}
                            className="w-28 px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-right font-mono text-sm focus:ring-dark-accent focus:border-dark-accent" />
                        ) : <span className="text-dark-muted text-sm">--</span>}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {h.mode === 'qty-price' ? (
                          <input type="number" min="0" step="any" placeholder="auto" value={h.price}
                            onChange={e => updateHolding(i, 'price', e.target.value)}
                            className="w-28 px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-right font-mono text-sm focus:ring-dark-accent focus:border-dark-accent" />
                        ) : <span className="text-dark-muted text-sm">--</span>}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {h.mode === 'value' ? (
                          <input type="number" min="0" step="any" placeholder="0" value={h.value}
                            onChange={e => updateHolding(i, 'value', e.target.value)}
                            className="w-32 px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-right font-mono text-sm focus:ring-dark-accent focus:border-dark-accent" />
                        ) : (
                          <span className="font-mono text-sm text-dark-fg">
                            {getHoldingValue(h) > 0 ? `$${getHoldingValue(h).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-dark-border">
                    <td colSpan={4} className="px-6 py-3 text-right text-sm font-semibold text-dark-muted">Total Portfolio Value</td>
                    <td className="px-6 py-3 text-right">
                      <span className="font-mono font-bold text-dark-fg">
                        ${totalHoldingValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs font-semibold text-dark-muted uppercase tracking-wider block mb-2">Rebalance Mode</label>
              <select
                value={rebalanceStrategy}
                onChange={e => setRebalanceStrategy(e.target.value as RebalanceStrategy)}
                className="py-2 px-3 bg-dark-panel border border-dark-border rounded-lg text-dark-fg focus:ring-dark-accent focus:border-dark-accent"
              >
                <option value="rebalance">Full Rebalance (Buy + Sell)</option>
                <option value="buy-only">Buy Only (New Capital)</option>
              </select>
            </div>
            {rebalanceStrategy === 'buy-only' && (
              <div>
                <label className="text-xs font-semibold text-dark-muted uppercase tracking-wider block mb-2">Additional Capital ($)</label>
                <input type="number" min="0" step="any" placeholder="10000" value={additionalCapital}
                  onChange={e => setAdditionalCapital(e.target.value)}
                  className="w-40 py-2 px-3 bg-dark-panel border border-dark-border rounded-lg text-dark-fg font-mono focus:ring-dark-accent focus:border-dark-accent" />
              </div>
            )}
            <button
              onClick={handleRebalance}
              disabled={rebalanceLoading}
              className="py-2.5 px-6 bg-dark-accent text-white rounded-xl font-semibold shadow-lg shadow-dark-accent/20 hover:bg-dark-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {rebalanceLoading ? 'Calculating...' : 'Calculate Rebalance'}
            </button>
          </div>

          {rebalanceError && <p className="text-red-400 text-sm">{rebalanceError}</p>}

          {rebalanceResult && (
            <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-dark-border flex items-center justify-between">
                <h4 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Rebalance Actions</h4>
                <span className="text-xs text-dark-muted">
                  {rebalanceResult.strategy === 'buy-only'
                    ? `Deploying $${rebalanceResult.additional_capital.toLocaleString()} new capital`
                    : `Rebalancing $${rebalanceResult.total_portfolio_value.toLocaleString()} portfolio`}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-dark-border text-xs text-dark-muted uppercase">
                      <th className="px-6 py-3 text-left">Ticker</th>
                      <th className="px-6 py-3 text-center">Action</th>
                      <th className="px-6 py-3 text-right">Shares</th>
                      <th className="px-6 py-3 text-right">Amount ($)</th>
                      <th className="px-6 py-3 text-right">Current %</th>
                      <th className="px-6 py-3 text-center"></th>
                      <th className="px-6 py-3 text-right">Target %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rebalanceResult.actions.sort((a, b) => b.dollar_amount - a.dollar_amount).map(action => (
                      <tr key={action.ticker} className="border-b border-dark-border last:border-0">
                        <td className="px-6 py-3"><span className="font-bold text-dark-fg">{action.ticker}</span></td>
                        <td className="px-6 py-3 text-center">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border ${ACTION_COLORS[action.action]}`}>{action.action}</span>
                        </td>
                        <td className="px-6 py-3 text-right font-mono text-sm text-dark-fg">{action.shares > 0 ? action.shares.toFixed(2) : '--'}</td>
                        <td className="px-6 py-3 text-right font-mono text-sm">
                          <span className={action.action === 'BUY' ? 'text-green-400' : action.action === 'SELL' ? 'text-red-400' : 'text-dark-muted'}>
                            {action.dollar_amount > 0 ? `$${action.dollar_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right font-mono text-sm text-dark-muted">{(action.current_weight * 100).toFixed(1)}%</td>
                        <td className="px-6 py-3 text-center text-dark-muted">&rarr;</td>
                        <td className="px-6 py-3 text-right font-mono text-sm text-dark-accent">{(action.target_weight * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-dark-border">
                      <td className="px-6 py-3 text-sm font-semibold text-dark-muted">Total</td>
                      <td />
                      <td />
                      <td className="px-6 py-3 text-right font-mono text-sm font-bold text-dark-fg">
                        ${rebalanceResult.actions.filter(a => a.action === 'BUY').reduce((s, a) => s + a.dollar_amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {rebalanceResult.actions.some(a => a.action === 'SELL') && (
                          <span className="text-red-400 ml-2">
                            / -${rebalanceResult.actions.filter(a => a.action === 'SELL').reduce((s, a) => s + a.dollar_amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
