import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useTradeStore } from '../../store/tradeStore';
import { tradingApi } from '../../services/api';

export function TradeControls() {
  const { settings } = useSettingsStore();
  const { selectedTickers, setSelectedTickers, processStatus } = useTradeStore();
  const [loading, setLoading] = useState(false);

  const tickers = settings?.tickers ?? [];
  const isRunning = processStatus?.neural.running;

  // Load selected tickers on mount
  useEffect(() => {
    tradingApi.getTickers().then((data) => {
      setSelectedTickers(data.tickers);
    }).catch(() => {});
  }, [setSelectedTickers]);

  const handleTickerToggle = async (ticker: string) => {
    if (isRunning) return;

    const newSelection = selectedTickers.includes(ticker)
      ? selectedTickers.filter((t) => t !== ticker)
      : [...selectedTickers, ticker];

    setLoading(true);
    try {
      await tradingApi.setTickers(newSelection);
      setSelectedTickers(newSelection);
    } catch (err) {
      console.error('Failed to update tickers:', err);
    }
    setLoading(false);
  };

  const handleSelectAll = async () => {
    if (isRunning) return;
    setLoading(true);
    try {
      await tradingApi.setTickers(tickers);
      setSelectedTickers(tickers);
    } catch (err) {
      console.error('Failed to select all:', err);
    }
    setLoading(false);
  };

  const handleSelectNone = async () => {
    if (isRunning) return;
    setLoading(true);
    try {
      await tradingApi.setTickers([]);
      setSelectedTickers([]);
    } catch (err) {
      console.error('Failed to clear selection:', err);
    }
    setLoading(false);
  };

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-dark-fg mb-3">Ticker Selection</h3>

      {/* Ticker Selection */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-dark-muted">Select Tickers</span>
          <div className="flex gap-2">
            <button
              onClick={handleSelectAll}
              disabled={isRunning || loading}
              className="text-xs text-dark-accent hover:underline disabled:opacity-50 disabled:no-underline"
            >
              All
            </button>
            <button
              onClick={handleSelectNone}
              disabled={isRunning || loading}
              className="text-xs text-dark-muted hover:text-dark-fg disabled:opacity-50"
            >
              None
            </button>
          </div>
        </div>

        <div className="space-y-1">
          {tickers.map((ticker) => (
            <label
              key={ticker}
              className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                isRunning ? 'opacity-50 cursor-not-allowed' : 'hover:bg-dark-panel2'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedTickers.includes(ticker)}
                onChange={() => handleTickerToggle(ticker)}
                disabled={isRunning || loading}
                className="w-4 h-4 rounded border-dark-border bg-dark-panel text-dark-accent focus:ring-dark-accent focus:ring-offset-0"
              />
              <span className="text-sm text-dark-fg">{ticker}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Status message */}
      {isRunning && (
        <div className="text-xs text-yellow-500">
          Cannot change tickers while runner is active
        </div>
      )}

      {selectedTickers.length === 0 && !isRunning && (
        <div className="text-xs text-dark-muted">
          Select at least one ticker to start predictions
        </div>
      )}
    </div>
  );
}
