import { useMemo, useState } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { PerformanceChart } from './PerformanceChart';
import type { ValueHistoryPoint, MonthlyReturn } from '../../services/types';

const PNL_COLORS = (v: number) =>
  v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-dark-muted';

function formatCurrency(v: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompact(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(2);
}

// ── Returns by Timeframe Grid ──────────────────────────────────
function computeReturnForDays(data: ValueHistoryPoint[], days: number | null): { dollar: number; pct: number } | null {
  if (data.length < 2) return null;
  const last = data[data.length - 1];
  if (days === null) {
    // "All" — use first point
    const first = data[0];
    if (first.value <= 0) return null;
    return { dollar: last.value - first.value, pct: (last.value / first.value - 1) * 100 };
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  // Find closest point at or after cutoff
  const start = data.find(d => d.date >= cutoffStr) || data[0];
  if (start.value <= 0) return null;
  return { dollar: last.value - start.value, pct: (last.value / start.value - 1) * 100 };
}

function ReturnsGrid({ data }: { data: ValueHistoryPoint[] }) {
  const periods = [
    { label: '1W', days: 7 },
    { label: '1M', days: 30 },
    { label: '3M', days: 90 },
    { label: '6M', days: 180 },
    { label: '1Y', days: 365 },
    { label: 'All', days: null as number | null },
  ];

  const results = periods.map(p => ({
    ...p,
    result: computeReturnForDays(data, p.days),
  }));

  return (
    <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
      <div className="px-6 py-3 border-b border-dark-border">
        <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Returns by Period</h3>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6">
        {results.map((r, i) => (
          <div
            key={r.label}
            className={`p-4 ${i < results.length - 1 ? 'border-r border-dark-border' : ''} ${i >= 3 ? 'border-t border-dark-border md:border-t-0' : ''}`}
          >
            <p className="text-xs text-dark-muted font-semibold mb-2">{r.label}</p>
            {r.result ? (
              <>
                <p className={`text-sm font-bold font-mono ${PNL_COLORS(r.result.dollar)}`}>
                  {r.result.dollar >= 0 ? '+' : ''}${formatCompact(r.result.dollar)}
                </p>
                <p className={`text-xs font-mono mt-0.5 flex items-center gap-1 ${PNL_COLORS(r.result.pct)}`}>
                  <span>{r.result.pct >= 0 ? '\u2191' : '\u2193'}</span>
                  {r.result.pct >= 0 ? '+' : ''}{r.result.pct.toFixed(1)}%
                </p>
              </>
            ) : (
              <p className="text-sm text-dark-muted">--</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Monthly Returns Bar Chart ──────────────────────────────────
function MonthlyReturnsChart({ data }: { data: MonthlyReturn[] }) {
  const maxAbs = Math.max(...data.map(d => Math.abs(d.return_pct)), 1);

  return (
    <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
      <div className="px-6 py-3 border-b border-dark-border">
        <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Monthly Returns</h3>
      </div>
      <div className="p-4">
        {/* Bar chart */}
        <div className="flex items-end gap-1" style={{ height: 160 }}>
          {data.map(m => {
            const barHeight = (Math.abs(m.return_pct) / maxAbs) * 100;
            const isPositive = m.return_pct >= 0;
            return (
              <div key={m.period} className="flex-1 flex flex-col items-center justify-end h-full relative group">
                {/* Tooltip */}
                <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                  <div className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
                    <span className="text-dark-muted">{m.period}: </span>
                    <span className={PNL_COLORS(m.return_pct)}>
                      {m.return_pct >= 0 ? '+' : ''}{m.return_pct.toFixed(2)}%
                    </span>
                  </div>
                </div>
                {isPositive ? (
                  <div className="w-full flex flex-col justify-end" style={{ height: '50%' }}>
                    <div
                      className="w-full bg-green-500/70 rounded-t-sm transition-all hover:bg-green-500"
                      style={{ height: `${barHeight}%`, minHeight: m.return_pct !== 0 ? 2 : 0 }}
                    />
                  </div>
                ) : (
                  <div className="w-full" style={{ height: '50%' }} />
                )}
                {!isPositive ? (
                  <div className="w-full" style={{ height: '50%' }}>
                    <div
                      className="w-full bg-red-500/70 rounded-b-sm transition-all hover:bg-red-500"
                      style={{ height: `${barHeight}%`, minHeight: m.return_pct !== 0 ? 2 : 0 }}
                    />
                  </div>
                ) : (
                  <div className="w-full" style={{ height: '50%' }} />
                )}
              </div>
            );
          })}
        </div>
        {/* Zero line */}
        <div className="border-t border-dark-border/50 -mt-[80px] mb-[80px]" />
        {/* Labels */}
        <div className="flex gap-1 mt-2">
          {data.map((m, i) => (
            <div key={m.period} className="flex-1 text-center">
              {i % Math.max(1, Math.floor(data.length / 8)) === 0 ? (
                <span className="text-[9px] text-dark-muted font-mono">
                  {m.period.slice(2).replace('-', '/')}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────
export function PortfolioDashboard() {
  const { selectedId, summary, dashboardLoading, valueHistory, performance, allocation, monthlyReturns, drawdown, stockBreakdown, closedBreakdown, dividends, rebuildSnapshots } = usePortfolioStore();
  const [rebuilding, setRebuilding] = useState(false);

  const handleRebuild = async () => {
    if (!selectedId || rebuilding) return;
    setRebuilding(true);
    try {
      await rebuildSnapshots(selectedId);
    } finally {
      setRebuilding(false);
    }
  };

  const capitalGain = useMemo(() => {
    if (!summary) return 0;
    return summary.unrealised_pnl + summary.realised_pnl;
  }, [summary]);

  if (dashboardLoading && !summary) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin w-6 h-6 border-2 border-dark-accent border-t-transparent rounded-full" />
        <span className="ml-3 text-dark-muted">Loading dashboard...</span>
      </div>
    );
  }

  if (!summary || summary.holdings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-dark-muted gap-4">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20v-6M6 20V10M18 20V4" />
        </svg>
        <p>No holdings yet. Import transactions to get started.</p>
      </div>
    );
  }

  const totalGain = summary.unrealised_pnl + summary.realised_pnl + summary.total_dividends;
  const totalGainPct = summary.total_cost > 0 ? (totalGain / summary.total_cost * 100) : 0;
  const hasChartData = valueHistory.length > 1 || (performance && performance.portfolio.length > 1) || drawdown.length > 1;

  return (
    <div className="space-y-6">
      {/* Total Investments + Returns by Period — 2 col */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hero Summary */}
        <div className="bg-dark-panel border border-dark-border rounded-xl p-6 self-start">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs text-dark-muted uppercase tracking-wider">Total Investments</p>
            <button
              onClick={handleRebuild}
              disabled={rebuilding}
              title="Rebuild chart snapshots"
              className="text-dark-muted hover:text-dark-accent transition-colors disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={rebuilding ? 'animate-spin' : ''}>
                <path d="M21 2v6h-6M3 12a9 9 0 0115.36-6.36L21 8M3 22v-6h6M21 12a9 9 0 01-15.36 6.36L3 16" />
              </svg>
            </button>
          </div>
          <p className="text-3xl font-bold font-mono text-dark-fg">${formatCurrency(summary.total_value)}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className={`text-sm font-mono font-bold ${PNL_COLORS(totalGainPct)}`}>
              {totalGainPct >= 0 ? '+' : ''}{totalGainPct.toFixed(2)}%
            </span>
            <span className={`text-sm font-mono font-bold px-2 py-0.5 rounded ${totalGain >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {totalGain >= 0 ? '+' : ''}${formatCurrency(totalGain)}
            </span>
          </div>
          <div className="flex gap-6 mt-4 pt-4 border-t border-dark-border">
            <div className="text-center">
              <p className="text-lg font-bold font-mono text-dark-fg">${formatCurrency(summary.total_cost)}</p>
              <p className="text-xs text-dark-muted">Invested</p>
            </div>
            <div className="text-center">
              <p className={`text-lg font-bold font-mono ${PNL_COLORS(capitalGain)}`}>${formatCurrency(capitalGain)}</p>
              <p className="text-xs text-dark-muted">Capital gain</p>
            </div>
            <div className="text-center">
              <p className={`text-lg font-bold font-mono ${summary.total_dividends > 0 ? 'text-green-400' : 'text-dark-fg'}`}>${formatCurrency(summary.total_dividends)}</p>
              <p className="text-xs text-dark-muted">Income gain</p>
            </div>
          </div>
        </div>

        {/* Returns by Timeframe Grid */}
        {valueHistory.length > 1 && <ReturnsGrid data={valueHistory} />}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-dark-panel border border-dark-border rounded-xl p-4">
          <p className="text-xs text-dark-muted uppercase tracking-wider mb-1">Unrealised P&L</p>
          <p className={`text-lg font-bold font-mono ${PNL_COLORS(summary.unrealised_pnl)}`}>${formatCurrency(summary.unrealised_pnl)}</p>
        </div>
        <div className="bg-dark-panel border border-dark-border rounded-xl p-4">
          <p className="text-xs text-dark-muted uppercase tracking-wider mb-1">Realised P&L</p>
          <p className={`text-lg font-bold font-mono ${PNL_COLORS(summary.realised_pnl)}`}>${formatCurrency(summary.realised_pnl)}</p>
        </div>
        <div className="bg-dark-panel border border-dark-border rounded-xl p-4">
          <p className="text-xs text-dark-muted uppercase tracking-wider mb-1">Annualised Return</p>
          <p className={`text-lg font-bold font-mono ${PNL_COLORS(summary.annualised_return)}`}>{summary.annualised_return.toFixed(2)}%</p>
        </div>
      </div>

      {/* Risk Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-dark-panel border border-dark-border rounded-xl p-4">
          <p className="text-xs text-dark-muted uppercase tracking-wider mb-1">Sharpe Ratio</p>
          <p className={`text-lg font-bold font-mono ${summary.sharpe_ratio >= 1 ? 'text-green-400' : summary.sharpe_ratio >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
            {summary.sharpe_ratio.toFixed(2)}
          </p>
          <p className="text-[10px] text-dark-muted mt-1">Risk-adjusted return</p>
        </div>
        <div className="bg-dark-panel border border-dark-border rounded-xl p-4">
          <p className="text-xs text-dark-muted uppercase tracking-wider mb-1">Beta</p>
          <p className={`text-lg font-bold font-mono ${summary.beta > 1.1 ? 'text-red-400' : summary.beta < 0.9 ? 'text-green-400' : 'text-yellow-400'}`}>
            {summary.beta.toFixed(2)}
          </p>
          <p className="text-[10px] text-dark-muted mt-1">{summary.beta > 1 ? 'More volatile than market' : summary.beta < 1 ? 'Less volatile than market' : 'Moves with market'}</p>
        </div>
        <div className="bg-dark-panel border border-dark-border rounded-xl p-4">
          <p className="text-xs text-dark-muted uppercase tracking-wider mb-1">Max Drawdown</p>
          <p className="text-lg font-bold font-mono text-red-400">{summary.max_drawdown.toFixed(2)}%</p>
          <p className="text-[10px] text-dark-muted mt-1">Largest peak-to-trough drop</p>
        </div>
      </div>

      {/* Advanced Performance Chart */}
      {hasChartData && <PerformanceChart />}

      {/* Current Holdings — full width */}
      {stockBreakdown.length > 0 && (() => {
        const totalMV = stockBreakdown.reduce((s, h) => s + h.market_value, 0);
        return (
          <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
            <div className="px-6 py-3 border-b border-dark-border">
              <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Current Holdings</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-border text-xs text-dark-muted uppercase">
                    <th className="px-4 py-2 text-left">Ticker</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Avg Cost</th>
                    <th className="px-4 py-2 text-right">Price</th>
                    <th className="px-4 py-2 text-right">Market Value</th>
                    <th className="px-4 py-2 text-right">Weight</th>
                    <th className="px-4 py-2 text-right">Unrealised</th>
                    <th className="px-4 py-2 text-right">Realised</th>
                    <th className="px-4 py-2 text-right">Dividends</th>
                    <th className="px-4 py-2 text-right">Total Return</th>
                  </tr>
                </thead>
                <tbody>
                  {stockBreakdown.map(s => (
                    <tr key={s.ticker} className="border-b border-dark-border last:border-0">
                      <td className="px-4 py-2 font-bold text-dark-fg">{s.ticker}</td>
                      <td className="px-4 py-2 text-right font-mono text-dark-fg">{s.quantity.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-dark-muted">${s.avg_cost.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-dark-fg">${s.current_price.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-dark-fg">${formatCurrency(s.market_value)}</td>
                      <td className="px-4 py-2 text-right font-mono text-dark-muted">{totalMV > 0 ? (s.market_value / totalMV * 100).toFixed(1) : '0.0'}%</td>
                      <td className={`px-4 py-2 text-right font-mono ${PNL_COLORS(s.unrealised_pnl)}`}>${formatCurrency(s.unrealised_pnl)}</td>
                      <td className={`px-4 py-2 text-right font-mono ${PNL_COLORS(s.realised_pnl)}`}>${formatCurrency(s.realised_pnl)}</td>
                      <td className="px-4 py-2 text-right font-mono text-dark-fg">${formatCurrency(s.dividends)}</td>
                      <td className={`px-4 py-2 text-right font-mono font-bold ${PNL_COLORS(s.total_return)}`}>
                        ${formatCurrency(s.total_return)}
                        <span className="text-xs ml-1">({s.total_return_pct >= 0 ? '+' : ''}{s.total_return_pct.toFixed(1)}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Sector Allocation + Closed Positions — 2 col */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {allocation.length > 0 && (
          <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden self-start">
            <div className="px-6 py-3 border-b border-dark-border">
              <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Sector Allocation</h3>
            </div>
            <div className="p-4 space-y-3">
              {allocation.map(a => (
                <div key={a.sector}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-dark-fg">{a.sector}</span>
                    <span className="text-dark-muted font-mono">{a.weight_pct.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-dark-bg h-2 rounded-full overflow-hidden">
                    <div className="bg-dark-accent h-full rounded-full transition-all" style={{ width: `${a.weight_pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {closedBreakdown.length > 0 && (
          <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden self-start">
            <div className="px-6 py-3 border-b border-dark-border">
              <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Closed Positions</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-border text-xs text-dark-muted uppercase">
                    <th className="px-4 py-2 text-left">Ticker</th>
                    <th className="px-4 py-2 text-right">Realised P&L</th>
                    <th className="px-4 py-2 text-right">Dividends</th>
                    <th className="px-4 py-2 text-right">Total Return</th>
                  </tr>
                </thead>
                <tbody>
                  {closedBreakdown.map(s => (
                    <tr key={s.ticker} className="border-b border-dark-border last:border-0">
                      <td className="px-4 py-2 font-bold text-dark-muted">{s.ticker}</td>
                      <td className={`px-4 py-2 text-right font-mono ${PNL_COLORS(s.realised_pnl)}`}>${formatCurrency(s.realised_pnl)}</td>
                      <td className="px-4 py-2 text-right font-mono text-dark-fg">${formatCurrency(s.dividends)}</td>
                      <td className={`px-4 py-2 text-right font-mono font-bold ${PNL_COLORS(s.total_return)}`}>
                        ${formatCurrency(s.total_return)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Monthly Returns Bar Chart */}
      {monthlyReturns.length > 0 && <MonthlyReturnsChart data={monthlyReturns} />}

      {/* Dividend Income */}
      {dividends.length > 0 && dividends.some(d => d.amount > 0) && (
        <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
          <div className="px-6 py-3 border-b border-dark-border">
            <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Dividend Income</h3>
          </div>
          <div className="p-4">
            <div className="flex items-end gap-1" style={{ height: 100 }}>
              {dividends.map(d => {
                const maxDiv = Math.max(...dividends.map(dd => dd.amount), 1);
                const barH = (d.amount / maxDiv) * 100;
                return (
                  <div key={d.period} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                    <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                      <div className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
                        {d.period}: ${formatCurrency(d.amount)}
                      </div>
                    </div>
                    <div
                      className="w-full bg-purple-500/70 rounded-t-sm hover:bg-purple-500 transition-all"
                      style={{ height: `${barH}%`, minHeight: d.amount > 0 ? 2 : 0 }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1 mt-2">
              {dividends.map((d, i) => (
                <div key={d.period} className="flex-1 text-center">
                  {i % Math.max(1, Math.floor(dividends.length / 8)) === 0 ? (
                    <span className="text-[9px] text-dark-muted font-mono">{d.period.slice(2).replace('-', '/')}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
