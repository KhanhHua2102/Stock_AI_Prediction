import { useState, useEffect } from 'react';
import { useSettingsStore, selectTickers } from '../../store/settingsStore';
import { portfolioApi } from '../../services/api';
import type { PortfolioOptimizationResult, RebalanceResult, CorrelationResult } from '../../services/types';

const dt = (t: string) => t.replace(/:.*$/, '');

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

const ACTION_STYLES: Record<string, React.CSSProperties> = {
  BUY: { background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.25)', color: '#17c964' },
  SELL: { background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.25)', color: '#f31260' },
  HOLD: { background: '#27272a', border: '1px solid #27272a', color: '#a1a1aa' },
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
        <h2 className="text-lg font-bold mb-1" style={{ color: '#ECEDEE' }}>Portfolio Optimization</h2>
        <p className="text-sm" style={{ color: '#a1a1aa' }}>
          Select assets from your watchlist to calculate optimal portfolio allocations using
          Modern Portfolio Theory and Risk Parity.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Ticker Selection */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>
            Select Assets ({selectedTickers.length})
          </h3>
          <div className="rounded-xl overflow-hidden" style={{ background: '#18181b', border: '1px solid #27272a' }}>
            <div className="max-h-96 overflow-y-auto">
              {allTickers.map(ticker => (
                <label
                  key={ticker}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors last:border-0"
                  style={{
                    borderBottom: '1px solid #27272a',
                    background: selectedTickers.includes(ticker) ? '#27272a' : undefined,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#27272a'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = selectedTickers.includes(ticker) ? '#27272a' : ''; }}
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded"
                    style={{ accentColor: '#006FEE' }}
                    checked={selectedTickers.includes(ticker)}
                    onChange={() => toggleTicker(ticker)}
                  />
                  <span className="font-medium" style={{ color: selectedTickers.includes(ticker) ? '#ECEDEE' : '#a1a1aa' }}>
                    {dt(ticker)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: '#a1a1aa' }}>Strategy</label>
            <select
              value={strategy}
              onChange={e => setStrategy(e.target.value as Strategy)}
              className="w-full py-2 px-3 rounded-xl"
              style={{ background: '#27272a', border: '1px solid #27272a', color: '#ECEDEE', outline: 'none' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#006FEE'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#27272a'; }}
            >
              <option value="mean-variance">Mean-Variance (Min Volatility)</option>
              <option value="equal-weight">Equal Weight</option>
            </select>
          </div>

          <button
            onClick={handleOptimize}
            disabled={loading || selectedTickers.length < 2}
            className="w-full py-3 px-4 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all text-white"
            style={{ background: '#006FEE' }}
            onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = '#338ef7'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#006FEE'; }}
          >
            {loading ? 'Optimizing...' : 'Optimize Portfolio'}
          </button>
          {error && <p className="text-sm mt-2" style={{ color: '#f31260' }}>{error}</p>}
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Optimal Weights</h3>

          {results ? (
            <>
              <div className="rounded-xl p-6" style={{ background: '#18181b', border: '1px solid #27272a' }}>
                <div className="space-y-6">
                  {results.assets.sort((a, b) => b.weight - a.weight).map(asset => (
                    <div key={dt(asset.ticker)} className="space-y-2">
                      <div className="flex justify-between items-end">
                        <span className="text-lg font-bold" style={{ color: '#ECEDEE' }}>{dt(asset.ticker)}</span>
                        <span className="font-mono text-xl" style={{ color: '#006FEE' }}>{(asset.weight * 100).toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: '#27272a' }}>
                        <div
                          className="h-full rounded-full transition-all duration-1000"
                          style={{
                            width: `${asset.weight * 100}%`,
                            background: '#006FEE',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-8 pt-6" style={{ borderTop: '1px solid #27272a' }}>
                  <div className="flex justify-between items-center">
                    <span style={{ color: '#a1a1aa' }}>Total Allocation</span>
                    <span className="font-bold" style={{ color: '#ECEDEE' }}>{(results.assets.reduce((s, a) => s + a.weight, 0) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>

              {results.portfolio_return !== null && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-xl p-4 text-center" style={{ background: '#18181b', border: '1px solid #27272a' }}>
                    <p className="text-xs uppercase mb-1" style={{ color: '#a1a1aa' }}>Expected Return</p>
                    <p className="text-2xl font-bold font-mono" style={{ color: (results.portfolio_return ?? 0) >= 0 ? '#17c964' : '#f31260' }}>
                      {results.portfolio_return?.toFixed(1)}%
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#a1a1aa' }}>annualized</p>
                  </div>
                  <div className="rounded-xl p-4 text-center" style={{ background: '#18181b', border: '1px solid #27272a' }}>
                    <p className="text-xs uppercase mb-1" style={{ color: '#a1a1aa' }}>Volatility</p>
                    <p className="text-2xl font-bold font-mono" style={{ color: '#f5a524' }}>{results.portfolio_volatility?.toFixed(1)}%</p>
                    <p className="text-xs mt-1" style={{ color: '#a1a1aa' }}>annualized</p>
                  </div>
                  <div className="rounded-xl p-4 text-center" style={{ background: '#18181b', border: '1px solid #27272a' }}>
                    <p className="text-xs uppercase mb-1" style={{ color: '#a1a1aa' }}>Sharpe Ratio</p>
                    <p className="text-2xl font-bold font-mono" style={{ color: (results.sharpe_ratio ?? 0) >= 1 ? '#17c964' : (results.sharpe_ratio ?? 0) >= 0 ? '#f5a524' : '#f31260' }}>
                      {results.sharpe_ratio?.toFixed(2)}
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#a1a1aa' }}>risk-adjusted</p>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-xl" style={{ background: '#18181b', border: '1px solid #27272a' }}>
                <h4 className="text-xs font-semibold uppercase mb-2" style={{ color: '#a1a1aa' }}>Strategy Used</h4>
                <p className="text-xs leading-relaxed" style={{ color: '#a1a1aa' }}>
                  {results.strategy === 'mean-variance'
                    ? 'Mean-Variance Optimization (Minimum Volatility) via Portfolio Optimizer API. Weights are computed to minimize portfolio risk given historical return correlations.'
                    : results.strategy.includes('fallback')
                    ? 'Equal Weight (fallback). The optimization API was unavailable, so weights are distributed equally across selected assets.'
                    : 'Equal Weight allocation. Each asset receives an identical share of the portfolio.'}
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-xl h-64 flex flex-col items-center justify-center gap-4" style={{ background: '#18181b', border: '1px solid #27272a', color: '#a1a1aa' }}>
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
          <div className="pt-8" style={{ borderTop: '1px solid #27272a' }}>
            <h3 className="text-xl font-bold mb-1" style={{ color: '#ECEDEE' }}>Asset Correlation</h3>
            <p className="text-sm" style={{ color: '#a1a1aa' }}>
              Pearson correlation between daily returns. Lower correlation = better diversification.
              <span className="ml-1" style={{ color: '#a1a1aa', opacity: 0.6 }}>Source: {correlation.source}</span>
            </p>
          </div>
          <div className="rounded-xl p-6 overflow-x-auto" style={{ background: '#18181b', border: '1px solid #27272a' }}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-xs" style={{ color: '#a1a1aa' }} />
                  {correlation.tickers.map(t => (
                    <th key={t} className="px-3 py-2 text-xs font-semibold text-center" style={{ color: '#ECEDEE' }}>{dt(t)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {correlation.tickers.map((rowTicker, i) => (
                  <tr key={rowTicker}>
                    <td className="px-3 py-2 text-xs font-semibold" style={{ color: '#ECEDEE' }}>{dt(rowTicker)}</td>
                    {correlation.matrix[i].map((val, j) => {
                      const abs = Math.abs(val);
                      const isIdentity = i === j;
                      let bgColor: string;
                      if (isIdentity) bgColor = '#27272a';
                      else if (abs >= 0.7) bgColor = 'rgba(239,68,68,0.2)';
                      else if (abs >= 0.4) bgColor = 'rgba(234,179,8,0.15)';
                      else bgColor = 'rgba(34,197,94,0.15)';
                      return (
                        <td
                          key={j}
                          className="px-3 py-2 text-center font-mono text-sm"
                          style={{
                            background: bgColor,
                            color: isIdentity ? '#a1a1aa' : '#ECEDEE',
                          }}
                        >
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
          <div className="pt-8" style={{ borderTop: '1px solid #27272a' }}>
            <h3 className="text-xl font-bold mb-2" style={{ color: '#ECEDEE' }}>Rebalance Portfolio</h3>
            <p className="text-sm" style={{ color: '#a1a1aa' }}>
              Enter your current holdings to get buy/sell recommendations that move you toward the optimal allocation.
            </p>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ background: '#18181b', border: '1px solid #27272a' }}>
            <div className="px-6 py-4" style={{ borderBottom: '1px solid #27272a' }}>
              <h4 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Current Holdings</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs uppercase" style={{ borderBottom: '1px solid #27272a', color: '#a1a1aa' }}>
                    <th className="px-6 py-3 text-left">Ticker</th>
                    <th className="px-6 py-3 text-left">Input Mode</th>
                    <th className="px-6 py-3 text-right">Quantity</th>
                    <th className="px-6 py-3 text-right">Price ($)</th>
                    <th className="px-6 py-3 text-right">Value ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => (
                    <tr key={dt(h.ticker)} className="last:border-0" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}>
                      <td className="px-6 py-3"><span className="font-bold" style={{ color: '#ECEDEE' }}>{dt(h.ticker)}</span></td>
                      <td className="px-6 py-3">
                        <button
                          onClick={() => toggleHoldingMode(i)}
                          className="text-xs px-2 py-1 rounded-lg transition-colors"
                          style={{ border: '1px solid #27272a', color: '#a1a1aa' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ECEDEE'; (e.currentTarget as HTMLElement).style.borderColor = '#006FEE'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#a1a1aa'; (e.currentTarget as HTMLElement).style.borderColor = '#27272a'; }}
                        >
                          {h.mode === 'qty-price' ? 'Qty + Price' : 'Value Only'}
                        </button>
                      </td>
                      <td className="px-6 py-3 text-right">
                        {h.mode === 'qty-price' ? (
                          <input type="number" min="0" step="any" placeholder="0" value={h.quantity}
                            onChange={e => updateHolding(i, 'quantity', e.target.value)}
                            className="w-28 px-3 py-1.5 rounded-xl text-right font-mono text-sm"
                            style={{ background: '#27272a', border: '1px solid #27272a', color: '#ECEDEE', outline: 'none' }}
                            onFocus={e => { e.currentTarget.style.borderColor = '#006FEE'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = '#27272a'; }}
                          />
                        ) : <span className="text-sm" style={{ color: '#a1a1aa' }}>--</span>}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {h.mode === 'qty-price' ? (
                          <input type="number" min="0" step="any" placeholder="auto" value={h.price}
                            onChange={e => updateHolding(i, 'price', e.target.value)}
                            className="w-28 px-3 py-1.5 rounded-xl text-right font-mono text-sm"
                            style={{ background: '#27272a', border: '1px solid #27272a', color: '#ECEDEE', outline: 'none' }}
                            onFocus={e => { e.currentTarget.style.borderColor = '#006FEE'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = '#27272a'; }}
                          />
                        ) : <span className="text-sm" style={{ color: '#a1a1aa' }}>--</span>}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {h.mode === 'value' ? (
                          <input type="number" min="0" step="any" placeholder="0" value={h.value}
                            onChange={e => updateHolding(i, 'value', e.target.value)}
                            className="w-32 px-3 py-1.5 rounded-xl text-right font-mono text-sm"
                            style={{ background: '#27272a', border: '1px solid #27272a', color: '#ECEDEE', outline: 'none' }}
                            onFocus={e => { e.currentTarget.style.borderColor = '#006FEE'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = '#27272a'; }}
                          />
                        ) : (
                          <span className="font-mono text-sm" style={{ color: '#ECEDEE' }}>
                            {getHoldingValue(h) > 0 ? `$${getHoldingValue(h).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #27272a' }}>
                    <td colSpan={4} className="px-6 py-3 text-right text-sm font-semibold" style={{ color: '#a1a1aa' }}>Total Portfolio Value</td>
                    <td className="px-6 py-3 text-right">
                      <span className="font-mono font-bold" style={{ color: '#ECEDEE' }}>
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
              <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: '#a1a1aa' }}>Rebalance Mode</label>
              <select
                value={rebalanceStrategy}
                onChange={e => setRebalanceStrategy(e.target.value as RebalanceStrategy)}
                className="py-2 px-3 rounded-xl"
                style={{ background: '#27272a', border: '1px solid #27272a', color: '#ECEDEE', outline: 'none' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#006FEE'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#27272a'; }}
              >
                <option value="rebalance">Full Rebalance (Buy + Sell)</option>
                <option value="buy-only">Buy Only (New Capital)</option>
              </select>
            </div>
            {rebalanceStrategy === 'buy-only' && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: '#a1a1aa' }}>Additional Capital ($)</label>
                <input type="number" min="0" step="any" placeholder="10000" value={additionalCapital}
                  onChange={e => setAdditionalCapital(e.target.value)}
                  className="w-40 py-2 px-3 rounded-xl font-mono"
                  style={{ background: '#27272a', border: '1px solid #27272a', color: '#ECEDEE', outline: 'none' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#006FEE'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#27272a'; }}
                />
              </div>
            )}
            <button
              onClick={handleRebalance}
              disabled={rebalanceLoading}
              className="py-2.5 px-6 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all text-white"
              style={{ background: '#006FEE' }}
              onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = '#338ef7'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#006FEE'; }}
            >
              {rebalanceLoading ? 'Calculating...' : 'Calculate Rebalance'}
            </button>
          </div>

          {rebalanceError && <p className="text-sm" style={{ color: '#f31260' }}>{rebalanceError}</p>}

          {rebalanceResult && (
            <div className="rounded-xl overflow-hidden" style={{ background: '#18181b', border: '1px solid #27272a' }}>
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #27272a' }}>
                <h4 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Rebalance Actions</h4>
                <span className="text-xs" style={{ color: '#a1a1aa' }}>
                  {rebalanceResult.strategy === 'buy-only'
                    ? `Deploying $${rebalanceResult.additional_capital.toLocaleString()} new capital`
                    : `Rebalancing $${rebalanceResult.total_portfolio_value.toLocaleString()} portfolio`}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs uppercase" style={{ borderBottom: '1px solid #27272a', color: '#a1a1aa' }}>
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
                      <tr key={dt(action.ticker)} className="last:border-0" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}>
                        <td className="px-6 py-3"><span className="font-bold" style={{ color: '#ECEDEE' }}>{dt(action.ticker)}</span></td>
                        <td className="px-6 py-3 text-center">
                          <span
                            className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold"
                            style={ACTION_STYLES[action.action]}
                          >
                            {action.action}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right font-mono text-sm" style={{ color: '#ECEDEE' }}>{action.shares > 0 ? action.shares.toFixed(2) : '--'}</td>
                        <td className="px-6 py-3 text-right font-mono text-sm">
                          <span style={{ color: action.action === 'BUY' ? '#17c964' : action.action === 'SELL' ? '#f31260' : '#a1a1aa' }}>
                            {action.dollar_amount > 0 ? `$${action.dollar_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right font-mono text-sm" style={{ color: '#a1a1aa' }}>{(action.current_weight * 100).toFixed(1)}%</td>
                        <td className="px-6 py-3 text-center" style={{ color: '#a1a1aa' }}>&rarr;</td>
                        <td className="px-6 py-3 text-right font-mono text-sm" style={{ color: '#006FEE' }}>{(action.target_weight * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #27272a' }}>
                      <td className="px-6 py-3 text-sm font-semibold" style={{ color: '#a1a1aa' }}>Total</td>
                      <td />
                      <td />
                      <td className="px-6 py-3 text-right font-mono text-sm font-bold" style={{ color: '#ECEDEE' }}>
                        ${rebalanceResult.actions.filter(a => a.action === 'BUY').reduce((s, a) => s + a.dollar_amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {rebalanceResult.actions.some(a => a.action === 'SELL') && (
                          <span style={{ color: '#f31260' }} className="ml-2">
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
