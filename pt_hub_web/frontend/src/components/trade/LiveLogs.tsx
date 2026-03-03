import { useState, useMemo } from 'react';
import { useTradeStore, parseRunnerStatus } from '../../store/tradeStore';
import { LogViewer } from '../common/LogViewer';
import { RunnerStatusPanel } from './RunnerStatusPanel';

export function LiveLogs() {
  const [showRawLog, setShowRawLog] = useState(false);
  const { runnerLogs, clearLogs } = useTradeStore();

  const runnerStatus = useMemo(() => {
    return parseRunnerStatus(runnerLogs);
  }, [runnerLogs]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between bg-dark-bg2 border-b border-dark-border">
        <span className="px-4 py-2 text-xs font-medium text-dark-accent">
          Runner Logs
        </span>
        <div className="flex items-center gap-2 mr-2">
          <button
            onClick={() => setShowRawLog(!showRawLog)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              showRawLog
                ? 'bg-dark-accent/20 text-dark-accent'
                : 'text-dark-muted hover:text-dark-fg hover:bg-dark-panel2'
            }`}
          >
            {showRawLog ? 'Status View' : 'Raw Log'}
          </button>
          <button
            onClick={() => clearLogs('runner')}
            className="px-3 py-1 text-xs text-dark-muted hover:text-dark-fg"
          >
            Clear
          </button>
        </div>
      </div>

      {showRawLog ? (
        <LogViewer logs={runnerLogs} className="flex-1" />
      ) : (
        <RunnerStatusPanel status={runnerStatus} />
      )}
    </div>
  );
}
