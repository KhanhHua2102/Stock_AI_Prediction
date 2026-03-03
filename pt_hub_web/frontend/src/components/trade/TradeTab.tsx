import { LiveLogs } from './LiveLogs';

export function TradeTab() {
  return (
    <div className="flex h-full">
      {/* Full width - Live Logs (runner/thinker output) */}
      <div className="w-full flex flex-col">
        <LiveLogs />
      </div>
    </div>
  );
}
