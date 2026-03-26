import type { AnalysisReport } from '../../services/types';

function ValuationChart({ currentPrice, targetPrice }: {
  currentPrice: number;
  targetPrice: number;
  stopLoss: number;
  high52w: number;
  low52w: number;
}) {
  if (!currentPrice || !targetPrice || targetPrice <= 0) return null;

  const diff = ((currentPrice - targetPrice) / targetPrice) * 100;
  const absPercent = Math.abs(diff);

  let zone: string;
  let zoneColor: string;
  if (diff < -20) { zone = 'Undervalued'; zoneColor = '#22c55e'; }
  else if (diff < -5) { zone = 'Undervalued'; zoneColor = '#22c55e'; }
  else if (diff <= 5) { zone = 'About Right'; zoneColor = '#eab308'; }
  else if (diff <= 20) { zone = 'Overvalued'; zoneColor = '#eab308'; }
  else { zone = 'Overvalued'; zoneColor = '#ef4444'; }

  // The background has 3 zones: green (0-40%), yellow (40-60%), red (60-100%)
  // Fair value sits at the boundary between green and yellow (~40%)
  // Current price bar width is relative to fair value
  const fairValuePos = 55; // fair value at 55% of total width
  const currentBarW = (currentPrice / targetPrice) * fairValuePos;
  const targetBarW = fairValuePos;

  // Position for the vertical marker line (where the current price bar ends)
  const markerPos = Math.min(currentBarW, 95);

  return (
    <div className="bg-dark-panel rounded-lg border border-dark-border p-5">
      <h3 className="text-sm font-medium text-dark-muted mb-1">Share Price vs Fair Value</h3>
      <p className="text-xs text-dark-muted mb-4">
        Is the current price justified based on the analysis target?
      </p>

      {/* Percentage + zone label — positioned above the marker */}
      <div className="relative mb-2" style={{ height: 50 }}>
        <div className="absolute" style={{ left: `${markerPos}%`, transform: 'translateX(-50%)' }}>
          <p className="text-2xl font-bold font-mono text-center" style={{ color: zoneColor }}>
            {absPercent.toFixed(1)}%
          </p>
          <p className="text-sm font-medium text-center" style={{ color: zoneColor }}>{zone}</p>
        </div>
      </div>

      {/* Vertical marker line extending down through both bars */}
      <div className="relative">
        {/* Marker line */}
        <div
          className="absolute top-0 z-20"
          style={{ left: `${markerPos}%`, height: '100%', transform: 'translateX(-50%)' }}
        >
          <div className="w-[3px] h-full bg-white/80" />
          <div className="absolute top-0 -translate-x-[4px] w-[11px] h-4 border-2 border-white/90 bg-transparent rounded-sm" />
        </div>

        {/* Zone background — spans full width behind both bars */}
        <div className="space-y-3">
          {/* Current Price bar */}
          <div className="relative h-16 flex rounded overflow-hidden">
            {/* Zone background */}
            <div className="absolute inset-0 flex">
              <div style={{ width: '40%', background: '#22c55e' }} />
              <div style={{ width: '20%', background: '#eab308' }} />
              <div style={{ width: '40%', background: '#5c2626' }} />
            </div>
            {/* Dark overlay on the bar area with label */}
            <div
              className="relative z-10 flex items-center justify-center"
              style={{ width: `${currentBarW}%`, background: 'rgba(0,0,0,0.45)' }}
            >
              <div className="text-center">
                <p className="text-xs text-white/80 font-medium">Current Price</p>
                <p className="text-lg font-bold text-white">${fmt(currentPrice)}</p>
              </div>
            </div>
          </div>

          {/* Fair Value / Target bar */}
          <div className="relative h-16 flex rounded overflow-hidden">
            {/* Zone background */}
            <div className="absolute inset-0 flex">
              <div style={{ width: '40%', background: '#22c55e' }} />
              <div style={{ width: '20%', background: '#eab308' }} />
              <div style={{ width: '40%', background: '#5c2626' }} />
            </div>
            {/* Dark overlay on the bar area with label */}
            <div
              className="relative z-10 flex items-center justify-center"
              style={{ width: `${targetBarW}%`, background: 'rgba(0,0,0,0.45)' }}
            >
              <div className="text-center">
                <p className="text-xs text-white/80 font-medium">Fair Value (Target)</p>
                <p className="text-lg font-bold text-white">${fmt(targetPrice)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Zone labels */}
      <div className="flex mt-3">
        <div style={{ width: '40%' }} className="text-center">
          <span className="text-xs font-medium text-green-400">20% Undervalued</span>
        </div>
        <div style={{ width: '20%' }} className="text-center">
          <span className="text-xs font-medium text-yellow-400">About Right</span>
        </div>
        <div style={{ width: '40%' }} className="text-center">
          <span className="text-xs font-medium text-red-400">20% Overvalued</span>
        </div>
      </div>
    </div>
  );
}

const DECISION_STYLES: Record<string, { bg: string; text: string }> = {
  BUY: { bg: 'bg-green-500/20', text: 'text-green-400' },
  HOLD: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  SELL: { bg: 'bg-red-500/20', text: 'text-red-400' },
};

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function AnalysisReportCard({ report }: { report: AnalysisReport }) {
  const style = DECISION_STYLES[report.decision] ?? DECISION_STYLES.HOLD;

  return (
    <div className="space-y-4">
      {/* Decision + Score + Conclusion */}
      <div className="bg-dark-panel rounded-lg border border-dark-border p-6">
        <div className="flex items-center gap-4 mb-4">
          <span className={`px-4 py-2 rounded-lg text-lg font-bold ${style.bg} ${style.text}`}>
            {report.decision}
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <span className="text-dark-muted text-sm">Confidence</span>
              <div className="flex-1 h-3 bg-dark-bg2 rounded-full overflow-hidden max-w-[200px]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    report.score >= 70 ? 'bg-green-500' : report.score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${report.score}%` }}
                />
              </div>
              <span className="text-dark-fg font-medium text-sm">{report.score}/100</span>
            </div>
          </div>
        </div>
        <p className="text-dark-fg text-sm leading-relaxed">{report.conclusion}</p>
        <div className="mt-3 text-xs text-dark-muted">
          {report.model_used && <span>Model: {report.model_used} · </span>}
          {new Date(report.created_at).toLocaleString()}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Technical Indicators */}
        <div className="bg-dark-panel rounded-lg border border-dark-border p-4">
          <h3 className="text-sm font-medium text-dark-muted mb-3">Technical Indicators</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-dark-muted">MA Alignment</span>
              <span className={`font-medium ${
                report.indicators.ma_alignment.status === 'bullish' ? 'text-green-400' :
                report.indicators.ma_alignment.status === 'bearish' ? 'text-red-400' : 'text-yellow-400'
              }`}>
                {report.indicators.ma_alignment.status}
              </span>
            </div>
            <div className="flex justify-between text-xs text-dark-muted">
              <span>SMA20: {fmt(report.indicators.ma_alignment.sma20)}</span>
              <span>SMA50: {fmt(report.indicators.ma_alignment.sma50)}</span>
              <span>SMA200: {fmt(report.indicators.ma_alignment.sma200)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-muted">RSI (14)</span>
              <span className={`font-medium ${
                report.indicators.rsi.zone === 'overbought' ? 'text-red-400' :
                report.indicators.rsi.zone === 'oversold' ? 'text-green-400' : 'text-dark-fg'
              }`}>
                {fmt(report.indicators.rsi.value, 1)} ({report.indicators.rsi.zone})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-muted">MACD</span>
              <span className={`font-medium ${
                report.indicators.macd.direction === 'bullish' ? 'text-green-400' : 'text-red-400'
              }`}>
                {report.indicators.macd.direction} (H: {fmt(report.indicators.macd.histogram, 4)})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-muted">Volume</span>
              <span className="text-dark-fg font-medium">{report.indicators.volume.ratio}x avg</span>
            </div>
          </div>
        </div>

        {/* Price Levels */}
        <div className="bg-dark-panel rounded-lg border border-dark-border p-4">
          <h3 className="text-sm font-medium text-dark-muted mb-3">Price Levels</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-dark-muted">Current</span>
              <span className="text-dark-fg font-medium">{fmt(report.current_price)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-muted">Target</span>
              <span className="text-green-400 font-medium">{fmt(report.price_levels.target)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-muted">Stop Loss</span>
              <span className="text-red-400 font-medium">{fmt(report.price_levels.stop_loss)}</span>
            </div>
            {report.price_levels.support.length > 0 && (
              <div className="flex justify-between">
                <span className="text-dark-muted">Support</span>
                <span className="text-blue-400 text-xs">{report.price_levels.support.map(s => fmt(s)).join(', ')}</span>
              </div>
            )}
            {report.price_levels.resistance.length > 0 && (
              <div className="flex justify-between">
                <span className="text-dark-muted">Resistance</span>
                <span className="text-orange-400 text-xs">{report.price_levels.resistance.map(r => fmt(r)).join(', ')}</span>
              </div>
            )}
            <div className="border-t border-dark-border pt-2 mt-2 flex justify-between text-xs">
              <span className="text-dark-muted">52W Range</span>
              <span className="text-dark-fg">
                {fmt(report.indicators.price_range_52w.low)} — {fmt(report.indicators.price_range_52w.high)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Valuation Bar Chart */}
      <ValuationChart
        currentPrice={report.current_price}
        targetPrice={report.price_levels.target}
        stopLoss={report.price_levels.stop_loss}
        high52w={report.indicators.price_range_52w.high}
        low52w={report.indicators.price_range_52w.low}
      />

      {/* Checklist */}
      {report.checklist.length > 0 && (
        <div className="bg-dark-panel rounded-lg border border-dark-border p-4">
          <h3 className="text-sm font-medium text-dark-muted mb-3">Analysis Checklist</h3>
          <div className="space-y-2">
            {report.checklist.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className={item.passed ? 'text-green-400' : 'text-red-400'}>
                  {item.passed ? '✓' : '✗'}
                </span>
                <span className="text-dark-fg">{item.item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent News */}
      {report.news && report.news.length > 0 && (
        <div className="bg-dark-panel rounded-lg border border-dark-border p-4">
          <h3 className="text-sm font-medium text-dark-muted mb-3">Recent News</h3>
          <div className="space-y-3">
            {report.news.map((item, i) => {
              const date = item.datetime
                ? new Date(item.datetime * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : '';
              return (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className="flex-1">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-dark-fg leading-snug hover:text-dark-accent transition-colors"
                      >
                        {item.headline}
                      </a>
                    ) : (
                      <p className="text-dark-fg leading-snug">{item.headline}</p>
                    )}
                    <p className="text-dark-muted text-xs mt-0.5">
                      {item.source}{date ? ` · ${date}` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
