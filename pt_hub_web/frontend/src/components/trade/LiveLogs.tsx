import { useState, useMemo } from 'react';
import { useTradeStore, parseTraderLogStatus, parseRunnerStatus } from '../../store/tradeStore';
import { LogViewer } from '../common/LogViewer';
import { TraderStatusPanel } from './TraderStatusPanel';
import { RunnerStatusPanel } from './RunnerStatusPanel';

export function LiveLogs() {
  const [activeTab, setActiveTab] = useState<'runner' | 'trader'>('runner');
  const [showRawLog, setShowRawLog] = useState(false);
  const { runnerLogs, traderLogs, clearLogs } = useTradeStore();

  const logs = activeTab === 'runner' ? runnerLogs : traderLogs;

  // Parse trader status from logs
  const traderStatus = useMemo(() => {
    return parseTraderLogStatus(traderLogs);
  }, [traderLogs]);

  // Parse runner status from logs
  const runnerStatus = useMemo(() => {
    return parseRunnerStatus(runnerLogs);
  }, [runnerLogs]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center justify-between bg-dark-bg2 border-b border-dark-border">
        <div className="flex">
          <button
            onClick={() => setActiveTab('runner')}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === 'runner'
                ? 'text-dark-accent bg-dark-panel'
                : 'text-dark-muted hover:text-dark-fg'
            }`}
          >
            Runner
          </button>
          <button
            onClick={() => setActiveTab('trader')}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === 'trader'
                ? 'text-dark-accent bg-dark-panel'
                : 'text-dark-muted hover:text-dark-fg'
            }`}
          >
            Trader
          </button>
        </div>
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
            onClick={() => clearLogs(activeTab)}
            className="px-3 py-1 text-xs text-dark-muted hover:text-dark-fg"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Content */}
      {showRawLog ? (
        <LogViewer logs={logs} className="flex-1" />
      ) : activeTab === 'runner' ? (
        <RunnerStatusPanel status={runnerStatus} />
      ) : (
        <TraderStatusPanel status={traderStatus} />
      )}
    </div>
  );
}
