import { LiveLogs } from './LiveLogs';
import { AccountPanel } from './AccountPanel';
import { CurrentTrades } from './CurrentTrades';
import { TradeHistory } from './TradeHistory';

export function TradeTab() {
  return (
    <div className="flex h-full">
      {/* Left side - Live Logs (40%) */}
      <div className="w-2/5 border-r border-dark-border flex flex-col">
        <LiveLogs />
      </div>

      {/* Right side - Dashboard (60%) */}
      <div className="w-3/5 flex flex-col overflow-hidden">
        {/* Top section - Account Panel */}
        <div className="border-b border-dark-border overflow-auto" style={{ height: '25%' }}>
          <AccountPanel />
        </div>

        {/* Middle section - Current Trades */}
        <div className="border-b border-dark-border overflow-auto" style={{ height: '40%' }}>
          <CurrentTrades />
        </div>

        {/* Bottom section - Trade History */}
        <div className="overflow-auto" style={{ height: '35%' }}>
          <TradeHistory />
        </div>
      </div>
    </div>
  );
}
