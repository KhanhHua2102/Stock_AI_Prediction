import { useTradeStore } from '../../store/tradeStore';

export function CurrentTrades() {
  const { positions } = useTradeStore();

  const positionEntries = Object.entries(positions).filter(
    ([_, pos]) => pos.quantity > 0
  );

  const formatMoney = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    const pct = value * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(2)}%`;
  };

  const formatPrice = (value: number) => {
    return value.toLocaleString('en-AU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 bg-dark-bg2 border-b border-dark-border">
        <h3 className="text-sm font-semibold text-dark-fg">Current Trades</h3>
      </div>

      <div className="flex-1 overflow-auto">
        {positionEntries.length === 0 ? (
          <div className="p-4 text-sm text-dark-muted text-center">
            No open positions
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Qty</th>
                <th>Value</th>
                <th>Avg Cost</th>
                <th>Ask</th>
                <th>DCA PnL</th>
                <th>Bid</th>
                <th>Sell PnL</th>
                <th>DCA Stage</th>
                <th>Trail</th>
              </tr>
            </thead>
            <tbody>
              {positionEntries.map(([coin, pos]) => (
                <tr key={coin}>
                  <td className="font-medium text-dark-accent">{coin}</td>
                  <td>{pos.quantity.toFixed(6)}</td>
                  <td>{formatMoney(pos.value_aud)}</td>
                  <td>{formatPrice(pos.avg_cost_basis)}</td>
                  <td>{formatPrice(pos.current_buy_price)}</td>
                  <td
                    className={
                      pos.gain_loss_pct_buy >= 0 ? 'text-dark-accent' : 'text-red-500'
                    }
                  >
                    {formatPercent(pos.gain_loss_pct_buy)}
                  </td>
                  <td>{formatPrice(pos.current_sell_price)}</td>
                  <td
                    className={
                      pos.gain_loss_pct_sell >= 0 ? 'text-dark-accent' : 'text-red-500'
                    }
                  >
                    {formatPercent(pos.gain_loss_pct_sell)}
                  </td>
                  <td>{pos.dca_triggered_stages}</td>
                  <td>
                    {pos.trail_active ? (
                      <span className="text-dark-accent">
                        {formatPrice(pos.trail_line)}
                      </span>
                    ) : (
                      <span className="text-dark-muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
