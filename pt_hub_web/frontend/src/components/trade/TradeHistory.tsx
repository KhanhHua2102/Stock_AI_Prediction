import { useEffect } from 'react';
import { useTradeStore } from '../../store/tradeStore';
import { accountApi } from '../../services/api';
import { format } from 'date-fns';

export function TradeHistory() {
  const { tradeHistory, setTradeHistory } = useTradeStore();

  // Load trade history on mount
  useEffect(() => {
    accountApi.getTrades(250).then((data) => {
      setTradeHistory(data.trades);
    }).catch(() => {});
  }, [setTradeHistory]);

  const formatTime = (ts: number) => {
    return format(new Date(ts * 1000), 'MM/dd HH:mm:ss');
  };

  const formatMoney = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}$${Math.abs(value).toFixed(2)}`;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 bg-dark-bg2 border-b border-dark-border">
        <h3 className="text-sm font-semibold text-dark-fg">Trade History</h3>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {tradeHistory.length === 0 ? (
          <div className="p-4 text-sm text-dark-muted text-center">
            No trades yet
          </div>
        ) : (
          <div className="space-y-1">
            {[...tradeHistory].reverse().map((trade, i) => (
              <TradeRow key={i} trade={trade} formatTime={formatTime} formatMoney={formatMoney} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TradeRow({
  trade,
  formatTime,
  formatMoney,
}: {
  trade: {
    ts: number;
    symbol: string;
    side: string;
    tag?: string;
    qty: number;
    price: number;
    realized_profit_aud?: number;
    pnl_pct?: number;
  };
  formatTime: (ts: number) => string;
  formatMoney: (v: number) => string;
}) {
  const isBuy = trade.side.toLowerCase() === 'buy';
  const isDCA = trade.tag === 'DCA';

  return (
    <div className="flex items-center text-xs py-1 px-2 rounded hover:bg-dark-panel2">
      <span className="text-dark-muted w-28 flex-shrink-0">
        {formatTime(trade.ts)}
      </span>
      <span
        className={`w-16 flex-shrink-0 font-medium ${
          isBuy
            ? isDCA
              ? 'text-purple-400'
              : 'text-red-400'
            : 'text-dark-accent'
        }`}
      >
        {isDCA ? 'DCA' : trade.side.toUpperCase()}
      </span>
      <span className="w-20 flex-shrink-0 text-dark-fg">
        {trade.symbol.replace('-AUD', '')}
      </span>
      <span className="w-24 flex-shrink-0 text-dark-muted">
        qty={trade.qty.toFixed(6)}
      </span>
      <span className="w-24 flex-shrink-0 text-dark-muted">
        @{trade.price.toFixed(2)}
      </span>
      {trade.realized_profit_aud !== undefined && (
        <span
          className={`flex-shrink-0 ${
            trade.realized_profit_aud >= 0 ? 'text-dark-accent' : 'text-red-500'
          }`}
        >
          {formatMoney(trade.realized_profit_aud)}
        </span>
      )}
    </div>
  );
}
