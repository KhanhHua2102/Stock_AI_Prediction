import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData, Time } from 'lightweight-charts';
import { chartsApi } from '../../services/api';
import { useSettingsStore } from '../../store/settingsStore';

interface HoldingValueChartProps {
  holding?: string; // undefined = TOTAL, otherwise specific holding symbol
}

export function AccountValueChart({ holding }: HoldingValueChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const { settings } = useSettingsStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noData, setNoData] = useState(false);

  // Chart color based on holding type
  const chartColor = holding ? '#3B82F6' : '#00FF66'; // Blue for individual holdings, green for total

  // Initialize chart
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
        vertLine: {
          color: '#8B949E',
          width: 1,
          style: 2,
        },
        horzLine: {
          color: '#8B949E',
          width: 1,
          style: 2,
        },
      },
    });

    lineSeriesRef.current = chartRef.current.addLineSeries({
      color: chartColor,
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });

    // Handle resize
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
  }, [chartColor]);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      setNoData(false);

      try {
        const data = await chartsApi.getAccountValue(500, holding);

        if (lineSeriesRef.current) {
          // Filter out zero values for cleaner chart
          const filteredData = data.data.filter((d) => d.value > 0);

          if (filteredData.length > 0) {
            // Set line data
            const formattedData: LineData<Time>[] = filteredData.map((d) => ({
              time: d.time as Time,
              value: d.value,
            }));
            lineSeriesRef.current.setData(formattedData);
            setNoData(false);

            // Add trade markers
            if (data.trades && data.trades.length > 0) {
              const markers = data.trades.map((trade) => ({
                time: trade.time as Time,
                position: trade.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
                color:
                  trade.side === 'buy'
                    ? trade.tag === 'DCA'
                      ? '#A855F7'
                      : '#EF4444'
                    : '#00FF66',
                shape: 'circle' as const,
                text: trade.tag === 'DCA' ? 'D' : trade.side === 'buy' ? 'B' : 'S',
              }));
              lineSeriesRef.current.setMarkers(markers);
            }

            // Fit content
            chartRef.current?.timeScale().fitContent();
          } else {
            lineSeriesRef.current.setData([]);
            lineSeriesRef.current.setMarkers([]);
            setNoData(true);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chart data');
      }

      setLoading(false);
    };

    fetchData();

    // Refresh periodically
    const interval = setInterval(fetchData, (settings?.chart_refresh_seconds ?? 10) * 1000);
    return () => clearInterval(interval);
  }, [settings, holding]);

  const chartTitle = holding ? `${holding} Value (AUD)` : 'Total Portfolio Value (AUD)';

  return (
    <div className="relative h-full">
      {/* Chart title */}
      <div className="absolute top-2 left-4 z-20 text-sm font-medium text-dark-muted">
        {chartTitle}
      </div>
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
      {!loading && !error && noData && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-center">
            <span className="text-dark-muted block">No data available</span>
            <span className="text-dark-muted text-xs block mt-1">
              Start the trader to begin collecting account history
            </span>
          </div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
