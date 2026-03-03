import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { useSettingsStore } from '../../store/settingsStore';
import { chartsApi } from '../../services/api';
import type { Candle, ChartOverlays } from '../../services/types';

interface CandlestickChartProps {
  ticker: string;
}

export function CandlestickChart({ ticker }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const { chartTimeframe, settings } = useSettingsStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    chartRef.current = createChart(containerRef.current, {
      layout: {
        background: { color: '#070B10' },
        textColor: '#C7D1DB',
      },
      grid: {
        vertLines: { color: '#243044' },
        horzLines: { color: '#243044' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#243044',
      },
      rightPriceScale: {
        borderColor: '#243044',
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#8B949E', width: 1, style: 2 },
        horzLine: { color: '#8B949E', width: 1, style: 2 },
      },
    });

    candleSeriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#00FF66',
      downColor: '#FF4444',
      borderUpColor: '#00FF66',
      borderDownColor: '#FF4444',
      wickUpColor: '#00FF66',
      wickDownColor: '#FF4444',
    });

    const handleResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chartRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [candleData, overlayData] = await Promise.all([
          chartsApi.getCandles(ticker, chartTimeframe, settings?.candles_limit ?? 120),
          chartsApi.getOverlays(ticker),
        ]);

        if (candleSeriesRef.current) {
          const formattedCandles: CandlestickData<Time>[] = candleData.candles.map((c: Candle) => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }));
          candleSeriesRef.current.setData(formattedCandles);
          addOverlays(overlayData);
          chartRef.current?.timeScale().fitContent();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chart data');
      }

      setLoading(false);
    };

    fetchData();

    const interval = setInterval(fetchData, (settings?.chart_refresh_seconds ?? 10) * 1000);
    return () => clearInterval(interval);
  }, [ticker, chartTimeframe, settings]);

  const addOverlays = (overlays: ChartOverlays) => {
    if (!candleSeriesRef.current) return;

    overlays.neural_levels.long.forEach((price) => {
      if (price > 0) {
        candleSeriesRef.current?.createPriceLine({
          price, color: '#3B82F6', lineWidth: 1, lineStyle: 0, axisLabelVisible: false,
        });
      }
    });

    overlays.neural_levels.short.forEach((price) => {
      if (price > 0) {
        candleSeriesRef.current?.createPriceLine({
          price, color: '#F97316', lineWidth: 1, lineStyle: 0, axisLabelVisible: false,
        });
      }
    });

    if (overlays.trail_line > 0) {
      candleSeriesRef.current?.createPriceLine({
        price: overlays.trail_line, color: '#00FF66', lineWidth: 2, lineStyle: 0, title: 'SELL', axisLabelVisible: true,
      });
    }

    if (overlays.dca_line > 0) {
      candleSeriesRef.current?.createPriceLine({
        price: overlays.dca_line, color: '#EF4444', lineWidth: 2, lineStyle: 0, title: 'DCA', axisLabelVisible: true,
      });
    }

    if (overlays.ask_price > 0) {
      candleSeriesRef.current?.createPriceLine({
        price: overlays.ask_price, color: '#A855F7', lineWidth: 1, lineStyle: 2, title: 'ASK', axisLabelVisible: true,
      });
    }

    if (overlays.bid_price > 0) {
      candleSeriesRef.current?.createPriceLine({
        price: overlays.bid_price, color: '#14B8A6', lineWidth: 1, lineStyle: 2, title: 'BID', axisLabelVisible: true,
      });
    }
  };

  return (
    <div className="relative h-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark-bg/80 z-10">
          <span className="text-dark-muted">Loading chart...</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark-bg/80 z-10">
          <span className="text-red-500">{error}</span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
