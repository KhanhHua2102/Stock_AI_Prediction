import { useState, useMemo } from 'react';
import { useTrainingStore } from '../../store/trainingStore';
import { useTradeStore } from '../../store/tradeStore';
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

function ensureTicker(progress: Map<string, TickerProgress>, ticker: string): TickerProgress {
  let p = progress.get(ticker);
  if (!p) {
    p = newTickerProgress(ticker);
    progress.set(ticker, p);
  }
  return p;
}

function parseProgress(logs: string[]): Map<string, TickerProgress> {
  const progress = new Map<string, TickerProgress>();

  for (const log of logs) {
    // Extract ticker prefix added by store: [GLOB.AX] message content
    const prefixMatch = log.match(/^\[([^\]]+)\]\s*(.*)/s);
    const ticker = prefixMatch ? prefixMatch[1] : null;
    const content = prefixMatch ? prefixMatch[2] : log;

    // [TRAINER] Starting training for X
    const startMatch = content.match(/\[TRAINER\] Starting training for (.+)/);
    if (startMatch) {
      const t = ticker || startMatch[1];
      const p = ensureTicker(progress, t);
      p.phase = 'downloading';
      p.downloadStartTime = Date.now();
      continue;
    }

    // [TRAINER] Downloading {timeframe} data for {ticker}...
    const dlMatch = content.match(/\[TRAINER\] Downloading (.+) data for (.+)\.\.\./);
    if (dlMatch) {
      const t = ticker || dlMatch[2];
      const p = ensureTicker(progress, t);
      p.phase = 'downloading';
      p.timeframe = dlMatch[1];
      p.downloadStartTime = Date.now();
      p.downloadPct = 0;
      p.downloadCurrent = 0;
      p.downloadTotal = 0;
      continue;
    }

    // [TRAINER] Download progress: 12.50% (12500/100000)
    const progMatch = content.match(/\[TRAINER\] Download progress: ([\d.]+)% \((\d+)\/(\d+)\)/);
    if (progMatch && ticker) {
      const p = ensureTicker(progress, ticker);
      p.downloadPct = parseFloat(progMatch[1]);
      p.downloadCurrent = parseInt(progMatch[2]);
      p.downloadTotal = parseInt(progMatch[3]);
      continue;
    }

    // [TRAINER] No more data available
    if (content.match(/\[TRAINER\] No more data available/) && ticker) {
      const p = ensureTicker(progress, ticker);
      p.downloadPct = 100;
      continue;
    }

    // Total Candles: N
    const totalMatch = content.match(/Total Candles:\s*(\d+)/);
    if (totalMatch && ticker) {
      const p = ensureTicker(progress, ticker);
      p.totalCandles = parseInt(totalMatch[1]);
      p.phase = 'training';
      if (!p.trainingStartTime) p.trainingStartTime = Date.now();
      continue;
    }

    // current candle: N
    const currentMatch = content.match(/current candle:\s*(\d+)/);
    if (currentMatch && ticker) {
      const p = ensureTicker(progress, ticker);
      p.currentCandle = parseInt(currentMatch[1]);
      p.phase = 'training';
      if (!p.trainingStartTime) p.trainingStartTime = Date.now();
      continue;
    }

    // Bounce Accuracy
    const accMatch = content.match(/Bounce Accuracy.*?:\s*([\d.]+)/);
    if (accMatch && ticker) {
      const p = ensureTicker(progress, ticker);
      p.accuracy = parseFloat(accMatch[1]);
      continue;
    }

    // Finished processing
    if (content.match(/finished processing|Processed all|Finished processing all/) && ticker) {
      const p = ensureTicker(progress, ticker);
      p.phase = 'finished';
      continue;
    }
  }

  return progress;
}

function formatEta(startTime: number, current: number, total: number): string {
  if (current <= 0 || total <= 0 || startTime <= 0) return '--';
  const elapsed = (Date.now() - startTime) / 1000;
  if (elapsed < 2) return '--';
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
  const { trainerLogs, clearTrainerLogs } = useTrainingStore();
  const { processStatus } = useTradeStore();
  const [showRaw, setShowRaw] = useState(false);

  const runningCount = useMemo(() => {
    return Object.values(processStatus?.trainers ?? {}).filter((info) => info.running).length;
  }, [processStatus]);

  const tickerProgress = useMemo(() => {
    const progress = parseProgress(trainerLogs);
    // Ensure all running trainers have a progress entry even if their
    // initial log was pushed out of the 500-line buffer
    const trainers = processStatus?.trainers ?? {};
    for (const [ticker, info] of Object.entries(trainers)) {
      if (info.running && !progress.has(ticker)) {
        progress.set(ticker, newTickerProgress(ticker));
      }
    }
    return progress;
  }, [trainerLogs, processStatus]);

  const headerLabel = runningCount > 0 ? ` — ${runningCount} training` : '';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 bg-dark-bg2 border-b border-dark-border">
        <h3 className="text-sm font-semibold text-dark-fg">
          Trainer Output{headerLabel}
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
