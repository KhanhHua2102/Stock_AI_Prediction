import { useState } from 'react';
import { useTradeStore } from '../../store/tradeStore';
import { tradingApi } from '../../services/api';

interface HeaderProps {
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
}

export function Header({ connectionStatus }: HeaderProps) {
  const { processStatus } = useTradeStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const neuralRunning = processStatus?.neural.running ?? false;
  const traderRunning = processStatus?.trader.running ?? false;
  const runnerReady = processStatus?.runner_ready;

  const handleStartAll = async () => {
    setLoading(true);
    setError(null);
    try {
      await tradingApi.startAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    }
    setLoading(false);
  };

  const handleStopAll = async () => {
    setLoading(true);
    setError(null);
    try {
      await tradingApi.stopAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop');
    }
    setLoading(false);
  };

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-dark-bg2 border-b border-dark-border">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-dark-fg">PowerTrader Hub</h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Process Status Indicators */}
        <div className="flex items-center gap-3">
          <StatusBadge label="Neural" running={neuralRunning} />
          <StatusBadge label="Trader" running={traderRunning} />
          {runnerReady && !runnerReady.ready && neuralRunning && (
            <span className="text-xs text-yellow-500">
              {runnerReady.stage} ({runnerReady.ready_coins.length}/{runnerReady.total_coins})
            </span>
          )}
        </div>

        {/* Start/Stop Button */}
        <div className="flex items-center gap-2">
          {neuralRunning || traderRunning ? (
            <button
              onClick={handleStopAll}
              disabled={loading}
              className="py-1.5 px-4 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded disabled:opacity-50"
            >
              {loading ? 'Stopping...' : 'Stop All'}
            </button>
          ) : (
            <button
              onClick={handleStartAll}
              disabled={loading}
              className="py-1.5 px-4 bg-dark-accent hover:bg-opacity-80 text-dark-bg text-xs font-medium rounded disabled:opacity-50"
            >
              {loading ? 'Starting...' : 'Start All'}
            </button>
          )}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>

        <ConnectionIndicator status={connectionStatus} />
      </div>
    </header>
  );
}

function StatusBadge({ label, running }: { label: string; running: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-dark-muted">{label}:</span>
      <span
        className={`px-2 py-0.5 rounded ${
          running
            ? 'bg-dark-accent/20 text-dark-accent'
            : 'bg-dark-panel2 text-dark-muted'
        }`}
      >
        {running ? 'Running' : 'Stopped'}
      </span>
    </div>
  );
}

function ConnectionIndicator({ status }: { status: string }) {
  const statusConfig = {
    connected: { color: 'bg-dark-accent', text: 'Connected' },
    connecting: { color: 'bg-yellow-500 animate-pulse', text: 'Connecting...' },
    disconnected: { color: 'bg-red-500', text: 'Disconnected' },
  }[status] ?? { color: 'bg-dark-muted', text: 'Unknown' };

  return (
    <div className="flex items-center gap-2 text-xs text-dark-muted">
      <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
      <span>{statusConfig.text}</span>
    </div>
  );
}
