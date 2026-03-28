import { useState, useEffect } from 'react';
import { Select, SelectItem } from '@heroui/select';
import { Button } from '@heroui/button';
import { backtestApi } from '../../services/api';
import { useSettingsStore, selectTickers } from '../../store/settingsStore';
import type { BacktestResult, BacktestSummary } from '../../services/types';

const OUTCOME_COLORS = {
  WIN: '#17c964',
  LOSS: '#f31260',
  NEUTRAL: '#a1a1aa',
};

const DECISION_COLORS = {
  BUY: '#17c964',
  HOLD: '#f5a524',
  SELL: '#f31260',
};

export function AccuracyView() {
  const tickers = useSettingsStore(selectTickers);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [total, setTotal] = useState(0);
  const [filterTicker, setFilterTicker] = useState('');
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = async (ticker?: string) => {
    setLoading(true);
    try {
      const [summaryRes, resultsRes] = await Promise.all([
        backtestApi.getSummary(ticker || undefined),
        backtestApi.getResults(ticker || undefined, 50, 0),
      ]);
      setSummary(summaryRes.summary);
      setResults(resultsRes.results);
      setTotal(resultsRes.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(filterTicker);
  }, [filterTicker]);

  const handleRunBacktest = async () => {
    setRunning(true);
    try {
      const res = await backtestApi.run(filterTicker || undefined);
      setSummary(res.summary);
      // Reload results
      const resultsRes = await backtestApi.getResults(filterTicker || undefined, 50, 0);
      setResults(resultsRes.results);
      setTotal(resultsRes.total);
    } catch {
      // ignore
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-4 max-w-4xl mx-auto">
        {/* Controls */}
        <div className="flex items-center gap-3">
          <Button
            color="primary"
            size="sm"
            onClick={handleRunBacktest}
            isDisabled={running}
          >
            {running ? 'Evaluating...' : 'Run Backtest'}
          </Button>
          <Select
            aria-label="Filter ticker"
            placeholder="All Tickers"
            items={tickers.map(t => ({ key: t, label: t }))}
            selectedKeys={filterTicker ? new Set([filterTicker]) : new Set([])}
            onSelectionChange={keys => { const v = Array.from(keys)[0] as string; setFilterTicker(v ?? ''); }}
            variant="bordered"
            size="sm"
            classNames={{ base: 'max-w-40' }}
          >
            {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
          </Select>
          <span className="text-xs" style={{ color: '#71717a' }}>
            {total} evaluations
          </span>
        </div>

        {/* Summary Cards */}
        {summary && summary.total > 0 && (
          <div className="grid grid-cols-4 gap-3">
            <SummaryCard
              label="Win Rate"
              value={summary.win_rate != null ? `${summary.win_rate}%` : 'N/A'}
              color="#17c964"
            />
            <SummaryCard
              label="Direction Accuracy"
              value={summary.direction_accuracy != null ? `${summary.direction_accuracy}%` : 'N/A'}
              color="#006FEE"
            />
            <SummaryCard
              label="Avg Return"
              value={summary.avg_return != null ? `${summary.avg_return > 0 ? '+' : ''}${summary.avg_return}%` : 'N/A'}
              color={summary.avg_return != null && summary.avg_return >= 0 ? '#17c964' : '#f31260'}
            />
            <SummaryCard
              label="W / L / N"
              value={`${summary.wins} / ${summary.losses} / ${summary.neutrals}`}
              color="#a1a1aa"
            />
          </div>
        )}

        {/* Per-Decision Breakdown */}
        {summary && summary.by_decision && Object.keys(summary.by_decision).length > 0 && (
          <div
            className="rounded-xl p-4"
            style={{ background: '#18181b', border: '1px solid #27272a' }}
          >
            <h3 className="text-sm font-medium mb-3" style={{ color: '#ECEDEE' }}>
              Performance by Decision
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {(['BUY', 'HOLD', 'SELL'] as const).map((d) => {
                const data = summary.by_decision[d];
                if (!data) return null;
                return (
                  <div
                    key={d}
                    className="rounded-lg p-3"
                    style={{ background: '#27272a' }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-bold" style={{ color: DECISION_COLORS[d] }}>
                        {d}
                      </span>
                      <span className="text-xs" style={{ color: '#71717a' }}>
                        ({data.count} reports)
                      </span>
                    </div>
                    <div className="text-xs space-y-1" style={{ color: '#a1a1aa' }}>
                      <div>Win Rate: {data.win_rate != null ? `${data.win_rate}%` : 'N/A'}</div>
                      <div>
                        Avg Return:{' '}
                        <span style={{ color: data.avg_return >= 0 ? '#17c964' : '#f31260' }}>
                          {data.avg_return >= 0 ? '+' : ''}{data.avg_return}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: '#18181b', border: '1px solid #27272a' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#27272a' }}>
                  {['Ticker', 'Date', 'Decision', 'Direction', 'Outcome', 'Return', 'Days', 'TP Hit', 'SL Hit'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs font-medium"
                      style={{ color: '#71717a' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t"
                    style={{ borderColor: '#27272a' }}
                  >
                    <td className="px-3 py-2 font-mono text-xs" style={{ color: '#ECEDEE' }}>
                      {r.ticker}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: '#a1a1aa' }}>
                      {r.analysis_date}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-bold" style={{ color: DECISION_COLORS[r.decision] }}>
                        {r.decision}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.direction_correct
                        ? <span style={{ color: '#17c964' }}>Correct</span>
                        : <span style={{ color: '#f31260' }}>Wrong</span>
                      }
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="text-xs px-2 py-0.5 rounded font-medium"
                        style={{
                          background: `${OUTCOME_COLORS[r.outcome]}20`,
                          color: OUTCOME_COLORS[r.outcome],
                        }}
                      >
                        {r.outcome}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono" style={{
                      color: r.return_pct >= 0 ? '#17c964' : '#f31260'
                    }}>
                      {r.return_pct >= 0 ? '+' : ''}{r.return_pct}%
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: '#a1a1aa' }}>
                      {r.days_held}d
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: r.target_hit ? '#17c964' : '#3f3f46' }}>
                      {r.target_hit ? 'Yes' : '-'}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: r.stop_hit ? '#f31260' : '#3f3f46' }}>
                      {r.stop_hit ? 'Yes' : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state */}
        {!loading && results.length === 0 && (
          <div className="flex items-center justify-center h-48" style={{ color: '#a1a1aa' }}>
            No backtest results yet. Run analysis on tickers first, then click "Run Backtest" after 10+ days.
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-24" style={{ color: '#a1a1aa' }}>
            Loading...
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: '#18181b', border: '1px solid #27272a' }}
    >
      <div className="text-xs mb-1" style={{ color: '#71717a' }}>{label}</div>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
    </div>
  );
}
