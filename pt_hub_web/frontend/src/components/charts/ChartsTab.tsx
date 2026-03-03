import { useSettingsStore } from '../../store/settingsStore';
import { ChartTabBar } from './ChartTabBar';
import { CandlestickChart } from './CandlestickChart';

export function ChartsTab() {
  const { chartTicker } = useSettingsStore();

  return (
    <div className="flex flex-col h-full">
      <ChartTabBar />
      <div className="flex-1 overflow-hidden">
        {chartTicker && <CandlestickChart ticker={chartTicker} />}
      </div>
    </div>
  );
}
