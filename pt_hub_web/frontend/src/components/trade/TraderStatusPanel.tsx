import type { TraderLogStatus } from '../../services/types';

interface TraderStatusPanelProps {
  status: TraderLogStatus;
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(percent: number): string {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

function getPercentColor(percent: number): string {
  if (percent > 0) return 'text-green-400';
  if (percent < 0) return 'text-red-400';
  return 'text-dark-muted';
}

export function TraderStatusPanel({ status }: TraderStatusPanelProps) {
  const { account, trades } = status;

  if (!account && trades.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-dark-muted text-sm">
        <div className="text-center">
          <div className="text-2xl mb-2">&#x23F3;</div>
          <div>Waiting for trader data...</div>
          <div className="text-xs mt-1">Start the trader to see status</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 h-full overflow-auto">
      {/* Account Summary */}
      {account && (
        <div className="mb-4">
          <div className="text-xs font-medium text-dark-fg mb-2 pb-1 border-b border-dark-border">
            Account Summary
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-dark-panel2 rounded-lg p-3 border border-dark-border">
              <div className="text-xs text-dark-muted mb-1">Total Value</div>
              <div className="text-lg font-bold text-dark-fg font-mono">
                ${formatPrice(account.totalValue)}
              </div>
            </div>
            <div className="bg-dark-panel2 rounded-lg p-3 border border-dark-border">
              <div className="text-xs text-dark-muted mb-1">Holdings</div>
              <div className="text-lg font-bold text-dark-fg font-mono">
                ${formatPrice(account.holdingsValue)}
              </div>
            </div>
            <div className="bg-dark-panel2 rounded-lg p-3 border border-dark-border">
              <div className="text-xs text-dark-muted mb-1">In Trade</div>
              <div className="text-lg font-bold text-dark-accent font-mono">
                {account.percentInTrade.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Trailing PM Settings */}
          <div className="mt-2 flex items-center gap-4 text-xs text-dark-muted bg-dark-panel2/50 rounded px-3 py-2">
            <span>Trailing PM:</span>
            <span>
              Start: <span className="text-dark-fg">+{account.trailingPmNoDca}%</span> (no DCA) /
              <span className="text-dark-fg"> +{account.trailingPmWithDca}%</span> (with DCA)
            </span>
            <span>
              Gap: <span className="text-dark-fg">{account.trailingGap}%</span>
            </span>
          </div>
        </div>
      )}

      {/* Current Trades */}
      {trades.length > 0 && (
        <div>
          <div className="text-xs font-medium text-dark-fg mb-2 pb-1 border-b border-dark-border">
            Current Trades ({trades.length})
          </div>
          <div className="space-y-2">
            {trades.map((trade) => (
              <div
                key={trade.symbol}
                className="bg-dark-panel2 rounded-lg p-3 border border-dark-border"
              >
                {/* Header row */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-dark-accent">{trade.symbol}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-dark-accent/20 text-dark-accent">
                      DCA: {trade.dcaLevelsTriggered}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-dark-fg font-mono">
                      ${formatPrice(trade.tradeValue)}
                    </div>
                    <div className="text-xs text-dark-muted">Trade Value</div>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {/* DCA Info */}
                  <div className="bg-dark-bg2/50 rounded p-2">
                    <div className="text-dark-muted mb-1">DCA Status</div>
                    <div className="flex items-center gap-2">
                      <span className={getPercentColor(trade.dcaPercent)}>
                        {formatPercent(trade.dcaPercent)}
                      </span>
                      <span className="text-dark-muted">@</span>
                      <span className="text-dark-fg font-mono">${formatPrice(trade.dcaPrice)}</span>
                    </div>
                    <div className="text-dark-muted mt-1">
                      Line: <span className="text-dark-fg">{trade.dcaLine}</span>
                    </div>
                    <div className="text-dark-muted">
                      Next: <span className="text-dark-fg">{trade.nextDca}</span>
                    </div>
                  </div>

                  {/* Gain/Loss Info */}
                  <div className="bg-dark-bg2/50 rounded p-2">
                    <div className="text-dark-muted mb-1">Gain/Loss (Sell)</div>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-bold ${getPercentColor(trade.gainLossSellPercent)}`}>
                        {formatPercent(trade.gainLossSellPercent)}
                      </span>
                    </div>
                    <div className="text-dark-muted mt-1">
                      @ <span className="text-dark-fg font-mono">${formatPrice(trade.gainLossSellPrice)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
