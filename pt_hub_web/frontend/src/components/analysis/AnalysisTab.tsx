import { useState, useEffect, useRef } from 'react';
import { useSettingsStore, selectTickers } from '../../store/settingsStore';
import { useAnalysisStore } from '../../store/analysisStore';
import { analysisApi } from '../../services/api';
import { AnalysisReportCard } from './AnalysisReportCard';
import { AnalysisLogStream } from './AnalysisLogStream';
import { AnalysisProgressBar } from './AnalysisProgressBar';
import { PortfolioAnalysisView } from './PortfolioAnalysisView';
import { DraggableTickerBar } from '../common/DraggableTickerBar';
import type { AnalysisReport } from '../../services/types';

type AnalysisViewMode = 'single' | 'portfolio';

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
  const analysisStartTime = useRef<number>(0);

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
      await analysisApi.run(selectedTicker);
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
      <div className="flex items-center border-b border-dark-border bg-dark-bg2 shrink-0">
        <button
          onClick={() => setViewMode('single')}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            viewMode === 'single'
              ? 'text-dark-accent border-b-2 border-dark-accent bg-dark-panel/50'
              : 'text-dark-muted hover:text-dark-fg hover:bg-dark-panel/30'
          }`}
        >
          Single Ticker
        </button>
        <button
          onClick={() => setViewMode('portfolio')}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            viewMode === 'portfolio'
              ? 'text-dark-accent border-b-2 border-dark-accent bg-dark-panel/50'
              : 'text-dark-muted hover:text-dark-fg hover:bg-dark-panel/30'
          }`}
        >
          My Portfolio
        </button>
      </div>

      {viewMode === 'portfolio' ? (
        <PortfolioAnalysisView />
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
            <button
              onClick={handleRunAnalysis}
              disabled={isRunning}
              className={`px-6 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                isRunning
                  ? 'bg-dark-panel text-dark-muted cursor-not-allowed'
                  : 'bg-dark-accent text-white hover:bg-dark-accent/80'
              }`}
            >
              {isRunning && runningTicker === selectedTicker
                ? 'Analyzing...'
                : isRunning
                ? `Busy (${runningTicker})`
                : 'Run Analysis'}
            </button>

            {analysisLogs.length > 0 && (
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="px-4 py-2.5 rounded-lg text-sm font-medium bg-dark-panel text-dark-muted hover:text-dark-fg hover:bg-dark-panel2 transition-colors"
              >
                {showLogs ? 'Hide Logs' : 'Show Logs'}
              </button>
            )}

            {report && (
              <button
                onClick={handleLoadHistory}
                className="px-4 py-2.5 rounded-lg text-sm font-medium bg-dark-panel text-dark-muted hover:text-dark-fg hover:bg-dark-panel2 transition-colors"
              >
                {showHistory ? 'Hide History' : 'View History'}
              </button>
            )}

            {error && <span className="text-red-400 text-sm">{error}</span>}
          </div>

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
              <h2 className="text-lg font-medium text-dark-fg">
                {selectedTicker} — Latest Analysis
              </h2>
              <AnalysisReportCard report={report} />
            </>
          )}

          {/* No report state */}
          {!showHistory && !report && !isRunning && (
            <div className="flex items-center justify-center h-48 text-dark-muted">
              No analysis yet for {selectedTicker}. Click "Run Analysis" to start.
            </div>
          )}

          {/* History */}
          {showHistory && (
            <div className="space-y-4">
              <h2 className="text-lg font-medium text-dark-fg">
                {selectedTicker} — History ({reportHistoryTotal} reports)
              </h2>
              {reportHistory.map((r) => (
                <HistoryRow key={r.id} report={r} />
              ))}
              {loading && <div className="text-dark-muted text-sm">Loading...</div>}
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
  const style = {
    BUY: 'text-green-400',
    HOLD: 'text-yellow-400',
    SELL: 'text-red-400',
  }[report.decision] ?? 'text-dark-muted';

  return (
    <div className="bg-dark-panel rounded-lg border border-dark-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-dark-panel2 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-4">
          <span className={`font-bold ${style}`}>{report.decision}</span>
          <span className="text-dark-fg text-sm">Score: {report.score}</span>
          <span className="text-dark-muted text-xs">{report.conclusion.slice(0, 80)}...</span>
        </div>
        <span className="text-dark-muted text-xs">
          {new Date(report.created_at).toLocaleString()}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <AnalysisReportCard report={report} />
        </div>
      )}
    </div>
  );
}
