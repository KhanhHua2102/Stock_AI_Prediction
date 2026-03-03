import { useEffect, useRef, useState, useMemo } from 'react';
import { useTrainingStore } from '../../store/trainingStore';
import { useTradeStore } from '../../store/tradeStore';
import { trainingApi } from '../../services/api';
import { LogViewer } from '../common/LogViewer';

interface TickerProgress {
  ticker: string;
  phase: 'downloading' | 'training' | 'finished';
  timeframe: string;
  downloadPct: number;
  downloadCurrent: number;
  downloadTotal: number;
  downloadStartTime: number;
  currentCandle: number;
  totalCandles: number;
  accuracy: number | null;
  trainingStartTime: number;
}

function newTickerProgress(ticker: string): TickerProgress {
  return {
    ticker,
    phase: 'downloading',
    timeframe: '',
    downloadPct: 0,
    downloadCurrent: 0,
    downloadTotal: 0,
    downloadStartTime: Date.now(),
    currentCandle: 0,
    totalCandles: 0,
    accuracy: null,
    trainingStartTime: 0,
  };
}

function parseProgress(logs: string[]): Map<string, TickerProgress> {
  const progress = new Map<string, TickerProgress>();
  let activeTicker: string | null = null;

  for (const log of logs) {
    // Starting training — reset progress for this ticker
    const startMatch = log.match(/\[TRAINER\] Starting training for (.+)/);
    if (startMatch) {
      const ticker = startMatch[1];
      progress.set(ticker, newTickerProgress(ticker));
      activeTicker = ticker;
      continue;
    }

    // Downloading phase — captures timeframe
    const dlMatch = log.match(/\[TRAINER\] Downloading (.+) data for (.+)\.\.\./);
    if (dlMatch) {
      const [, timeframe, ticker] = dlMatch;
      const existing = progress.get(ticker);
      if (existing) {
        existing.phase = 'downloading';
        existing.timeframe = timeframe;
        existing.downloadStartTime = Date.now();
        existing.downloadPct = 0;
        existing.downloadCurrent = 0;
        existing.downloadTotal = 0;
      }
      activeTicker = ticker;
      continue;
    }

    // Download progress: [TRAINER] Download progress: 12.50% (12500/100000)
    const progMatch = log.match(/\[TRAINER\] Download progress: ([\d.]+)% \((\d+)\/(\d+)\)/);
    if (progMatch) {
      const p = activeTicker ? progress.get(activeTicker) : null;
      if (p) {
        p.downloadPct = parseFloat(progMatch[1]);
        p.downloadCurrent = parseInt(progMatch[2]);
        p.downloadTotal = parseInt(progMatch[3]);
      }
      continue;
    }

    // Legacy: "gathering history" (before backend update)
    if (log.includes('gathering history')) {
      continue;
    }

    // Total candles (sets the denominator)
    const totalMatch = log.match(/Total Candles:\s*(\d+)/);
    if (totalMatch) {
      const p = activeTicker ? progress.get(activeTicker) : null;
      if (p) {
        p.totalCandles = parseInt(totalMatch[1]);
        p.phase = 'training';
        p.trainingStartTime = Date.now();
      }
      continue;
    }

    // Current candle (progress tick)
    const currentMatch = log.match(/current candle:\s*(\d+)/);
    if (currentMatch) {
      const p = activeTicker ? progress.get(activeTicker) : null;
      if (p) {
        p.currentCandle = parseInt(currentMatch[1]);
        p.phase = 'training';
      }
      continue;
    }

    // Bounce accuracy
    const accMatch = log.match(/Bounce Accuracy.*?:\s*([\d.]+)/);
    if (accMatch) {
      const p = activeTicker ? progress.get(activeTicker) : null;
      if (p) p.accuracy = parseFloat(accMatch[1]);
      continue;
    }

    // Finished processing
    if (log.includes('finished processing') || log.match(/Processed all|Finished processing all/)) {
      const p = activeTicker ? progress.get(activeTicker) : null;
      if (p) p.phase = 'finished';
      continue;
    }
  }

  return progress;
}

function formatEta(startTime: number, current: number, total: number): string {
  if (current <= 0 || total <= 0 || startTime <= 0) return '--';
  const elapsed = (Date.now() - startTime) / 1000;
  if (elapsed < 2) return '--'; // not enough data yet
  const rate = current / elapsed;
  const remaining = (total - current) / rate;
  if (remaining < 0) return '--';
  if (remaining < 60) return `~${Math.round(remaining)}s`;
  if (remaining < 3600) return `~${Math.round(remaining / 60)}m`;
  return `~${(remaining / 3600).toFixed(1)}h`;
}

function ProgressBar({ progress }: { progress: TickerProgress }) {
  const {
    ticker, phase, timeframe,
    downloadPct, downloadCurrent, downloadTotal, downloadStartTime,
    currentCandle, totalCandles, accuracy, trainingStartTime,
  } = progress;

  const isDownloading = phase === 'downloading';
  const isTraining = phase === 'training';

  // Compute percentage
  let pct: number;
  if (phase === 'finished') {
    pct = 100;
  } else if (isDownloading) {
    pct = Math.min(99, Math.round(downloadPct));
  } else if (isTraining && totalCandles > 0) {
    pct = Math.min(99, Math.round((currentCandle / totalCandles) * 100));
  } else {
    pct = 0;
  }

  // Phase label
  let phaseLabel: string;
  if (isDownloading) {
    const tf = timeframe || '1hour';
    if (downloadTotal > 0) {
      phaseLabel = `Downloading ${tf} data — ${downloadCurrent.toLocaleString()} / ${downloadTotal.toLocaleString()} records`;
    } else {
      phaseLabel = `Downloading ${tf} data...`;
    }
  } else if (isTraining) {
    phaseLabel = `Training — ${currentCandle.toLocaleString()} / ${totalCandles.toLocaleString()} candles`;
  } else {
    phaseLabel = 'Complete';
  }

  // ETA
  let eta = '--';
  if (isDownloading && downloadCurrent > 0 && downloadTotal > 0) {
    eta = formatEta(downloadStartTime, downloadCurrent, downloadTotal);
  } else if (isTraining && currentCandle > 0 && totalCandles > 0) {
    eta = formatEta(trainingStartTime, currentCandle, totalCandles);
  }

  const hasProgress = pct > 0 || phase === 'finished';
  const isIndeterminate = isDownloading && downloadPct <= 0;

  return (
    <div className="px-4 py-3 border-b border-dark-border last:border-b-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-dark-fg">{ticker}</span>
        <div className="flex items-center gap-3 text-xs text-dark-muted">
          {accuracy !== null && (
            <span>Accuracy: {accuracy}%</span>
          )}
          {(isDownloading || isTraining) && eta !== '--' && (
            <span>ETA: {eta}</span>
          )}
          <span className={phase === 'finished' ? 'text-dark-accent' : ''}>
            {hasProgress ? `${pct}%` : ''}
          </span>
        </div>
      </div>
      <div className="w-full h-2 bg-dark-panel2 rounded-full overflow-hidden">
        {isIndeterminate ? (
          <div className="h-full w-1/3 bg-yellow-500/70 rounded-full animate-indeterminate" />
        ) : (
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              phase === 'finished'
                ? 'bg-dark-accent'
                : isDownloading
                  ? 'bg-yellow-500'
                  : 'bg-blue-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <div className="mt-1 text-xs text-dark-muted">{phaseLabel}</div>
    </div>
  );
}

export function TrainerOutput() {
  const { trainerLogs, clearTrainerLogs, addTrainerLog } = useTrainingStore();
  const { processStatus } = useTradeStore();
  const pollRef = useRef<number>();
  const lastCountRef = useRef(0);
  const [showRaw, setShowRaw] = useState(false);

  const runningTicker = Object.entries(processStatus?.trainers ?? {}).find(
    ([, info]) => info.running
  )?.[0];

  useEffect(() => {
    if (!runningTicker) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    const fetchLogs = async () => {
      try {
        const data = await trainingApi.getLogs(runningTicker, 200);
        if (data.logs.length > lastCountRef.current) {
          const newLogs = data.logs.slice(lastCountRef.current);
          newLogs.forEach((log: string) => addTrainerLog(log));
          lastCountRef.current = data.logs.length;
        }
      } catch {
        // ignore
      }
    };

    lastCountRef.current = 0;
    fetchLogs();
    pollRef.current = window.setInterval(fetchLogs, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [runningTicker, addTrainerLog]);

  const tickerProgress = useMemo(() => parseProgress(trainerLogs), [trainerLogs]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 bg-dark-bg2 border-b border-dark-border">
        <h3 className="text-sm font-semibold text-dark-fg">
          Trainer Output{runningTicker ? ` — ${runningTicker}` : ''}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRaw((v) => !v)}
            className={`px-3 py-1 text-xs rounded ${
              showRaw
                ? 'bg-dark-select text-dark-fg'
                : 'text-dark-muted hover:text-dark-fg'
            }`}
          >
            Raw Output
          </button>
          <button
            onClick={clearTrainerLogs}
            className="px-3 py-1 text-xs text-dark-muted hover:text-dark-fg"
          >
            Clear
          </button>
        </div>
      </div>

      {showRaw ? (
        <LogViewer logs={trainerLogs} className="flex-1" />
      ) : (
        <div className="flex-1 overflow-auto bg-dark-panel">
          {tickerProgress.size === 0 ? (
            <div className="p-4 text-xs text-dark-muted">No training in progress...</div>
          ) : (
            Array.from(tickerProgress.values()).map((p) => (
              <ProgressBar key={p.ticker} progress={p} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
