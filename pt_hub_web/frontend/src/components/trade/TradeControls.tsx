import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useTradeStore } from '../../store/tradeStore';
import { tradingApi } from '../../services/api';

export function TradeControls() {
  const { settings } = useSettingsStore();
  const { selectedCoins, setSelectedCoins, processStatus } = useTradeStore();
  const [loading, setLoading] = useState(false);

  const coins = settings?.coins ?? [];
  const isRunning = processStatus?.neural.running || processStatus?.trader.running;

  // Load selected coins on mount
  useEffect(() => {
    tradingApi.getCoins().then((data) => {
      setSelectedCoins(data.coins);
    }).catch(() => {});
  }, [setSelectedCoins]);

  const handleCoinToggle = async (coin: string) => {
    if (isRunning) return; // Can't change while running

    const newSelection = selectedCoins.includes(coin)
      ? selectedCoins.filter((c) => c !== coin)
      : [...selectedCoins, coin];

    setLoading(true);
    try {
      await tradingApi.setCoins(newSelection);
      setSelectedCoins(newSelection);
    } catch (err) {
      console.error('Failed to update coins:', err);
    }
    setLoading(false);
  };

  const handleSelectAll = async () => {
    if (isRunning) return;
    setLoading(true);
    try {
      await tradingApi.setCoins(coins);
      setSelectedCoins(coins);
    } catch (err) {
      console.error('Failed to select all:', err);
    }
    setLoading(false);
  };

  const handleSelectNone = async () => {
    if (isRunning) return;
    setLoading(true);
    try {
      await tradingApi.setCoins([]);
      setSelectedCoins([]);
    } catch (err) {
      console.error('Failed to clear selection:', err);
    }
    setLoading(false);
  };

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-dark-fg mb-3">Trade Controls</h3>

      {/* Coin Selection */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-dark-muted">Select Coins</span>
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
          {coins.map((coin) => (
            <label
              key={coin}
              className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                isRunning ? 'opacity-50 cursor-not-allowed' : 'hover:bg-dark-panel2'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedCoins.includes(coin)}
                onChange={() => handleCoinToggle(coin)}
                disabled={isRunning || loading}
                className="w-4 h-4 rounded border-dark-border bg-dark-panel text-dark-accent focus:ring-dark-accent focus:ring-offset-0"
              />
              <span className="text-sm text-dark-fg">{coin}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Status message */}
      {isRunning && (
        <div className="text-xs text-yellow-500">
          Cannot change coins while trading is active
        </div>
      )}

      {selectedCoins.length === 0 && !isRunning && (
        <div className="text-xs text-dark-muted">
          Select at least one coin to start trading
        </div>
      )}
    </div>
  );
}
