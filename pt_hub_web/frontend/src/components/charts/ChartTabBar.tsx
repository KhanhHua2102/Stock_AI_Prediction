import { useSettingsStore, selectTimeframes } from '../../store/settingsStore';
import { DraggableTickerBar } from '../common/DraggableTickerBar';

export function ChartTabBar() {
  const { chartTicker, chartTimeframe, setChartTicker, setChartTimeframe } =
    useSettingsStore();

  const timeframes = useSettingsStore(selectTimeframes);

  return (
    <DraggableTickerBar selectedTicker={chartTicker} onSelect={setChartTicker}>
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
    </DraggableTickerBar>
  );
}
