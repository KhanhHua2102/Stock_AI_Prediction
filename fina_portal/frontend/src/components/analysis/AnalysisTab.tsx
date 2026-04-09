import { useState, useEffect, useRef } from 'react';
import { Select, SelectItem } from '@heroui/select';
import { Button } from '@heroui/button';
import { useSettingsStore, selectTickers } from '../../store/settingsStore';
import { useAnalysisStore } from '../../store/analysisStore';
import { analysisApi, marketApi } from '../../services/api';
import { AnalysisReportCard } from './AnalysisReportCard';
import { AnalysisLogStream } from './AnalysisLogStream';
import { AnalysisProgressBar } from './AnalysisProgressBar';
import { PortfolioAnalysisView } from './PortfolioAnalysisView';
import { AccuracyView } from './AccuracyView';
import { MultiAgentView } from './MultiAgentView';
import { DraggableTickerBar } from '../common/DraggableTickerBar';
import type { AnalysisReport, AnalysisStrategy, MarketReview } from '../../services/types';

type AnalysisViewMode = 'single' | 'portfolio' | 'accuracy' | 'multi-agent';

export function AnalysisTab() {
  const tickers = useSettingsStore(selectTickers);
  const {
    isRunning,
    runningTicker,
    analysisLogs,
    latestReports,
    setRunning,
    clearAnalysisLogs,
    setLatestReport,
    setReportHistory,
    reportHistory,
    reportHistoryTotal,
  } = useAnalysisStore();

  const [viewMode, setViewMode] = useState<AnalysisViewMode>('single');
  const [selectedTicker, setSelectedTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [strategies, setStrategies] = useState<AnalysisStrategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState('default');
  const [marketReview, setMarketReview] = useState<MarketReview | null>(null);
  const [showMarket, setShowMarket] = useState(false);
  const analysisStartTime = useRef<number>(0);

  // Load strategies + market review on mount
  useEffect(() => {
    analysisApi.getStrategies().then((r) => setStrategies(r.strategies)).catch(() => {});
    marketApi.getReview().then((r) => setMarketReview(r.review)).catch(() => {});
  }, []);

  // Select first ticker on load
  useEffect(() => {
    if (tickers.length > 0 && !selectedTicker) {
      setSelectedTicker(tickers[0]);
    }
  }, [tickers, selectedTicker]);

  // Load latest report when ticker changes
  useEffect(() => {
    if (!selectedTicker) return;
    let cancelled = false;

    const fetchLatest = async () => {
      try {
        const result = await analysisApi.getLatest(selectedTicker);
        if (!cancelled && result.report) {
          setLatestReport(selectedTicker, result.report);
        }
      } catch {
        // Ignore — no report yet
      }
    };

    fetchLatest();
    return () => { cancelled = true; };
  }, [selectedTicker, setLatestReport]);

  const handleRunAnalysis = async () => {
    if (isRunning || !selectedTicker) return;

    setError('');
    clearAnalysisLogs();
    setRunning(true, selectedTicker);
    setShowLogs(false);
    analysisStartTime.current = Date.now();

    try {
      await analysisApi.run(selectedTicker, selectedStrategy);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start analysis');
      setRunning(false, null);
    }
  };

  const handleLoadHistory = async () => {
    if (!selectedTicker) return;
    setLoading(true);
    try {
      const result = await analysisApi.getReports(selectedTicker, 20, 0);
      setReportHistory(result.reports, result.total);
      setShowHistory(true);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  const report = latestReports[selectedTicker];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* View mode toggle */}
      <div
        className="flex items-center gap-2 p-2 shrink-0"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}
      >
        <div className="flex rounded-xl p-1" style={{ background: '#27272a' }}>
          <Button
            variant={viewMode === 'single' ? 'solid' : 'light'}
            color={viewMode === 'single' ? 'primary' : 'default'}
            radius="full"
            size="sm"
            onClick={() => setViewMode('single')}
          >
            Single Ticker
          </Button>
          <Button
            variant={viewMode === 'portfolio' ? 'solid' : 'light'}
            color={viewMode === 'portfolio' ? 'primary' : 'default'}
            radius="full"
            size="sm"
            onClick={() => setViewMode('portfolio')}
          >
            My Portfolio
          </Button>
          <Button
            variant={viewMode === 'accuracy' ? 'solid' : 'light'}
            color={viewMode === 'accuracy' ? 'primary' : 'default'}
            radius="full"
            size="sm"
            onClick={() => setViewMode('accuracy')}
          >
            Accuracy
          </Button>
          <Button
            variant={viewMode === 'multi-agent' ? 'solid' : 'light'}
            color={viewMode === 'multi-agent' ? 'secondary' : 'default'}
            radius="full"
            size="sm"
            onClick={() => setViewMode('multi-agent')}
          >
            Multi-Agent
          </Button>
        </div>
      </div>

      {viewMode === 'multi-agent' ? (
        <MultiAgentView />
      ) : viewMode === 'portfolio' ? (
        <PortfolioAnalysisView />
      ) : viewMode === 'accuracy' ? (
        <AccuracyView />
      ) : (
      <>
      <DraggableTickerBar
        selectedTicker={selectedTicker}
        onSelect={(t) => { setSelectedTicker(t); setShowHistory(false); }}
      />

      {/* Main content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-4 max-w-4xl mx-auto">
          {/* Controls */}
          <div className="flex items-center gap-4">
            <Button
              color="primary"
              size="sm"
              onClick={handleRunAnalysis}
              isDisabled={isRunning}
            >
              {isRunning && runningTicker === selectedTicker
                ? 'Analyzing...'
                : isRunning
                ? `Busy (${runningTicker})`
                : 'Run Analysis'}
            </Button>

            {strategies.length > 1 && (
              <Select
                aria-label="Strategy"
                selectedKeys={new Set([selectedStrategy])}
                onSelectionChange={keys => { const v = Array.from(keys)[0] as string; if (v) setSelectedStrategy(v); }}
                isDisabled={isRunning}
                variant="bordered"
                size="sm"
                classNames={{ base: 'max-w-56' }}
                title={strategies.find((s) => s.key === selectedStrategy)?.description}
              >
                {strategies.map((s) => (
                  <SelectItem key={s.key}>{s.name}</SelectItem>
                ))}
              </Select>
            )}

            {analysisLogs.length > 0 && (
              <Button
                variant="flat"
                size="sm"
                onClick={() => setShowLogs(!showLogs)}
              >
                {showLogs ? 'Hide Logs' : 'Show Logs'}
              </Button>
            )}

            {report && (
              <Button
                variant="flat"
                size="sm"
                onClick={handleLoadHistory}
              >
                {showHistory ? 'Hide History' : 'View History'}
              </Button>
            )}

            {error && <span className="text-sm" style={{ color: '#f31260' }}>{error}</span>}
          </div>

          {/* Market Overview (collapsible) */}
          {marketReview && (
            <div className="rounded-xl" style={{ background: '#18181b', border: '1px solid #27272a' }}>
              <button
                onClick={() => setShowMarket(!showMarket)}
                className="w-full flex items-center justify-between p-4 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium" style={{ color: '#ECEDEE' }}>Market Overview</span>
                  <div className="flex items-center gap-2">
                    {Object.values(marketReview.indices).map((idx) => (
                      <span
                        key={idx.name}
                        className="text-xs px-2 py-0.5 rounded"
                        style={{
                          background: idx.change_pct >= 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                          color: idx.change_pct >= 0 ? '#17c964' : '#f31260',
                        }}
                      >
                        {idx.name} {idx.change_pct >= 0 ? '+' : ''}{idx.change_pct}%
                      </span>
                    ))}
                    {marketReview.fear_greed && (
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ background: '#27272a', color: '#a1a1aa' }}
                      >
                        F&G: {marketReview.fear_greed.score}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs" style={{ color: '#71717a' }}>{showMarket ? 'Hide' : 'Show'}</span>
              </button>
              {showMarket && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: '#a1a1aa' }}>
                    {marketReview.summary}
                  </p>
                  {marketReview.sectors.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {marketReview.sectors.slice(0, 5).map((s) => (
                        <span
                          key={s.etf}
                          className="text-xs px-2 py-0.5 rounded"
                          style={{
                            background: s.change_pct >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                            color: s.change_pct >= 0 ? '#17c964' : '#f31260',
                          }}
                        >
                          {s.name} {s.change_pct >= 0 ? '+' : ''}{s.change_pct}%
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: '#52525b' }}>{marketReview.date}</span>
                    <button
                      onClick={async () => {
                        try {
                          const r = await marketApi.forceGenerate();
                          setMarketReview(r.review);
                        } catch { /* ignore */ }
                      }}
                      className="text-xs underline"
                      style={{ color: '#52525b' }}
                    >
                      Refresh
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Progress bar during analysis */}
          {isRunning && runningTicker === selectedTicker && (
            <AnalysisProgressBar
              ticker={selectedTicker}
              logs={analysisLogs}
              startTime={analysisStartTime.current}
            />
          )}

          {/* Streaming logs */}
          {showLogs && analysisLogs.length > 0 && (
            <AnalysisLogStream logs={analysisLogs} />
          )}

          {/* Latest Report */}
          {!showHistory && report && (
            <>
              <h2
                className="text-lg font-medium"
                style={{ color: '#ECEDEE' }}
              >
                {selectedTicker} — Latest Analysis
              </h2>
              <AnalysisReportCard report={report} />
            </>
          )}

          {/* No report state */}
          {!showHistory && !report && !isRunning && (
            <div
              className="flex items-center justify-center h-48"
              style={{ color: '#a1a1aa' }}
            >
              No analysis yet for {selectedTicker}. Click "Run Analysis" to start.
            </div>
          )}

          {/* History */}
          {showHistory && (
            <div className="space-y-4">
              <h2
                className="text-lg font-medium"
                style={{ color: '#ECEDEE' }}
              >
                {selectedTicker} — History ({reportHistoryTotal} reports)
              </h2>
              {reportHistory.map((r) => (
                <HistoryRow key={r.id} report={r} />
              ))}
              {loading && (
                <div className="text-sm" style={{ color: '#a1a1aa' }}>
                  Loading...
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function HistoryRow({ report }: { report: AnalysisReport }) {
  const [expanded, setExpanded] = useState(false);
  const decisionColor = {
    BUY: '#17c964',
    HOLD: '#f5a524',
    SELL: '#f31260',
  }[report.decision] ?? '#a1a1aa';

  return (
    <div
      className="rounded-xl"
      style={{ background: '#18181b', border: '1px solid #27272a' }}
    >
      <Button
        variant="light"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left rounded-xl h-auto"
      >
        <div className="flex items-center gap-4">
          <span className="font-bold" style={{ color: decisionColor }}>{report.decision}</span>
          <span className="text-sm font-mono" style={{ color: '#ECEDEE' }}>
            Score: {report.score}
          </span>
          <span className="text-xs" style={{ color: '#a1a1aa' }}>
            {report.conclusion.slice(0, 80)}...
          </span>
        </div>
        <span className="text-xs font-mono" style={{ color: '#a1a1aa' }}>
          {new Date(report.created_at).toLocaleString()}
        </span>
      </Button>
      {expanded && (
        <div className="px-4 pb-4">
          <AnalysisReportCard report={report} />
        </div>
      )}
    </div>
  );
}
