import { useEffect } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useTrainingStore } from '../../store/trainingStore';
import { trainingApi } from '../../services/api';
import { NeuralTile } from './NeuralTile';

export function NeuralSignals() {
  const { settings, setChartTicker, setActiveTab } = useSettingsStore();
  const { neuralSignals, setAllNeuralSignals } = useTrainingStore();

  const tickers = settings?.tickers ?? [];

  useEffect(() => {
    const fetchSignals = () => {
      trainingApi.getNeuralSignals().then((data) => {
        setAllNeuralSignals(data.signals);
      }).catch(() => {});
    };

    fetchSignals();
    const interval = setInterval(fetchSignals, 5000);
    return () => clearInterval(interval);
  }, [setAllNeuralSignals]);

  const handleTileClick = (ticker: string) => {
    setChartTicker(ticker);
    setActiveTab('charts');
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-dark-fg">Neural Signals</h3>
        <div className="flex gap-4 text-xs text-dark-muted">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-blue-500 rounded-sm" />
            Long
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-orange-500 rounded-sm" />
            Short
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {tickers.map((ticker) => {
          const signal = neuralSignals[ticker] ?? { long_signal: 0, short_signal: 0 };
          return (
            <NeuralTile
              key={ticker}
              ticker={ticker}
              longSignal={signal.long_signal}
              shortSignal={signal.short_signal}
              onClick={() => handleTileClick(ticker)}
            />
          );
        })}
      </div>

      {tickers.length === 0 && (
        <div className="text-sm text-dark-muted text-center py-8">
          No tickers configured
        </div>
      )}
    </div>
  );
}
