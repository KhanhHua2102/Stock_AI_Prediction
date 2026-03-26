import { useEffect, useState, useMemo } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useTrainingStore } from '../../store/trainingStore';
import { useTradeStore } from '../../store/tradeStore';
import { trainingApi } from '../../services/api';

export function TrainingControls() {
  const { settings } = useSettingsStore();
  const { trainingStatus, setTrainingStatus, setRunningTrainers } = useTrainingStore();
  const { processStatus, setProcessStatus } = useTradeStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tickers = settings?.tickers ?? [];
  const trainers = processStatus?.trainers;

  const runningTrainers = useMemo(() => {
    return Object.keys(trainers ?? {}).filter(
      (ticker) => trainers?.[ticker]?.running
    );
  }, [trainers]);

  useEffect(() => {
    trainingApi.getStatus().then((data) => {
      setTrainingStatus(data.status);
    }).catch(() => {});
  }, [setTrainingStatus]);

  useEffect(() => {
    setRunningTrainers(runningTrainers);
  }, [runningTrainers, setRunningTrainers]);

  const handleTrain = async (ticker: string) => {
    setLoading(ticker);
    setError(null);
    try {
      const response = await trainingApi.start(ticker);
      if (response.process_status) {
        setProcessStatus(response.process_status);
      }
      setLoading(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start training');
      setLoading(null);
    }
  };

  const handleStop = async (ticker: string) => {
    setLoading(ticker);
    setError(null);
    try {
      const response = await trainingApi.stop(ticker);
      if (response.process_status) {
        setProcessStatus(response.process_status);
      }
      setLoading(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop training');
      setLoading(null);
    }
  };

  const allRunning = tickers.length > 0 && tickers.every((t) => runningTrainers.includes(t));
  const anyRunning = runningTrainers.length > 0;

  const handleStopAll = async () => {
    setLoading('stop-all');
    setError(null);
    try {
      for (const ticker of runningTrainers) {
        const response = await trainingApi.stop(ticker);
        if (response.process_status) {
          setProcessStatus(response.process_status);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop training');
    }
    setLoading(null);
  };

  const handleTrainAll = async () => {
    setLoading('train-all');
    setError(null);
    try {
      for (const ticker of tickers) {
        if (!runningTrainers.includes(ticker)) {
          const response = await trainingApi.start(ticker);
          if (response.process_status) {
            setProcessStatus(response.process_status);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start training');
    }
    setLoading(null);
  };

  const handleClear = async () => {
    setLoading('clear');
    setError(null);
    try {
      await trainingApi.clear();
      const data = await trainingApi.getStatus();
      setTrainingStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear training');
    }
    setLoading(null);
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-dark-fg">Training Controls</h3>
        <div className="flex items-center gap-2">
          {anyRunning && (
            <button
              onClick={handleStopAll}
              disabled={loading === 'stop-all'}
              className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
            >
              {loading === 'stop-all' ? 'Stopping...' : 'Stop All'}
            </button>
          )}
          <button
            onClick={handleTrainAll}
            disabled={loading === 'train-all' || allRunning}
            className="px-3 py-1 text-xs bg-dark-accent hover:bg-opacity-80 text-dark-bg rounded disabled:opacity-50"
          >
            {loading === 'train-all' ? 'Starting...' : 'Train All'}
          </button>
        </div>
      </div>

      <div className="space-y-3 mb-4">
        {tickers.map((ticker) => {
          const status = trainingStatus[ticker] ?? 'NOT_TRAINED';
          const isRunning = runningTrainers.includes(ticker);
          const isLoading = loading === ticker;

          return (
            <div
              key={ticker}
              className="flex items-center justify-between p-3 bg-dark-panel rounded"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-dark-fg">{ticker}</span>
                <StatusBadge status={isRunning ? 'TRAINING' : status} />
              </div>

              <div className="flex gap-2">
                {isRunning ? (
                  <button
                    onClick={() => handleStop(ticker)}
                    disabled={isLoading}
                    className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                  >
                    {isLoading ? 'Stopping...' : 'Stop'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleTrain(ticker)}
                    disabled={isLoading}
                    className="px-3 py-1 text-xs bg-dark-accent hover:bg-opacity-80 text-dark-bg rounded disabled:opacity-50"
                  >
                    {isLoading ? 'Starting...' : 'Train'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleClear}
        disabled={loading === 'clear'}
        className="w-full py-2 px-4 text-sm bg-dark-panel2 hover:bg-dark-select text-dark-fg border border-dark-border rounded disabled:opacity-50"
      >
        {loading === 'clear' ? 'Clearing...' : 'Clear All Training'}
      </button>

      {error && <div className="mt-3 text-xs text-red-500">{error}</div>}

      <div className="mt-4 text-xs text-dark-muted">
        Flow: Train tickers → Start All (in Trade tab)
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    TRAINED: { bg: 'bg-dark-accent/20', text: 'text-dark-accent', label: 'Trained' },
    TRAINING: { bg: 'bg-yellow-500/20', text: 'text-yellow-500', label: 'Training' },
    NOT_TRAINED: { bg: 'bg-dark-panel2', text: 'text-dark-muted', label: 'Not Trained' },
  }[status] ?? { bg: 'bg-dark-panel2', text: 'text-dark-muted', label: status };

  return (
    <span className={`px-2 py-0.5 text-xs rounded ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}
