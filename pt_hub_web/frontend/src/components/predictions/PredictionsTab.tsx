import { useState, useEffect, useMemo } from 'react';
import { useSettingsStore, selectTickers, selectTimeframes } from '../../store/settingsStore';
import { predictionsApi } from '../../services/api';
import { DraggableTickerBar } from '../common/DraggableTickerBar';

interface PredictionData {
  signals: Record<string, {
    long: number;
    short: number;
    high_bound: number;
    low_bound: number;
  }>;
  current_price: number;
}

function signalLabel(long: number, short: number): { text: string; color: string } {
  const net = long - short;
  if (net >= 5) return { text: 'Strong Buy', color: 'text-green-400' };
  if (net >= 2) return { text: 'Buy', color: 'text-green-300' };
  if (net <= -5) return { text: 'Strong Sell', color: 'text-red-400' };
  if (net <= -2) return { text: 'Sell', color: 'text-red-300' };
  return { text: 'Neutral', color: 'text-dark-muted' };
}

export function PredictionsTab() {
  const tickers = useSettingsStore(selectTickers);
  const timeframes = useSettingsStore(selectTimeframes);
  const [selectedTicker, setSelectedTicker] = useState('');
  const [data, setData] = useState<PredictionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (tickers.length > 0 && !selectedTicker) {
      setSelectedTicker(tickers[0]);
    }
  }, [tickers, selectedTicker]);

  useEffect(() => {
    if (!selectedTicker) return;

    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        const result = await predictionsApi.get(selectedTicker);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load predictions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedTicker]);

  const overallSignal = useMemo(() => {
    if (!data?.signals) return null;
    let totalLong = 0, totalShort = 0, count = 0;
    for (const tf of Object.values(data.signals)) {
      totalLong += tf.long;
      totalShort += tf.short;
      count++;
    }
    if (count === 0) return null;
    return signalLabel(totalLong / count, totalShort / count);
  }, [data]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DraggableTickerBar selectedTicker={selectedTicker} onSelect={setSelectedTicker} />

      {/* Main content */}
      <div className="flex-1 overflow-auto p-4">
        {loading && !data && (
          <div className="flex items-center justify-center h-full text-dark-muted">Loading predictions...</div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full text-red-400">{error}</div>
        )}

        {data && (
          <div className="space-y-6 max-w-4xl mx-auto">
            {/* Overall Signal */}
            <div className="bg-dark-panel rounded-lg border border-dark-border p-6">
              <h2 className="text-lg font-medium text-dark-fg mb-4">{selectedTicker} — Overall Signal</h2>
              <div className="flex items-center gap-6">
                <div className={`text-3xl font-bold ${overallSignal?.color ?? 'text-dark-muted'}`}>
                  {overallSignal?.text ?? 'No Data'}
                </div>
                {data.current_price > 0 && (
                  <div className="text-dark-muted text-sm">
                    Current Price: <span className="text-dark-fg font-medium">{data.current_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Per-timeframe signals */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {timeframes.map((tf) => {
                const sig = data.signals[tf];
                if (!sig) return (
                  <div key={tf} className="bg-dark-panel rounded-lg border border-dark-border p-4">
                    <h3 className="text-sm font-medium text-dark-muted mb-3">{tf.toUpperCase()}</h3>
                    <div className="text-dark-muted text-sm">No data yet — run training first</div>
                  </div>
                );

                const label = signalLabel(sig.long, sig.short);

                return (
                  <div key={tf} className="bg-dark-panel rounded-lg border border-dark-border p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-medium text-dark-muted">{tf.toUpperCase()}</h3>
                      <span className={`text-sm font-bold ${label.color}`}>{label.text}</span>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-green-400">Buy Signal</span>
                          <span className="text-dark-muted">{sig.long}/7</span>
                        </div>
                        <div className="h-3 bg-dark-bg2 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full transition-all duration-500"
                            style={{ width: `${(sig.long / 7) * 100}%` }}
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-red-400">Sell Signal</span>
                          <span className="text-dark-muted">{sig.short}/7</span>
                        </div>
                        <div className="h-3 bg-dark-bg2 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-500 rounded-full transition-all duration-500"
                            style={{ width: `${(sig.short / 7) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {(sig.high_bound > 0 || sig.low_bound > 0) && (
                      <div className="border-t border-dark-border pt-3">
                        <div className="text-xs text-dark-muted mb-2">Predicted Range</div>
                        <div className="flex items-center justify-between text-sm">
                          <div>
                            <span className="text-dark-muted">Low: </span>
                            <span className="text-blue-400 font-medium">
                              {sig.low_bound.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div>
                            <span className="text-dark-muted">High: </span>
                            <span className="text-orange-400 font-medium">
                              {sig.high_bound.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                        {data.current_price > 0 && sig.high_bound > 0 && sig.low_bound > 0 && (
                          <div className="mt-2 text-xs text-dark-muted">
                            Expected move: <span className="text-dark-fg">
                              {((sig.low_bound / data.current_price - 1) * 100).toFixed(2)}% to {((sig.high_bound / data.current_price - 1) * 100).toFixed(2)}%
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
