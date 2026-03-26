import { useEffect, useState, useRef } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useAnalysisStore } from '../../store/analysisStore';
import { usePortfolioAnalysisStore } from '../../store/portfolioAnalysisStore';
import { usePortfolioDashboard } from '../../hooks/usePortfolioDashboard';

const dt = (t: string) => t.replace(/:.*$/, '');
import { AnalysisLogStream } from './AnalysisLogStream';
import { AnalysisProgressBar } from './AnalysisProgressBar';
import type { AllocationRecommendation, PortfolioAnalysisResult } from '../../store/portfolioAnalysisStore';

const DECISION_COLORS: Record<string, { badge: React.CSSProperties; text: React.CSSProperties }> = {
  BUY: {
    badge: { background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.25)', color: '#17c964' },
    text: { color: '#17c964' },
  },
  HOLD: {
    badge: { background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.25)', color: '#f5a524' },
    text: { color: '#f5a524' },
  },
  SELL: {
    badge: { background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.25)', color: '#f31260' },
    text: { color: '#f31260' },
  },
};

const ACTION_COLORS: Record<string, React.CSSProperties> = {
  INCREASE: { color: '#17c964' },
  DECREASE: { color: '#f31260' },
  MAINTAIN: { color: '#a1a1aa' },
};

function fmt(n: number, d = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function HealthGauge({ score }: { score: number }) {
  const color = score >= 70 ? '#17c964' : score >= 40 ? '#f5a524' : '#f31260';
  const pct = Math.min(score, 100);
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#27272a" strokeWidth="8" />
          <circle
            cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold font-mono" style={{ color }}>{score}</span>
        </div>
      </div>
      <p className="text-xs mt-2" style={{ color: '#a1a1aa' }}>Portfolio Health</p>
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
          <p className="text-2xl font-bold" style={{ color: '#17c964' }}>{buys}</p>
          <p className="text-xs" style={{ color: '#a1a1aa' }}>BUY</p>
        </div>
        <div className="w-px h-8" style={{ background: '#27272a' }} />
        <div>
          <p className="text-2xl font-bold" style={{ color: '#f5a524' }}>{holds}</p>
          <p className="text-xs" style={{ color: '#a1a1aa' }}>HOLD</p>
        </div>
        <div className="w-px h-8" style={{ background: '#27272a' }} />
        <div>
          <p className="text-2xl font-bold" style={{ color: '#f31260' }}>{sells}</p>
          <p className="text-xs" style={{ color: '#a1a1aa' }}>SELL</p>
        </div>
      </div>
      <p className="text-xs mt-2" style={{ color: '#a1a1aa' }}>Recommendations</p>
    </div>
  );
}

function WeightedUpside({ results }: { results: PortfolioAnalysisResult[] }) {
  const weighted = results.reduce((sum, r) => sum + r.upside * (r.currentWeight / 100), 0);
  const color = weighted >= 0 ? '#17c964' : '#f31260';
  return (
    <div className="text-center">
      <p className="text-2xl font-bold font-mono" style={{ color }}>
        {weighted >= 0 ? '+' : ''}{weighted.toFixed(1)}%
      </p>
      <p className="text-xs mt-2" style={{ color: '#a1a1aa' }}>Weighted Upside</p>
    </div>
  );
}

function AllocationBar({ alloc }: { alloc: AllocationRecommendation }) {
  const maxW = 100;
  const dc = DECISION_COLORS[alloc.decision] || DECISION_COLORS.HOLD;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-16 text-xs font-bold truncate" style={{ color: '#ECEDEE' }}>{dt(alloc.ticker)}</span>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: '#27272a' }}>
            <div className="h-full rounded-full" style={{ width: `${(alloc.currentWeight / maxW) * 100}%`, background: 'rgba(250,250,250,0.18)' }} />
          </div>
          <span className="text-[10px] font-mono w-10 text-right" style={{ color: '#a1a1aa' }}>{alloc.currentWeight.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: '#27272a' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${(alloc.targetWeight / maxW) * 100}%`,
                background: alloc.decision === 'BUY' ? 'rgba(34,197,94,0.7)' : alloc.decision === 'SELL' ? 'rgba(239,68,68,0.7)' : 'rgba(234,179,8,0.7)',
              }}
            />
          </div>
          <span className="text-[10px] font-mono font-bold w-10 text-right" style={dc.text}>{alloc.targetWeight.toFixed(1)}%</span>
        </div>
      </div>
      <span className="text-xs font-mono w-12 text-right" style={ACTION_COLORS[alloc.action]}>
        {alloc.delta >= 0 ? '+' : ''}{alloc.delta.toFixed(1)}%
      </span>
    </div>
  );
}

export function PortfolioAnalysisView() {
  const { portfolios, selectedId, fetchPortfolios, selectPortfolio } = usePortfolioStore();
  const { data: { summary } } = usePortfolioDashboard(selectedId);
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
        <label className="text-xs font-semibold uppercase" style={{ color: '#a1a1aa' }}>Portfolio</label>
        <select
          value={selectedId ?? ''}
          onChange={e => { selectPortfolio(Number(e.target.value)); reset(); }}
          className="glass-input py-1.5 px-3 rounded-lg text-sm"
          style={{ color: '#ECEDEE', background: '#18181b', border: '1px solid #27272a' }}
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
              className="btn btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Analyze ({selectedTickers.size} selected)
            </button>
            {hasResults && (
              <button
                onClick={reset}
                className="btn btn-secondary px-3 py-2 text-sm"
              >
                Clear
              </button>
            )}
          </>
        )}
        {isRunning && (
          <button
            onClick={cancel}
            className="btn btn-danger px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Ticker Selection */}
      {selectedId && activeHoldings.length > 0 && !isRunning && !hasResults && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Select Holdings to Analyze</h3>
            <button
              onClick={toggleAll}
              className="text-xs transition-colors hover:opacity-80"
              style={{ color: '#006FEE' }}
            >
              {selectedTickers.size === activeHoldings.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div>
            {activeHoldings.map((h, idx) => (
              <label
                key={dt(h.ticker)}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
                style={{
                  background: selectedTickers.has(h.ticker) ? 'rgba(99,102,241,0.08)' : 'transparent',
                  borderBottom: idx < activeHoldings.length - 1 ? '1px solid rgba(255, 255, 255, 0.15)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!selectedTickers.has(h.ticker)) e.currentTarget.style.background = '#27272a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = selectedTickers.has(h.ticker) ? 'rgba(99,102,241,0.08)' : 'transparent';
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedTickers.has(h.ticker)}
                  onChange={() => toggleTicker(h.ticker)}
                  className="w-4 h-4 rounded cursor-pointer"
                  style={{ accentColor: '#006FEE' }}
                />
                <span className="font-bold text-sm" style={{ color: selectedTickers.has(h.ticker) ? '#ECEDEE' : '#a1a1aa' }}>
                  {dt(h.ticker)}
                </span>
                <span className="text-xs ml-auto font-mono" style={{ color: '#a1a1aa' }}>
                  ${h.market_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs font-mono w-12 text-right" style={{ color: '#a1a1aa' }}>
                  {h.weight_pct.toFixed(1)}%
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!selectedId && (
        <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: '#a1a1aa' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="M16 7V5a4 4 0 00-8 0v2" />
          </svg>
          <p className="text-sm">Select a portfolio to analyze its holdings</p>
        </div>
      )}

      {selectedId && activeHoldings.length === 0 && !isRunning && (
        <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: '#a1a1aa' }}>
          <p className="text-sm">No active holdings in this portfolio. Import transactions first.</p>
        </div>
      )}

      {/* Progress */}
      {isRunning && (
        <div className="rounded-xl p-5 space-y-4" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: '#ECEDEE' }}>Analyzing Portfolio...</h3>
            <span className="text-xs font-mono" style={{ color: '#a1a1aa' }}>{totalDone} / {totalAll}</span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: '#27272a' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, background: '#006FEE' }}
            />
          </div>
          <div className="space-y-1.5">
            {completed.map(t => {
              const reports = usePortfolioAnalysisStore.getState().reports;
              const report = reports[t];
              return (
                <div key={t} className="flex items-center gap-2 text-sm">
                  <span style={{ color: '#17c964' }}>&#10003;</span>
                  <span style={{ color: '#ECEDEE' }}>{t}</span>
                  {report && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-md font-bold"
                      style={DECISION_COLORS[report.decision]?.badge}
                    >
                      {report.decision}
                    </span>
                  )}
                </div>
              );
            })}
            {currentTicker && (
              <div className="flex items-center gap-2 text-sm">
                <div className="animate-spin w-3.5 h-3.5 rounded-full" style={{ border: '2px solid #006FEE', borderTopColor: 'transparent' }} />
                <span className="font-medium" style={{ color: '#006FEE' }}>{displayTicker(currentTicker)}</span>
              </div>
            )}
            {queue.map(t => (
              <div key={t} className="flex items-center gap-2 text-sm">
                <span className="w-3.5 h-3.5 flex items-center justify-center text-xs" style={{ color: '#a1a1aa' }}>&#8226;</span>
                <span style={{ color: '#a1a1aa' }}>{displayTicker(t)}</span>
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

          {cancelled && <p className="text-xs" style={{ color: '#f5a524' }}>Cancelling after current ticker...</p>}
          {errors.length > 0 && (
            <div className="text-xs space-y-0.5" style={{ color: '#f31260' }}>
              {errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}

          {/* Show/Hide Logs */}
          <div className="flex items-center gap-3 pt-2" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.15)' }}>
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="btn btn-secondary px-3 py-1.5 text-xs"
            >
              {showLogs ? 'Hide Logs' : 'Show Logs'}
            </button>
            {currentTicker && (
              <span className="text-xs" style={{ color: '#a1a1aa' }}>
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
            <div className="rounded-xl p-5 flex items-center justify-center" style={{ background: '#18181b', border: '1px solid #27272a' }}>
              {healthScore !== null && <HealthGauge score={healthScore} />}
            </div>
            <div className="rounded-xl p-5 flex items-center justify-center" style={{ background: '#18181b', border: '1px solid #27272a' }}>
              <DecisionBreakdown results={results} />
            </div>
            <div className="rounded-xl p-5 flex items-center justify-center" style={{ background: '#18181b', border: '1px solid #27272a' }}>
              <WeightedUpside results={results} />
            </div>
          </div>

          {/* Holdings Analysis Table */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#18181b', border: '1px solid #27272a' }}>
            <div className="px-6 py-3" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}>
              <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Holdings Analysis</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)', color: '#a1a1aa' }}>
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
                      <tr
                        key={dt(r.ticker)}
                        className="last:border-0 transition-colors"
                        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#27272a'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td className="px-4 py-2.5 font-bold" style={{ color: '#ECEDEE' }}>{dt(r.ticker)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className="inline-block px-2.5 py-0.5 rounded-md text-xs font-bold"
                            style={dc.badge}
                          >
                            {r.decision}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-12 h-2 rounded-full overflow-hidden" style={{ background: '#27272a' }}>
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${r.score}%`,
                                  background: r.score >= 70 ? '#17c964' : r.score >= 40 ? '#f5a524' : '#f31260',
                                }}
                              />
                            </div>
                            <span className="text-xs font-mono" style={{ color: '#ECEDEE' }}>{r.score}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono" style={{ color: '#a1a1aa' }}>{r.currentWeight.toFixed(1)}%</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold" style={{ color: '#ECEDEE' }}>
                          {alloc ? `${alloc.targetWeight.toFixed(1)}%` : '--'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs" style={alloc ? ACTION_COLORS[alloc.action] : {}}>
                          {alloc ? (
                            <>
                              {alloc.action === 'INCREASE' ? '\u2191' : alloc.action === 'DECREASE' ? '\u2193' : '\u2194'}
                              {' '}{alloc.delta >= 0 ? '+' : ''}{alloc.delta.toFixed(1)}%
                            </>
                          ) : '--'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono" style={{ color: '#ECEDEE' }}>${fmt(r.currentPrice)}</td>
                        <td className="px-4 py-2.5 text-right font-mono" style={{ color: '#17c964' }}>${fmt(r.targetPrice)}</td>
                        <td className="px-4 py-2.5 text-right font-mono" style={{ color: r.upside >= 0 ? '#17c964' : '#f31260' }}>
                          {r.upside >= 0 ? '+' : ''}{r.upside.toFixed(1)}%
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs" style={{ color: '#a1a1aa' }}>{r.reportAge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Allocation Comparison */}
          <div className="rounded-xl p-5" style={{ background: '#18181b', border: '1px solid #27272a' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Recommended Allocation</h3>
              <div className="flex items-center gap-4 text-xs" style={{ color: '#a1a1aa' }}>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded-sm inline-block" style={{ background: 'rgba(250,250,250,0.18)' }} /> Current
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded-sm inline-block" style={{ background: 'rgba(34,197,94,0.7)' }} /> Recommended
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
