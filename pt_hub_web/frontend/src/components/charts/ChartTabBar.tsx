import { useSettingsStore } from '../../store/settingsStore';

export function ChartTabBar() {
  const { settings, chartTicker, chartTimeframe, setChartTicker, setChartTimeframe } =
    useSettingsStore();

  const tickers = settings?.tickers ?? [];
  const timeframes = settings?.timeframes ?? [];

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-dark-bg2 border-b border-dark-border">
      {/* Ticker Tabs */}
      <div className="flex gap-1 flex-wrap">
        {tickers.map((ticker) => (
          <button
            key={ticker}
            onClick={() => setChartTicker(ticker)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              chartTicker === ticker
                ? 'bg-dark-accent text-dark-bg'
                : 'bg-dark-panel text-dark-muted hover:text-dark-fg hover:bg-dark-panel2'
            }`}
          >
            {ticker}
          </button>
        ))}
      </div>

      {/* Timeframe Selector */}
      <select
        value={chartTimeframe}
        onChange={(e) => setChartTimeframe(e.target.value)}
        className="px-3 py-1.5 text-xs bg-dark-panel border border-dark-border rounded text-dark-fg focus:outline-none focus:border-dark-accent"
      >
        {timeframes.map((tf) => (
          <option key={tf} value={tf}>
            {tf}
          </option>
        ))}
      </select>
    </div>
  );
}
