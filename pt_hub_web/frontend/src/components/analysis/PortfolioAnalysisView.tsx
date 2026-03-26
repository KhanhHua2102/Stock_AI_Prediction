import { useEffect, useState, useRef } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useAnalysisStore } from '../../store/analysisStore';
import { usePortfolioAnalysisStore } from '../../store/portfolioAnalysisStore';
import { AnalysisLogStream } from './AnalysisLogStream';
import { AnalysisProgressBar } from './AnalysisProgressBar';
import type { AllocationRecommendation, PortfolioAnalysisResult } from '../../store/portfolioAnalysisStore';

const DECISION_COLORS: Record<string, { badge: string; text: string }> = {
  BUY: { badge: 'bg-green-500/20 text-green-400 border-green-500/30', text: 'text-green-400' },
  HOLD: { badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', text: 'text-yellow-400' },
  SELL: { badge: 'bg-red-500/20 text-red-400 border-red-500/30', text: 'text-red-400' },
};

const ACTION_COLORS: Record<string, string> = {
  INCREASE: 'text-green-400',
  DECREASE: 'text-red-400',
  MAINTAIN: 'text-dark-muted',
};

function fmt(n: number, d = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function HealthGauge({ score }: { score: number }) {
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444';
  const pct = Math.min(score, 100);
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#1e293b" strokeWidth="8" />
          <circle
            cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold font-mono" style={{ color }}>{score}</span>
        </div>
      </div>
      <p className="text-xs text-dark-muted mt-2">Portfolio Health</p>
    </div>
  );
}

function DecisionBreakdown({ results }: { results: PortfolioAnalysisResult[] }) {
  const buys = results.filter(r => r.decision === 'BUY').length;
  const holds = results.filter(r => r.decision === 'HOLD').length;
  const sells = results.filter(r => r.decision === 'SELL').length;
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-4">
        <div>
          <p className="text-2xl font-bold text-green-400">{buys}</p>
          <p className="text-xs text-dark-muted">BUY</p>
        </div>
        <div className="w-px h-8 bg-dark-border" />
        <div>
          <p className="text-2xl font-bold text-yellow-400">{holds}</p>
          <p className="text-xs text-dark-muted">HOLD</p>
        </div>
        <div className="w-px h-8 bg-dark-border" />
        <div>
          <p className="text-2xl font-bold text-red-400">{sells}</p>
          <p className="text-xs text-dark-muted">SELL</p>
        </div>
      </div>
      <p className="text-xs text-dark-muted mt-2">Recommendations</p>
    </div>
  );
}

function WeightedUpside({ results }: { results: PortfolioAnalysisResult[] }) {
  const weighted = results.reduce((sum, r) => sum + r.upside * (r.currentWeight / 100), 0);
  const color = weighted >= 0 ? 'text-green-400' : 'text-red-400';
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold font-mono ${color}`}>
        {weighted >= 0 ? '+' : ''}{weighted.toFixed(1)}%
      </p>
      <p className="text-xs text-dark-muted mt-2">Weighted Upside</p>
    </div>
  );
}

function AllocationBar({ alloc }: { alloc: AllocationRecommendation }) {
  const maxW = 100;
  const dc = DECISION_COLORS[alloc.decision] || DECISION_COLORS.HOLD;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-16 text-xs font-bold text-dark-fg truncate">{alloc.ticker}</span>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-3 bg-dark-bg rounded-full overflow-hidden">
            <div className="h-full bg-dark-muted/40 rounded-full" style={{ width: `${(alloc.currentWeight / maxW) * 100}%` }} />
          </div>
          <span className="text-[10px] text-dark-muted font-mono w-10 text-right">{alloc.currentWeight.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-3 bg-dark-bg rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${alloc.decision === 'BUY' ? 'bg-green-500/70' : alloc.decision === 'SELL' ? 'bg-red-500/70' : 'bg-yellow-500/70'}`}
              style={{ width: `${(alloc.targetWeight / maxW) * 100}%` }}
            />
          </div>
          <span className={`text-[10px] font-mono font-bold w-10 text-right ${dc.text}`}>{alloc.targetWeight.toFixed(1)}%</span>
        </div>
      </div>
      <span className={`text-xs font-mono w-12 text-right ${ACTION_COLORS[alloc.action]}`}>
        {alloc.delta >= 0 ? '+' : ''}{alloc.delta.toFixed(1)}%
      </span>
    </div>
  );
}

export function PortfolioAnalysisView() {
  const { portfolios, selectedId, summary, fetchPortfolios, selectPortfolio } = usePortfolioStore();
  const { analysisLogs } = useAnalysisStore();
  const {
    totalTickers, queue, completed, currentTicker, isRunning, cancelled, errors,
    tickerMap,
    results, allocations, healthScore,
    startAnalysis, cancel, reset,
  } = usePortfolioAnalysisStore();
  const [showLogs, setShowLogs] = useState(false);
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());
  const tickerStartTime = useRef<number>(0);

  // Track when currentTicker changes to reset start time
  useEffect(() => {
    if (currentTicker) tickerStartTime.current = Date.now();
  }, [currentTicker]);

  // Helper to show portfolio ticker name for an analysis ticker
  const displayTicker = (t: string) => tickerMap[t] || t;

  useEffect(() => {
    if (portfolios.length === 0) fetchPortfolios();
  }, [portfolios.length, fetchPortfolios]);

  const activeHoldings = summary?.holdings.filter(h => h.quantity > 0) || [];

  // Initialize selection when holdings change
  useEffect(() => {
    if (activeHoldings.length > 0 && selectedTickers.size === 0) {
      setSelectedTickers(new Set(activeHoldings.map(h => h.ticker)));
    }
  }, [activeHoldings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTicker = (ticker: string) => {
    setSelectedTickers(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedTickers.size === activeHoldings.length) {
      setSelectedTickers(new Set());
    } else {
      setSelectedTickers(new Set(activeHoldings.map(h => h.ticker)));
    }
  };

  const handleAnalyze = () => {
    if (!summary || selectedTickers.size === 0) return;
    const holdingsToAnalyze = summary.holdings.filter(h => h.quantity > 0 && selectedTickers.has(h.ticker));
    startAnalysis(holdingsToAnalyze);
  };
  const totalDone = completed.length;
  const totalAll = totalTickers || activeHoldings.length;
  const progressPct = totalAll > 0 ? (totalDone / totalAll) * 100 : 0;
  const hasResults = results.length > 0;

  return (
    <div className="flex-1 overflow-auto p-4 space-y-5 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="text-xs font-semibold text-dark-muted uppercase">Portfolio</label>
        <select
          value={selectedId ?? ''}
          onChange={e => { selectPortfolio(Number(e.target.value)); reset(); }}
          className="py-1.5 px-3 bg-dark-panel border border-dark-border rounded-lg text-dark-fg text-sm"
        >
          <option value="">Select portfolio...</option>
          {portfolios.map(p => (
            <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>
          ))}
        </select>

        {selectedId && activeHoldings.length > 0 && !isRunning && (
          <>
            <button
              onClick={handleAnalyze}
              disabled={selectedTickers.size === 0}
              className="px-4 py-2 text-sm bg-dark-accent text-dark-bg rounded-lg font-semibold hover:bg-dark-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Analyze ({selectedTickers.size} selected)
            </button>
            {hasResults && (
              <button
                onClick={reset}
                className="px-3 py-2 text-sm text-dark-muted border border-dark-border rounded-lg hover:text-dark-fg hover:bg-dark-panel transition-colors"
              >
                Clear
              </button>
            )}
          </>
        )}
        {isRunning && (
          <button
            onClick={cancel}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Ticker Selection */}
      {selectedId && activeHoldings.length > 0 && !isRunning && !hasResults && (
        <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-dark-border flex items-center justify-between">
            <h3 className="text-xs font-semibold text-dark-muted uppercase tracking-wider">Select Holdings to Analyze</h3>
            <button
              onClick={toggleAll}
              className="text-xs text-dark-accent hover:text-dark-accent/80 transition-colors"
            >
              {selectedTickers.size === activeHoldings.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="divide-y divide-dark-border">
            {activeHoldings.map(h => (
              <label
                key={h.ticker}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-dark-panel2/50 transition-colors ${
                  selectedTickers.has(h.ticker) ? 'bg-dark-panel2/30' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedTickers.has(h.ticker)}
                  onChange={() => toggleTicker(h.ticker)}
                  className="w-4 h-4 rounded border-dark-border bg-dark-bg text-dark-accent focus:ring-dark-accent cursor-pointer"
                />
                <span className={`font-bold text-sm ${selectedTickers.has(h.ticker) ? 'text-dark-fg' : 'text-dark-muted'}`}>
                  {h.ticker}
                </span>
                <span className="text-xs text-dark-muted ml-auto font-mono">
                  ${h.market_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-dark-muted font-mono w-12 text-right">
                  {h.weight_pct.toFixed(1)}%
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!selectedId && (
        <div className="flex flex-col items-center justify-center py-16 text-dark-muted gap-3">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="M16 7V5a4 4 0 00-8 0v2" />
          </svg>
          <p className="text-sm">Select a portfolio to analyze its holdings</p>
        </div>
      )}

      {selectedId && activeHoldings.length === 0 && !isRunning && (
        <div className="flex flex-col items-center justify-center py-16 text-dark-muted gap-3">
          <p className="text-sm">No active holdings in this portfolio. Import transactions first.</p>
        </div>
      )}

      {/* Progress */}
      {isRunning && (
        <div className="bg-dark-panel border border-dark-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-dark-fg">Analyzing Portfolio...</h3>
            <span className="text-xs text-dark-muted font-mono">{totalDone} / {totalAll}</span>
          </div>
          <div className="w-full h-2 bg-dark-bg rounded-full overflow-hidden">
            <div className="h-full bg-dark-accent rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="space-y-1.5">
            {completed.map(t => {
              const reports = usePortfolioAnalysisStore.getState().reports;
              const report = reports[t];
              return (
                <div key={t} className="flex items-center gap-2 text-sm">
                  <span className="text-green-400">&#10003;</span>
                  <span className="text-dark-fg">{t}</span>
                  {report && (
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${DECISION_COLORS[report.decision]?.badge}`}>
                      {report.decision}
                    </span>
                  )}
                </div>
              );
            })}
            {currentTicker && (
              <div className="flex items-center gap-2 text-sm">
                <div className="animate-spin w-3.5 h-3.5 border-2 border-dark-accent border-t-transparent rounded-full" />
                <span className="text-dark-accent font-medium">{displayTicker(currentTicker)}</span>
              </div>
            )}
            {queue.map(t => (
              <div key={t} className="flex items-center gap-2 text-sm">
                <span className="w-3.5 h-3.5 flex items-center justify-center text-dark-muted text-xs">&#8226;</span>
                <span className="text-dark-muted">{displayTicker(t)}</span>
              </div>
            ))}
          </div>
          {/* Per-ticker progress bar */}
          {currentTicker && (
            <div className="mt-2">
              <AnalysisProgressBar
                ticker={displayTicker(currentTicker)}
                logs={analysisLogs}
                startTime={tickerStartTime.current}
              />
            </div>
          )}

          {cancelled && <p className="text-xs text-yellow-400">Cancelling after current ticker...</p>}
          {errors.length > 0 && (
            <div className="text-xs text-red-400 space-y-0.5">
              {errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}

          {/* Show/Hide Logs */}
          <div className="flex items-center gap-3 pt-2 border-t border-dark-border">
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="px-3 py-1.5 text-xs bg-dark-bg border border-dark-border rounded-lg text-dark-muted hover:text-dark-fg hover:bg-dark-panel2 transition-colors"
            >
              {showLogs ? 'Hide Logs' : 'Show Logs'}
            </button>
            {currentTicker && (
              <span className="text-xs text-dark-muted">
                Live output from {displayTicker(currentTicker)}
              </span>
            )}
          </div>
          {showLogs && analysisLogs.length > 0 && (
            <AnalysisLogStream logs={analysisLogs} />
          )}
        </div>
      )}

      {/* Results */}
      {hasResults && !isRunning && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-dark-panel border border-dark-border rounded-xl p-5 flex items-center justify-center">
              {healthScore !== null && <HealthGauge score={healthScore} />}
            </div>
            <div className="bg-dark-panel border border-dark-border rounded-xl p-5 flex items-center justify-center">
              <DecisionBreakdown results={results} />
            </div>
            <div className="bg-dark-panel border border-dark-border rounded-xl p-5 flex items-center justify-center">
              <WeightedUpside results={results} />
            </div>
          </div>

          {/* Holdings Analysis Table */}
          <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
            <div className="px-6 py-3 border-b border-dark-border">
              <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Holdings Analysis</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-border text-xs text-dark-muted uppercase">
                    <th className="px-4 py-2 text-left">Ticker</th>
                    <th className="px-4 py-2 text-center">Decision</th>
                    <th className="px-4 py-2 text-center">Score</th>
                    <th className="px-4 py-2 text-right">Current %</th>
                    <th className="px-4 py-2 text-right">Target %</th>
                    <th className="px-4 py-2 text-right">Change</th>
                    <th className="px-4 py-2 text-right">Price</th>
                    <th className="px-4 py-2 text-right">Target Price</th>
                    <th className="px-4 py-2 text-right">Upside</th>
                    <th className="px-4 py-2 text-right">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => {
                    const alloc = allocations.find(a => a.ticker === r.ticker);
                    const dc = DECISION_COLORS[r.decision] || DECISION_COLORS.HOLD;
                    return (
                      <tr key={r.ticker} className="border-b border-dark-border last:border-0 hover:bg-dark-panel2/30">
                        <td className="px-4 py-2.5 font-bold text-dark-fg">{r.ticker}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border ${dc.badge}`}>
                            {r.decision}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-12 h-2 bg-dark-bg rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${r.score >= 70 ? 'bg-green-500' : r.score >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                style={{ width: `${r.score}%` }}
                              />
                            </div>
                            <span className="text-xs font-mono text-dark-fg">{r.score}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-dark-muted">{r.currentWeight.toFixed(1)}%</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-dark-fg">
                          {alloc ? `${alloc.targetWeight.toFixed(1)}%` : '--'}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono text-xs ${alloc ? ACTION_COLORS[alloc.action] : ''}`}>
                          {alloc ? (
                            <>
                              {alloc.action === 'INCREASE' ? '\u2191' : alloc.action === 'DECREASE' ? '\u2193' : '\u2194'}
                              {' '}{alloc.delta >= 0 ? '+' : ''}{alloc.delta.toFixed(1)}%
                            </>
                          ) : '--'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-dark-fg">${fmt(r.currentPrice)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-dark-accent">${fmt(r.targetPrice)}</td>
                        <td className={`px-4 py-2.5 text-right font-mono ${r.upside >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {r.upside >= 0 ? '+' : ''}{r.upside.toFixed(1)}%
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-dark-muted">{r.reportAge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Allocation Comparison */}
          <div className="bg-dark-panel border border-dark-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">Recommended Allocation</h3>
              <div className="flex items-center gap-4 text-xs text-dark-muted">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 bg-dark-muted/40 rounded-sm inline-block" /> Current
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 bg-green-500/70 rounded-sm inline-block" /> Recommended
                </span>
              </div>
            </div>
            <div className="space-y-0.5">
              {allocations
                .sort((a, b) => b.targetWeight - a.targetWeight)
                .map(a => <AllocationBar key={a.ticker} alloc={a} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
