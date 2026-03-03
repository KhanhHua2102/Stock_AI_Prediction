import type { RunnerStatus } from '../../services/types';

interface RunnerStatusPanelProps {
  status: RunnerStatus | null;
}

const timeframeOrder = ['1hour', '2hour', '4hour', '8hour', '12hour', '1day', '1week'];

function formatTimeframe(tf: string): string {
  const map: Record<string, string> = {
    '1hour': '1H', '2hour': '2H', '4hour': '4H', '8hour': '8H',
    '12hour': '12H', '1day': '1D', '1week': '1W',
  };
  return map[tf] || tf;
}

function formatPrice(price: number): string {
  if (price >= 1000000000) return 'No Limit';
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getDirectionColor(direction: string): string {
  switch (direction) {
    case 'WITHIN': return 'text-green-400';
    case 'ABOVE': return 'text-red-400';
    case 'BELOW': return 'text-blue-400';
    default: return 'text-dark-muted';
  }
}

function getDirectionBgColor(direction: string): string {
  switch (direction) {
    case 'WITHIN': return 'bg-green-500/10';
    case 'ABOVE': return 'bg-red-500/10';
    case 'BELOW': return 'bg-blue-500/10';
    default: return 'bg-dark-panel2';
  }
}

function getDirectionIcon(direction: string): string {
  switch (direction) {
    case 'WITHIN': return '●';
    case 'ABOVE': return '▲';
    case 'BELOW': return '▼';
    default: return '•';
  }
}

export function RunnerStatusPanel({ status }: RunnerStatusPanelProps) {
  if (!status || status.signals.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-dark-muted text-sm">
        <div className="text-center">
          <div className="text-2xl mb-2">⏳</div>
          <div>Waiting for runner data...</div>
          <div className="text-xs mt-1">Start the neural runner to see status</div>
        </div>
      </div>
    );
  }

  const sortedSignals = [...status.signals].sort((a, b) => {
    const aIdx = timeframeOrder.indexOf(a.timeframe);
    const bIdx = timeframeOrder.indexOf(b.timeframe);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  const withinCount = status.signals.filter(s => s.direction === 'WITHIN').length;
  const aboveCount = status.signals.filter(s => s.direction === 'ABOVE').length;
  const belowCount = status.signals.filter(s => s.direction === 'BELOW').length;

  return (
    <div className="p-3 h-full overflow-auto">
      <div className="flex items-center justify-between mb-4 p-3 rounded-lg bg-dark-panel2 border border-dark-border">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-dark-accent">{status.ticker}</span>
          <span className="text-xs text-dark-muted">Current Price</span>
        </div>
        <div className="text-2xl font-mono font-bold text-dark-fg">
          ${formatPrice(status.currentPrice)}
        </div>
      </div>

      <div className="flex items-center gap-4 mb-3 pb-2 border-b border-dark-border">
        <div className="text-xs font-medium text-dark-fg">Timeframe Signals</div>
        <div className="flex gap-3 text-xs ml-auto">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-400"></span>
            <span className="text-dark-muted">Within:</span>
            <span className="text-green-400 font-medium">{withinCount}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-400"></span>
            <span className="text-dark-muted">Above:</span>
            <span className="text-red-400 font-medium">{aboveCount}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-400"></span>
            <span className="text-dark-muted">Below:</span>
            <span className="text-blue-400 font-medium">{belowCount}</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {sortedSignals.map((signal, idx) => (
          <div key={idx} className={`rounded-lg p-2 ${getDirectionBgColor(signal.direction)} border border-dark-border text-center`}>
            <div className="text-xs font-medium text-dark-muted mb-1">{formatTimeframe(signal.timeframe)}</div>
            <div className={`text-lg ${getDirectionColor(signal.direction)}`}>{getDirectionIcon(signal.direction)}</div>
            <div className={`text-xs font-medium ${getDirectionColor(signal.direction)}`}>{signal.direction}</div>
            {signal.lowBoundary < 1000000000 && <div className="text-xs text-dark-muted mt-1">${formatPrice(signal.lowBoundary)}</div>}
            {signal.highBoundary < 1000000000 && <div className="text-xs text-dark-muted">${formatPrice(signal.highBoundary)}</div>}
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-1">
        {sortedSignals.map((signal, idx) => (
          <div key={idx} className={`flex items-center justify-between rounded px-3 py-2 ${getDirectionBgColor(signal.direction)} border border-dark-border/50`}>
            <div className="flex items-center gap-3">
              <span className={`${getDirectionColor(signal.direction)}`}>{getDirectionIcon(signal.direction)}</span>
              <span className="text-sm font-medium text-dark-fg w-10">{formatTimeframe(signal.timeframe)}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${getDirectionColor(signal.direction)}`}>{signal.direction}</span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-dark-muted">Low:</span>
                <span className="text-dark-fg font-mono">${formatPrice(signal.lowBoundary)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-dark-muted">High:</span>
                <span className="text-dark-fg font-mono">${formatPrice(signal.highBoundary)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
