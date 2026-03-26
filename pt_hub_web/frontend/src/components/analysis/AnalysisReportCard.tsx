import type { AnalysisReport } from '../../services/types';

const DECISION_BADGE_STYLES: Record<string, React.CSSProperties> = {
  BUY: {
    background: 'rgba(34,197,94,0.15)',
    border: '1px solid rgba(34,197,94,0.25)',
    color: '#17c964',
  },
  HOLD: {
    background: 'rgba(234,179,8,0.15)',
    border: '1px solid rgba(234,179,8,0.25)',
    color: '#f5a524',
  },
  SELL: {
    background: 'rgba(239,68,68,0.15)',
    border: '1px solid rgba(239,68,68,0.25)',
    color: '#f31260',
  },
};

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '\u2014';
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function confidenceBarColor(score: number): string {
  if (score >= 70) return '#17c964';
  if (score >= 40) return '#f5a524';
  return '#f31260';
}

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
  if (diff < -20) { zone = 'Undervalued'; zoneColor = '#17c964'; }
  else if (diff < -5) { zone = 'Undervalued'; zoneColor = '#17c964'; }
  else if (diff <= 5) { zone = 'About Right'; zoneColor = '#f5a524'; }
  else if (diff <= 20) { zone = 'Overvalued'; zoneColor = '#f5a524'; }
  else { zone = 'Overvalued'; zoneColor = '#f31260'; }

  const fairValuePos = 55;
  const currentBarW = (currentPrice / targetPrice) * fairValuePos;
  const targetBarW = fairValuePos;
  const markerPos = Math.min(currentBarW, 95);

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: '#18181b', border: '1px solid #27272a' }}
    >
      <h3 className="text-sm font-medium mb-1" style={{ color: '#a1a1aa' }}>
        Share Price vs Fair Value
      </h3>
      <p className="text-xs mb-4" style={{ color: '#a1a1aa' }}>
        Is the current price justified based on the analysis target?
      </p>

      {/* Percentage + zone label */}
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
          <div className="w-[3px] h-full" style={{ background: '#ECEDEE' }} />
          <div className="absolute top-0 -translate-x-[4px] w-[11px] h-4 rounded-sm" style={{ border: '2px solid #ECEDEE' }} />
        </div>

        {/* Zone bars */}
        <div className="space-y-3">
          {/* Current Price bar */}
          <div className="relative h-16 flex rounded-xl overflow-hidden">
            <div className="absolute inset-0 flex">
              <div style={{ width: '40%', background: 'rgba(34,197,94,0.35)' }} />
              <div style={{ width: '20%', background: 'rgba(234,179,8,0.30)' }} />
              <div style={{ width: '40%', background: 'rgba(239,68,68,0.25)' }} />
            </div>
            <div
              className="relative z-10 flex items-center justify-center"
              style={{ width: `${currentBarW}%`, background: 'rgba(0,0,0,0.45)' }}
            >
              <div className="text-center">
                <p className="text-xs font-medium" style={{ color: '#a1a1aa' }}>Current Price</p>
                <p className="text-lg font-bold font-mono" style={{ color: '#ECEDEE' }}>${fmt(currentPrice)}</p>
              </div>
            </div>
          </div>

          {/* Fair Value / Target bar */}
          <div className="relative h-16 flex rounded-xl overflow-hidden">
            <div className="absolute inset-0 flex">
              <div style={{ width: '40%', background: 'rgba(34,197,94,0.35)' }} />
              <div style={{ width: '20%', background: 'rgba(234,179,8,0.30)' }} />
              <div style={{ width: '40%', background: 'rgba(239,68,68,0.25)' }} />
            </div>
            <div
              className="relative z-10 flex items-center justify-center"
              style={{ width: `${targetBarW}%`, background: 'rgba(0,0,0,0.45)' }}
            >
              <div className="text-center">
                <p className="text-xs font-medium" style={{ color: '#a1a1aa' }}>Fair Value (Target)</p>
                <p className="text-lg font-bold font-mono" style={{ color: '#ECEDEE' }}>${fmt(targetPrice)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Zone labels */}
      <div className="flex mt-3">
        <div style={{ width: '40%' }} className="text-center">
          <span className="text-xs font-medium" style={{ color: '#17c964' }}>20% Undervalued</span>
        </div>
        <div style={{ width: '20%' }} className="text-center">
          <span className="text-xs font-medium" style={{ color: '#f5a524' }}>About Right</span>
        </div>
        <div style={{ width: '40%' }} className="text-center">
          <span className="text-xs font-medium" style={{ color: '#f31260' }}>20% Overvalued</span>
        </div>
      </div>
    </div>
  );
}

export function AnalysisReportCard({ report }: { report: AnalysisReport }) {
  const badgeStyle = DECISION_BADGE_STYLES[report.decision] ?? DECISION_BADGE_STYLES.HOLD;
  const fillColor = confidenceBarColor(report.score);

  return (
    <div className="space-y-4">
      {/* Decision + Score + Conclusion */}
      <div
        className="rounded-xl p-6"
        style={{ background: '#18181b', border: '1px solid #27272a' }}
      >
        <div className="flex items-center gap-4 mb-4">
          <span
            className="px-4 py-2 rounded-lg text-lg font-bold"
            style={badgeStyle}
          >
            {report.decision}
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ color: '#a1a1aa' }}>Confidence</span>
              <div
                className="flex-1 h-3 rounded-full overflow-hidden max-w-[200px]"
                style={{ background: '#27272a' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${report.score}%`,
                    background: fillColor,
                  }}
                />
              </div>
              <span className="font-medium text-sm" style={{ color: '#ECEDEE' }}>
                {report.score}/100
              </span>
            </div>
          </div>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: '#ECEDEE' }}>
          {report.conclusion}
        </p>
        <div className="mt-3 text-xs" style={{ color: '#a1a1aa' }}>
          {report.model_used && <span>Model: {report.model_used} &middot; </span>}
          {new Date(report.created_at).toLocaleString()}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Technical Indicators */}
        <div
          className="rounded-xl p-4"
          style={{ background: '#18181b', border: '1px solid #27272a' }}
        >
          <h3 className="text-sm font-medium mb-3" style={{ color: '#a1a1aa' }}>
            Technical Indicators
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span style={{ color: '#a1a1aa' }}>MA Alignment</span>
              <span className="font-medium" style={{
                color: report.indicators.ma_alignment.status === 'bullish' ? '#17c964' :
                  report.indicators.ma_alignment.status === 'bearish' ? '#f31260' : '#f5a524'
              }}>
                {report.indicators.ma_alignment.status}
              </span>
            </div>
            <div className="flex justify-between text-xs" style={{ color: '#a1a1aa' }}>
              <span>SMA20: <span className="font-mono">{fmt(report.indicators.ma_alignment.sma20)}</span></span>
              <span>SMA50: <span className="font-mono">{fmt(report.indicators.ma_alignment.sma50)}</span></span>
              <span>SMA200: <span className="font-mono">{fmt(report.indicators.ma_alignment.sma200)}</span></span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#a1a1aa' }}>RSI (14)</span>
              <span className="font-medium" style={{
                color: report.indicators.rsi.zone === 'overbought' ? '#f31260' :
                  report.indicators.rsi.zone === 'oversold' ? '#17c964' : '#ECEDEE'
              }}>
                <span className="font-mono">{fmt(report.indicators.rsi.value, 1)}</span> ({report.indicators.rsi.zone})
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#a1a1aa' }}>MACD</span>
              <span className="font-medium" style={{
                color: report.indicators.macd.direction === 'bullish' ? '#17c964' : '#f31260'
              }}>
                {report.indicators.macd.direction} (H: <span className="font-mono">{fmt(report.indicators.macd.histogram, 4)}</span>)
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#a1a1aa' }}>Volume</span>
              <span className="font-medium" style={{ color: '#ECEDEE' }}>
                <span className="font-mono">{report.indicators.volume.ratio}x</span> avg
              </span>
            </div>
          </div>
        </div>

        {/* Price Levels */}
        <div
          className="rounded-xl p-4"
          style={{ background: '#18181b', border: '1px solid #27272a' }}
        >
          <h3 className="text-sm font-medium mb-3" style={{ color: '#a1a1aa' }}>
            Price Levels
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span style={{ color: '#a1a1aa' }}>Current</span>
              <span className="font-medium font-mono" style={{ color: '#ECEDEE' }}>
                {fmt(report.current_price)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#a1a1aa' }}>Target</span>
              <span className="font-medium font-mono" style={{ color: '#17c964' }}>
                {fmt(report.price_levels.target)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#a1a1aa' }}>Stop Loss</span>
              <span className="font-medium font-mono" style={{ color: '#f31260' }}>
                {fmt(report.price_levels.stop_loss)}
              </span>
            </div>
            {report.price_levels.support.length > 0 && (
              <div className="flex justify-between">
                <span style={{ color: '#a1a1aa' }}>Support</span>
                <span className="text-xs font-mono" style={{ color: '#60A5FA' }}>
                  {report.price_levels.support.map(s => fmt(s)).join(', ')}
                </span>
              </div>
            )}
            {report.price_levels.resistance.length > 0 && (
              <div className="flex justify-between">
                <span style={{ color: '#a1a1aa' }}>Resistance</span>
                <span className="text-xs font-mono" style={{ color: '#f5a524' }}>
                  {report.price_levels.resistance.map(r => fmt(r)).join(', ')}
                </span>
              </div>
            )}
            <div className="pt-2 mt-2 flex justify-between text-xs" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.15)' }}>
              <span style={{ color: '#a1a1aa' }}>52W Range</span>
              <span className="font-mono" style={{ color: '#ECEDEE' }}>
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
        <div
          className="rounded-xl p-4"
          style={{ background: '#18181b', border: '1px solid #27272a' }}
        >
          <h3 className="text-sm font-medium mb-3" style={{ color: '#a1a1aa' }}>
            Analysis Checklist
          </h3>
          <div className="space-y-2">
            {report.checklist.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span style={{ color: item.passed ? '#17c964' : '#f31260' }}>
                  {item.passed ? '\u2713' : '\u2717'}
                </span>
                <span style={{ color: '#ECEDEE' }}>{item.item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent News */}
      {report.news && report.news.length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{ background: '#18181b', border: '1px solid #27272a' }}
        >
          <h3 className="text-sm font-medium mb-3" style={{ color: '#a1a1aa' }}>
            Recent News
          </h3>
          <div className="space-y-3">
            {[...report.news].sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0)).map((item, i) => {
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
                        className="leading-snug transition-colors"
                        style={{ color: '#ECEDEE' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#006FEE')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#ECEDEE')}
                      >
                        {item.headline}
                      </a>
                    ) : (
                      <p className="leading-snug" style={{ color: '#ECEDEE' }}>
                        {item.headline}
                      </p>
                    )}
                    <p className="text-xs mt-0.5" style={{ color: '#a1a1aa' }}>
                      {item.source}{date ? ` \u00B7 ${date}` : ''}
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
