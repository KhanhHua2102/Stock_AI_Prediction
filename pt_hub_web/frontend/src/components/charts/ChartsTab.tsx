import { useSettingsStore } from '../../store/settingsStore';
import { ChartTabBar } from './ChartTabBar';
import { CandlestickChart } from './CandlestickChart';

export function ChartsTab() {
  const { chartCoin } = useSettingsStore();

  return (
    <div className="flex flex-col h-full">
      {/* Chart Tab Bar */}
      <ChartTabBar />

      {/* Chart Content */}
      <div className="flex-1 overflow-hidden">
        {chartCoin && <CandlestickChart coin={chartCoin} />}
      </div>
    </div>
  );
}
