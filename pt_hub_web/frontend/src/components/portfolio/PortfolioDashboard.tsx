import { useMemo, useState } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { usePortfolioDashboard } from '../../hooks/usePortfolioDashboard';
import { PerformanceChart } from './PerformanceChart';
import { DashboardSkeleton } from './DashboardSkeleton';
import { TickerAvatar } from '../common/TickerAvatar';
import type { ValueHistoryPoint, MonthlyReturn, SectorAllocation } from '../../services/types';

const PNL_COLORS = (v: number): React.CSSProperties =>
  v > 0
    ? { color: '#17c964' }
    : v < 0
      ? { color: '#f31260' }
      : { color: '#a1a1aa' };

/** Strip exchange suffix for display: "GLOB:AU" → "GLOB" */
const dt = (t: string) => t.replace(/:.*$/, '');

function formatCurrency(v: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompact(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(2);
}


// -- Returns by Timeframe Grid --
function computeTwrReturnForDays(
  twrData: { date: string; cumulative_return: number }[],
  valueData: ValueHistoryPoint[],
  days: number | null,
): { dollar: number; pct: number } | null {
  if (twrData.length < 2 || valueData.length < 2) return null;

  const lastTwr = twrData[twrData.length - 1];
  const lastVal = valueData[valueData.length - 1];

  if (days === null) {
    const pct = lastTwr.cumulative_return;
    // Guard: pct = -100 would cause division by zero
    if (100 + pct === 0) return { dollar: -lastVal.value, pct };
    const dollar = lastVal.value * (pct / (100 + pct));
    return { dollar, pct };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const startTwr = twrData.find(d => d.date >= cutoffStr) || twrData[0];

  const lastFactor = 1 + lastTwr.cumulative_return / 100;
  const startFactor = 1 + startTwr.cumulative_return / 100;
  if (startFactor <= 0) return null;
  const pct = (lastFactor / startFactor - 1) * 100;
  if (100 + pct === 0) return { dollar: -lastVal.value, pct };
  const dollar = lastVal.value * (pct / (100 + pct));

  return { dollar, pct };
}

/** Compute max gain and max loss TWR % within a date window */
function computePeakTrough(
  twrData: { date: string; cumulative_return: number }[],
  days: number | null,
): { maxGain: number; maxLoss: number } | null {
  if (twrData.length < 2) return null;

  let filtered = twrData;
  if (days !== null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    filtered = twrData.filter(d => d.date >= cutoffStr);
  }
  if (filtered.length < 2) return null;

  // Rebase so the first point in the window is 0%
  const baseFactor = 1 + filtered[0].cumulative_return / 100;
  if (baseFactor <= 0) return null;

  let maxGain = 0;
  let maxLoss = 0;
  for (const d of filtered) {
    const pct = ((1 + d.cumulative_return / 100) / baseFactor - 1) * 100;
    if (pct > maxGain) maxGain = pct;
    if (pct < maxLoss) maxLoss = pct;
  }
  return { maxGain, maxLoss };
}

function ReturnsGrid({ twrData, valueData }: { twrData: { date: string; cumulative_return: number }[]; valueData: ValueHistoryPoint[] }) {
  const periods = [
    { label: '1W', days: 7 },
    { label: '1M', days: 30 },
    { label: '3M', days: 90 },
    { label: '6M', days: 180 },
    { label: '1Y', days: 365 },
    { label: 'All', days: null as number | null },
  ];

  const results = periods.map(p => ({
    ...p,
    result: computeTwrReturnForDays(twrData, valueData, p.days),
    range: computePeakTrough(twrData, p.days),
  }));

  return (
    <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: '#18181b', border: '1px solid #27272a' }}>
      <div className="px-6 py-3 shrink-0" style={{ borderBottom: '1px solid #27272a' }}>
        <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Returns by Period</h3>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6">
        {results.map((r, i) => {
          const cellStyle: React.CSSProperties = {};
          if (i < results.length - 1) cellStyle.borderRight = '1px solid #27272a';
          return (
            <div
              key={r.label}
              className={`p-4 ${i >= 3 ? 'md:border-t-0' : ''}`}
              style={{
                ...cellStyle,
                ...(i >= 3 ? { borderTop: '1px solid #27272a' } : {}),
              }}
            >
              <p className="text-xs font-semibold mb-2" style={{ color: '#a1a1aa' }}>{r.label}</p>
              {r.result ? (
                <>
                  <p className="text-sm font-bold font-mono" style={PNL_COLORS(r.result.dollar)}>
                    {r.result.dollar >= 0 ? '+' : ''}${formatCompact(r.result.dollar)}
                  </p>
                  <p className="text-xs font-mono mt-0.5 flex items-center gap-1" style={PNL_COLORS(r.result.pct)}>
                    <span>{r.result.pct >= 0 ? '\u2191' : '\u2193'}</span>
                    {r.result.pct >= 0 ? '+' : ''}{r.result.pct.toFixed(1)}%
                  </p>
                </>
              ) : (
                <p className="text-sm" style={{ color: '#a1a1aa' }}>--</p>
              )}
            </div>
          );
        })}
      </div>
      {/* Peak / Trough per period */}
      <div className="flex-1 grid grid-cols-3 md:grid-cols-6" style={{ borderTop: '1px solid #27272a' }}>
        {results.map((r, i) => {
          const cellStyle: React.CSSProperties = {};
          if (i < results.length - 1) cellStyle.borderRight = '1px solid #27272a';
          return (
            <div key={r.label} className="p-4" style={cellStyle}>
              {r.range ? (
                <>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#17c964" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
                    <span className="text-xs font-mono font-medium" style={{ color: '#17c964' }}>
                      +{r.range.maxGain.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f31260" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    <span className="text-xs font-mono font-medium" style={{ color: '#f31260' }}>
                      {r.range.maxLoss.toFixed(1)}%
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-[10px]" style={{ color: '#71717a' }}>--</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -- Sector Donut Chart --

const SECTOR_COLORS = [
  '#006FEE', '#7828c8', '#17c964', '#f5a524', '#f31260',
  '#06b7db', '#ff4ecd', '#338ef7', '#45d483', '#f7b750',
  '#9353d3', '#f54180',
];

function SectorDonutChart({ allocation }: { allocation: SectorAllocation[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const size = 220;
  const strokeWidth = 36;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = useMemo(() => {
    let offset = 0;
    return allocation.map((a, i) => {
      const dash = (a.weight_pct / 100) * circumference;
      const gap = circumference - dash;
      const seg = { ...a, color: SECTOR_COLORS[i % SECTOR_COLORS.length], dashArray: `${dash} ${gap}`, dashOffset: -offset };
      offset += dash;
      return seg;
    });
  }, [allocation, circumference]);

  const active = hovered !== null ? segments[hovered] : null;

  const handleMouseMove = (e: React.MouseEvent) => {
    setMouse({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: '#18181b', border: '1px solid #27272a', maxHeight: 330 }}>
      <div className="px-5 py-4 shrink-0" style={{ borderBottom: '1px solid #27272a' }}>
        <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Sector Allocation</h3>
      </div>
      <div className="p-5 flex-1 flex flex-col" onMouseMove={handleMouseMove}>
        <div className="flex items-center gap-6">
          {/* Donut */}
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#27272a" strokeWidth={strokeWidth} />
              {segments.map((seg, i) => (
                <circle
                  key={seg.sector}
                  cx={size / 2} cy={size / 2} r={radius}
                  fill="none" stroke={seg.color}
                  strokeWidth={hovered === i ? strokeWidth + 6 : strokeWidth}
                  strokeDasharray={seg.dashArray}
                  strokeDashoffset={seg.dashOffset}
                  strokeLinecap="butt"
                  style={{
                    transform: 'rotate(-90deg)', transformOrigin: '50% 50%',
                    transition: 'stroke-width 0.2s, opacity 0.2s',
                    opacity: hovered !== null && hovered !== i ? 0.4 : 1,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              {active ? (
                <>
                  <p className="text-2xl font-bold font-mono" style={{ color: '#ECEDEE' }}>{active.weight_pct.toFixed(1)}%</p>
                  <p className="text-xs font-medium text-center px-2" style={{ color: '#a1a1aa', maxWidth: 120 }}>{active.sector}</p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold font-mono" style={{ color: '#ECEDEE' }}>{allocation.length}</p>
                  <p className="text-xs" style={{ color: '#a1a1aa' }}>Sectors</p>
                </>
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {segments.map((seg, i) => (
              <div
                key={seg.sector}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
                style={{ background: hovered === i ? '#27272a' : 'transparent' }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seg.color }} />
                <span className="text-xs truncate" style={{ color: hovered === i ? '#ECEDEE' : '#a1a1aa' }}>{seg.sector}</span>
                <span className="text-xs font-mono ml-auto shrink-0" style={{ color: hovered === i ? '#ECEDEE' : '#71717a' }}>{seg.weight_pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Cursor-following tooltip bubble */}
      {active && active.tickers && mouse && (
        <div
          className="fixed z-50 pointer-events-none rounded-xl shadow-2xl p-3"
          style={{
            left: mouse.x + 16,
            top: mouse.y - 10,
            background: '#09090b',
            border: '1px solid #27272a',
            minWidth: 180,
            maxWidth: 260,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full" style={{ background: active.color }} />
            <span className="text-xs font-semibold" style={{ color: '#ECEDEE' }}>{active.sector}</span>
            <span className="text-xs font-mono ml-auto" style={{ color: active.color }}>{active.weight_pct.toFixed(1)}%</span>
          </div>
          <div className="space-y-1">
            {active.tickers.map((t: any) => (
              <div key={t.ticker} className="flex items-center justify-between text-[11px]">
                <span style={{ color: '#a1a1aa' }}>{dt(t.ticker)}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono" style={{ color: '#ECEDEE' }}>${formatCurrency(t.value)}</span>
                  <span className="font-mono" style={{ color: '#71717a' }}>{t.weight_pct.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -- Monthly Returns Bar Chart --
function MonthlyReturnsChart({ data }: { data: MonthlyReturn[] }) {
  const maxAbs = Math.max(...data.map(d => Math.abs(d.return_pct)), 1);
  const avg = data.reduce((s, d) => s + d.return_pct, 0) / data.length;
  // Average line position: 50% is zero line. Positive avg goes up, negative goes down.
  // Each half is 80px (50% of 160). avgOffset in px from center.
  const avgPctOfMax = avg / maxAbs; // -1 to 1
  const avgTopPct = 50 - avgPctOfMax * 50; // 0%=top, 50%=center, 100%=bottom

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#18181b', border: '1px solid #27272a' }}>
      <div className="px-6 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #27272a' }}>
        <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Monthly Returns</h3>
        <span className="text-[10px] font-mono" style={{ color: '#52525b' }}>
          avg <span style={PNL_COLORS(avg)}>{avg >= 0 ? '+' : ''}{avg.toFixed(2)}%</span>
        </span>
      </div>
      <div className="p-4">
        {/* Bar chart */}
        <div className="relative">
          <div className="flex items-end gap-1" style={{ height: 160 }}>
            {data.map(m => {
              const barHeight = (Math.abs(m.return_pct) / maxAbs) * 100;
              const isPositive = m.return_pct >= 0;
              return (
                <div key={m.period} className="flex-1 flex flex-col items-center justify-end h-full relative group">
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                    <div className="rounded-lg px-2 py-1 text-[10px] whitespace-nowrap shadow-lg" style={{ background: '#18181b', border: '1px solid #27272a' }}>
                      <span style={{ color: '#a1a1aa' }}>{m.period}: </span>
                      <span style={PNL_COLORS(m.return_pct)}>
                        {m.return_pct >= 0 ? '+' : ''}{m.return_pct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  {isPositive ? (
                    <div className="w-full flex flex-col justify-end" style={{ height: '50%' }}>
                      <div
                        className="w-full rounded-t-sm transition-all"
                        style={{
                          height: `${barHeight}%`,
                          minHeight: m.return_pct !== 0 ? 2 : 0,
                          background: '#17c964',
                          opacity: 0.75,
                        }}
                        onMouseEnter={e => { (e.target as HTMLElement).style.opacity = '1'; }}
                        onMouseLeave={e => { (e.target as HTMLElement).style.opacity = '0.75'; }}
                      />
                    </div>
                  ) : (
                    <div className="w-full" style={{ height: '50%' }} />
                  )}
                  {!isPositive ? (
                    <div className="w-full" style={{ height: '50%' }}>
                      <div
                        className="w-full rounded-b-sm transition-all"
                        style={{
                          height: `${barHeight}%`,
                          minHeight: m.return_pct !== 0 ? 2 : 0,
                          background: '#f31260',
                          opacity: 0.75,
                        }}
                        onMouseEnter={e => { (e.target as HTMLElement).style.opacity = '1'; }}
                        onMouseLeave={e => { (e.target as HTMLElement).style.opacity = '0.75'; }}
                      />
                    </div>
                  ) : (
                    <div className="w-full" style={{ height: '50%' }} />
                  )}
                </div>
              );
            })}
          </div>
          {/* Zero line */}
          <div className="absolute left-0 right-0" style={{ top: '50%', borderTop: '1px solid rgba(255, 255, 255, 0.15)' }} />
          {/* Average line */}
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{
              top: `${avgTopPct}%`,
              borderTop: '1.5px dashed #006FEE',
              opacity: 0.6,
            }}
          />
        </div>
        {/* Labels */}
        <div className="flex gap-1 mt-2">
          {data.map((m, i) => (
            <div key={m.period} className="flex-1 text-center">
              {i % Math.max(1, Math.floor(data.length / 8)) === 0 ? (
                <span className="text-[9px] font-mono" style={{ color: '#a1a1aa' }}>
                  {m.period.slice(2).replace('-', '/')}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -- Rolling Volatility Chart --
function VolatilityChart({ data }: { data: MonthlyReturn[] }) {
  // Compute rolling 3-month annualised volatility from monthly returns
  const window = 3;
  const points: { period: string; vol: number }[] = [];
  for (let i = window - 1; i < data.length; i++) {
    const slice = data.slice(i - window + 1, i + 1).map(d => d.return_pct);
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
    const monthlyVol = Math.sqrt(variance);
    const annualised = monthlyVol * Math.sqrt(12);
    points.push({ period: data[i].period, vol: annualised });
  }

  if (points.length < 2) return null;

  const maxVol = Math.max(...points.map(p => p.vol), 1);
  const avgVol = points.reduce((s, p) => s + p.vol, 0) / points.length;
  const avgY = 100 - (avgVol / maxVol) * 100;
  const chartH = 120;

  // Build SVG path
  const stepX = 100 / (points.length - 1);
  const pathD = points
    .map((p, i) => {
      const x = i * stepX;
      const y = 100 - (p.vol / maxVol) * 100;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  // Filled area
  const areaD = pathD + ` L100,100 L0,100 Z`;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#18181b', border: '1px solid #27272a' }}>
      <div className="px-6 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #27272a' }}>
        <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: '#a1a1aa' }}>
          Rolling Volatility
        </h3>
        <span className="text-[10px] font-mono" style={{ color: '#52525b' }}>3M annualised</span>
      </div>
      <div className="p-4">
        <div className="relative" style={{ height: chartH }}>
          {/* Y-axis labels */}
          <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between pointer-events-none" style={{ width: 36 }}>
            <span className="text-[9px] font-mono" style={{ color: '#52525b' }}>{maxVol.toFixed(0)}%</span>
            <span className="text-[9px] font-mono" style={{ color: '#52525b' }}>{(maxVol / 2).toFixed(0)}%</span>
            <span className="text-[9px] font-mono" style={{ color: '#52525b' }}>0%</span>
          </div>
          {/* Grid lines */}
          <div className="absolute inset-0" style={{ left: 40 }}>
            <div className="absolute w-full" style={{ top: '0%', borderTop: '1px solid rgba(255,255,255,0.04)' }} />
            <div className="absolute w-full" style={{ top: '50%', borderTop: '1px solid rgba(255,255,255,0.04)' }} />
            <div className="absolute w-full" style={{ top: '100%', borderTop: '1px solid rgba(255,255,255,0.04)' }} />
          </div>
          {/* Chart */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0"
            style={{ left: 40, width: 'calc(100% - 40px)', height: '100%' }}
          >
            <defs>
              <linearGradient id="vol-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f5a524" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#f5a524" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={areaD} fill="url(#vol-fill)" />
            <path d={pathD} fill="none" stroke="#f5a524" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            {/* Average line */}
            <line x1="0" y1={avgY} x2="100" y2={avgY} stroke="#006FEE" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" opacity="0.6" />
          </svg>
          {/* Hover overlay */}
          <div className="absolute inset-0 flex" style={{ left: 40, width: 'calc(100% - 40px)' }}>
            {points.map(p => (
              <div key={p.period} className="flex-1 relative group">
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                  <div className="rounded-lg px-2 py-1 text-[10px] whitespace-nowrap shadow-lg" style={{ background: '#18181b', border: '1px solid #27272a' }}>
                    <span style={{ color: '#a1a1aa' }}>{p.period}: </span>
                    <span style={{ color: '#f5a524' }}>{p.vol.toFixed(1)}%</span>
                  </div>
                </div>
                <div
                  className="absolute inset-0 transition-colors"
                  style={{ background: 'transparent' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,165,36,0.06)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                />
              </div>
            ))}
          </div>
        </div>
        {/* X-axis labels */}
        <div className="flex mt-2" style={{ paddingLeft: 40 }}>
          {points.map((p, i) => (
            <div key={p.period} className="flex-1 text-center">
              {i % Math.max(1, Math.floor(points.length / 8)) === 0 ? (
                <span className="text-[9px] font-mono" style={{ color: '#a1a1aa' }}>
                  {p.period.slice(2).replace('-', '/')}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {/* Summary stats */}
        <div className="flex gap-6 mt-3 pt-3" style={{ borderTop: '1px solid #27272a' }}>
          <div>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Current</p>
            <p className="text-sm font-bold font-mono" style={{ color: '#f5a524' }}>{points[points.length - 1].vol.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Average</p>
            <p className="text-sm font-bold font-mono" style={{ color: '#a1a1aa' }}>
              {(points.reduce((s, p) => s + p.vol, 0) / points.length).toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Max</p>
            <p className="text-sm font-bold font-mono" style={{ color: '#f31260' }}>
              {Math.max(...points.map(p => p.vol)).toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Min</p>
            <p className="text-sm font-bold font-mono" style={{ color: '#17c964' }}>
              {Math.min(...points.map(p => p.vol)).toFixed(1)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Main Dashboard --
export function PortfolioDashboard() {
  const { selectedId, rebuildSnapshots } = usePortfolioStore();
  const { data, events, eventsLoading, isLoading, invalidate } = usePortfolioDashboard(selectedId);
  const { summary, valueHistory, performance, allocation, monthlyReturns, drawdown, stockBreakdown, closedBreakdown, dividends } = data;
  const [rebuilding, setRebuilding] = useState(false);
  const [heroView, setHeroView] = useState<'current' | 'historical'>('current');

  const handleRebuild = async () => {
    if (!selectedId || rebuilding) return;
    setRebuilding(true);
    try {
      await rebuildSnapshots(selectedId);
      invalidate();
    } finally {
      setRebuilding(false);
    }
  };

  const todayGain = useMemo(() => {
    if (valueHistory.length < 1 || stockBreakdown.length === 0) return null;
    const currentValue = stockBreakdown.reduce((s, h) => s + h.market_value, 0);
    const lastSnapshot = valueHistory[valueHistory.length - 1];
    if (lastSnapshot.value <= 0) return null;

    // Compare live market value against last snapshot.
    // Snapshots are end-of-day, so this gives today's market movement.
    // If deposits happened since the snapshot, subtract the deposit delta
    // (deposits field = cumulative cash_flow from snapshots).
    let prevValue = lastSnapshot.value;
    if (valueHistory.length >= 2) {
      const prevSnapshot = valueHistory[valueHistory.length - 2];
      const depositDelta = (lastSnapshot.deposits || 0) - (prevSnapshot.deposits || 0);
      if (depositDelta !== 0) {
        // Deposits changed between these snapshots — adjust baseline
        prevValue += depositDelta;
      }
    }

    const dollar = currentValue - prevValue;
    const pct = prevValue > 0 ? (dollar / prevValue) * 100 : 0;
    const lastDate = new Date(lastSnapshot.date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - lastDate.getTime()) / 86400000);
    const label = diffDays <= 1 ? 'Today' : diffDays <= 3 ? 'Since last close' : `Since ${lastSnapshot.date}`;
    return { dollar, pct, label };
  }, [valueHistory, stockBreakdown]);

  const currentStats = useMemo(() => {
    const totalValue = stockBreakdown.reduce((s, h) => s + h.market_value, 0);
    const invested = stockBreakdown.reduce((s, h) => s + h.cost_basis, 0);
    const capitalGain = stockBreakdown.reduce((s, h) => s + h.unrealised_pnl, 0);
    const realisedGain = stockBreakdown.reduce((s, h) => s + h.realised_pnl, 0);
    const income = stockBreakdown.reduce((s, h) => s + h.dividends, 0);
    const totalGain = capitalGain + realisedGain + income;
    const totalGainPct = invested > 0 ? (totalGain / invested * 100) : 0;
    return { totalValue, invested, capitalGain, income, totalGain, totalGainPct };
  }, [stockBreakdown]);

  const historicalStats = useMemo(() => {
    const all = [...stockBreakdown, ...closedBreakdown];
    const currentMarketValue = stockBreakdown.reduce((s, h) => s + h.market_value, 0);
    // Cash returned from closed positions = principal + realised gains + dividends
    const closedCash = closedBreakdown.reduce((s, h) => s + h.cost_basis + h.realised_pnl + h.dividends, 0);
    // Cash already received from active positions (partial sells + dividends)
    const activeCash = stockBreakdown.reduce((s, h) => s + h.realised_pnl + h.dividends, 0);
    const totalValue = currentMarketValue + closedCash + activeCash;
    const invested = all.reduce((s, h) => s + h.cost_basis, 0);
    const capitalGain = all.reduce((s, h) => s + h.unrealised_pnl + h.realised_pnl, 0);
    const income = all.reduce((s, h) => s + h.dividends, 0);
    const totalGain = capitalGain + income;
    const totalGainPct = invested > 0 ? (totalGain / invested * 100) : 0;
    return { totalValue, invested, capitalGain, income, totalGain, totalGainPct };
  }, [stockBreakdown, closedBreakdown]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (!summary || summary.holdings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ color: '#a1a1aa' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20v-6M6 20V10M18 20V4" />
        </svg>
        <p>No holdings yet. Import transactions to get started.</p>
      </div>
    );
  }

  const hasChartData = valueHistory.length > 1 || (performance && performance.portfolio.length > 1) || drawdown.length > 1;

  return (
    <div className="space-y-6">
      {/* Total Investments + Returns by Period -- 2 col */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hero Summary */}
        <div className="rounded-xl p-6 self-start" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Total Investments</p>
              <button
                onClick={handleRebuild}
                disabled={rebuilding}
                title="Rebuild chart snapshots"
                className="transition-colors disabled:opacity-50"
                style={{ color: '#a1a1aa' }}
                onMouseEnter={e => { (e.target as HTMLElement).style.color = '#006FEE'; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.color = '#a1a1aa'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={rebuilding ? 'animate-spin' : ''}>
                  <path d="M21 2v6h-6M3 12a9 9 0 0115.36-6.36L21 8M3 22v-6h6M21 12a9 9 0 01-15.36 6.36L3 16" />
                </svg>
              </button>
            </div>
            <div className="rounded-full p-0.5 flex" style={{ background: '#27272a' }}>
              <button
                onClick={() => setHeroView('current')}
                className="px-3 py-1 text-xs font-semibold rounded-full transition-colors"
                style={heroView === 'current'
                  ? { background: '#006FEE', color: '#ffffff' }
                  : { color: '#a1a1aa' }
                }
              >
                Current
              </button>
              <button
                onClick={() => setHeroView('historical')}
                className="px-3 py-1 text-xs font-semibold rounded-full transition-colors"
                style={heroView === 'historical'
                  ? { background: '#006FEE', color: '#ffffff' }
                  : { color: '#a1a1aa' }
                }
              >
                Historical
              </button>
            </div>
          </div>

          {heroView === 'current' ? (
            <>
              <p className="text-3xl font-bold font-mono" style={{ color: '#ECEDEE' }}>${formatCurrency(currentStats.totalValue)}</p>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-sm font-mono font-bold" style={PNL_COLORS(currentStats.totalGainPct)}>
                  {currentStats.totalGainPct >= 0 ? '+' : ''}{currentStats.totalGainPct.toFixed(2)}%
                </span>
                <span
                  className="text-sm font-mono font-bold px-2 py-0.5 rounded-lg"
                  style={currentStats.totalGain >= 0
                    ? { background: 'rgba(34,197,94,0.15)', color: '#17c964' }
                    : { background: 'rgba(239,68,68,0.15)', color: '#f31260' }
                  }
                >
                  {currentStats.totalGain >= 0 ? '+' : ''}${formatCurrency(currentStats.totalGain)}
                </span>
              </div>
              <div className="flex gap-6 mt-4 pt-4" style={{ borderTop: '1px solid #27272a' }}>
                <div className="text-center">
                  <p className="text-lg font-bold font-mono" style={{ color: '#ECEDEE' }}>${formatCurrency(currentStats.invested)}</p>
                  <p className="text-xs" style={{ color: '#a1a1aa' }}>Invested</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold font-mono" style={PNL_COLORS(currentStats.capitalGain)}>${formatCurrency(currentStats.capitalGain)}</p>
                  <p className="text-xs" style={{ color: '#a1a1aa' }}>Unrealised gain</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold font-mono" style={currentStats.income > 0 ? { color: '#17c964' } : { color: '#ECEDEE' }}>${formatCurrency(currentStats.income)}</p>
                  <p className="text-xs" style={{ color: '#a1a1aa' }}>Income gain</p>
                </div>
                {todayGain && (
                  <div className="text-center">
                    <p className="text-lg font-bold font-mono" style={PNL_COLORS(todayGain.dollar)}>
                      {todayGain.dollar >= 0 ? '+' : ''}${formatCurrency(todayGain.dollar)}
                    </p>
                    <p className="text-xs" style={{ color: '#a1a1aa' }}>{todayGain.label} <span className="font-mono" style={PNL_COLORS(todayGain.pct)}>({todayGain.pct >= 0 ? '+' : ''}{todayGain.pct.toFixed(2)}%)</span></p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold font-mono" style={{ color: '#ECEDEE' }}>${formatCurrency(historicalStats.totalValue)}</p>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-sm font-mono font-bold" style={PNL_COLORS(historicalStats.totalGainPct)}>
                  {historicalStats.totalGainPct >= 0 ? '+' : ''}{historicalStats.totalGainPct.toFixed(2)}%
                </span>
                <span
                  className="text-sm font-mono font-bold px-2 py-0.5 rounded-lg"
                  style={historicalStats.totalGain >= 0
                    ? { background: 'rgba(34,197,94,0.15)', color: '#17c964' }
                    : { background: 'rgba(239,68,68,0.15)', color: '#f31260' }
                  }
                >
                  {historicalStats.totalGain >= 0 ? '+' : ''}${formatCurrency(historicalStats.totalGain)}
                </span>
              </div>
              <div className="flex gap-6 mt-4 pt-4" style={{ borderTop: '1px solid #27272a' }}>
                <div className="text-center">
                  <p className="text-lg font-bold font-mono" style={{ color: '#ECEDEE' }}>${formatCurrency(historicalStats.invested)}</p>
                  <p className="text-xs" style={{ color: '#a1a1aa' }}>Total invested</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold font-mono" style={PNL_COLORS(historicalStats.capitalGain)}>${formatCurrency(historicalStats.capitalGain)}</p>
                  <p className="text-xs" style={{ color: '#a1a1aa' }}>Capital gain</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold font-mono" style={historicalStats.income > 0 ? { color: '#17c964' } : { color: '#ECEDEE' }}>${formatCurrency(historicalStats.income)}</p>
                  <p className="text-xs" style={{ color: '#a1a1aa' }}>Income gain</p>
                </div>
                {todayGain && (
                  <div className="text-center">
                    <p className="text-lg font-bold font-mono" style={PNL_COLORS(todayGain.dollar)}>
                      {todayGain.dollar >= 0 ? '+' : ''}${formatCurrency(todayGain.dollar)}
                    </p>
                    <p className="text-xs" style={{ color: '#a1a1aa' }}>{todayGain.label} <span className="font-mono" style={PNL_COLORS(todayGain.pct)}>({todayGain.pct >= 0 ? '+' : ''}{todayGain.pct.toFixed(2)}%)</span></p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Returns by Timeframe Grid */}
        {valueHistory.length > 1 && performance && performance.portfolio.length > 1 && (
          <ReturnsGrid twrData={performance.portfolio} valueData={valueHistory} />
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-xl p-4" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#a1a1aa' }}>Unrealised P&L</p>
          <p className="text-lg font-bold font-mono" style={PNL_COLORS(summary.unrealised_pnl)}>${formatCurrency(summary.unrealised_pnl)}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#a1a1aa' }}>Realised P&L</p>
          <p className="text-lg font-bold font-mono" style={PNL_COLORS(summary.realised_pnl)}>${formatCurrency(summary.realised_pnl)}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#a1a1aa' }}>Annualised Return</p>
          <p className="text-lg font-bold font-mono" style={PNL_COLORS(summary.annualised_return)}>{summary.annualised_return.toFixed(2)}%</p>
        </div>
      </div>

      {/* Risk Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-xl p-4" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#a1a1aa' }}>Sharpe Ratio</p>
          <p className="text-lg font-bold font-mono" style={{ color: summary.sharpe_ratio >= 1 ? '#17c964' : summary.sharpe_ratio >= 0 ? '#f5a524' : '#f31260' }}>
            {summary.sharpe_ratio.toFixed(2)}
          </p>
          <p className="text-[10px] mt-1" style={{ color: '#a1a1aa' }}>Risk-adjusted return</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#a1a1aa' }}>Beta</p>
          <p className="text-lg font-bold font-mono" style={{ color: summary.beta > 1.1 ? '#f31260' : summary.beta < 0.9 ? '#17c964' : '#f5a524' }}>
            {summary.beta.toFixed(2)}
          </p>
          <p className="text-[10px] mt-1" style={{ color: '#a1a1aa' }}>{summary.beta > 1 ? 'More volatile than market' : summary.beta < 1 ? 'Less volatile than market' : 'Moves with market'}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#a1a1aa' }}>Max Drawdown</p>
          <p className="text-lg font-bold font-mono" style={{ color: '#f31260' }}>{summary.max_drawdown.toFixed(2)}%</p>
          <p className="text-[10px] mt-1" style={{ color: '#a1a1aa' }}>Largest peak-to-trough drop</p>
        </div>
      </div>

      {/* Advanced Performance Chart */}
      {hasChartData && <PerformanceChart />}

      {/* Holdings + Closed Positions -- 2 col, max 3 items visible */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current Holdings */}
        {stockBreakdown.length > 0 && (() => {
          const totalMV = stockBreakdown.reduce((s, h) => s + h.market_value, 0);
          const sorted = [...stockBreakdown].sort((a, b) => b.market_value - a.market_value);
          return (
            <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: '#18181b', border: '1px solid #27272a', maxHeight: 450 }}>
              <div className="px-5 py-4 flex items-center gap-2 shrink-0" style={{ borderBottom: '1px solid #27272a' }}>
                <h3 className="text-base font-semibold" style={{ color: '#ECEDEE' }}>Holdings</h3>
                <span
                  className="text-[11px] font-semibold w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: '#27272a', color: '#a1a1aa' }}
                >
                  {stockBreakdown.length}
                </span>
              </div>
              <div className="overflow-y-auto flex-1">
                {sorted.map(s => {
                  const weightPct = totalMV > 0 ? (s.market_value / totalMV * 100) : 0;
                  return (
                    <div
                      key={s.ticker}
                      className="px-5 py-4 transition-colors"
                      style={{ borderBottom: '1px solid #27272a' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <TickerAvatar ticker={s.ticker} size={40} />
                          <div>
                            <p className="text-sm font-semibold" style={{ color: '#ECEDEE' }}>{dt(s.ticker)}</p>
                            <p className="text-xs" style={{ color: '#71717a' }}>{s.quantity.toFixed(2)} shares</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold font-mono" style={{ color: '#ECEDEE' }}>${formatCurrency(s.market_value)}</p>
                          <p className="text-xs font-mono flex items-center justify-end gap-1" style={PNL_COLORS(s.total_return_pct)}>
                            <span style={{ fontSize: 10 }}>{s.total_return_pct >= 0 ? '\u25B2' : '\u25BC'}</span>
                            {s.total_return_pct >= 0 ? '+' : ''}{s.total_return_pct.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-5 gap-2 mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Avg Cost</p>
                          <p className="text-xs font-mono mt-0.5" style={{ color: '#a1a1aa' }}>${s.avg_cost.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Price</p>
                          <p className="text-xs font-mono mt-0.5" style={{ color: '#ECEDEE' }}>${s.current_price.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Weight</p>
                          <p className="text-xs font-mono mt-0.5" style={{ color: '#a1a1aa' }}>{weightPct.toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Unrealised</p>
                          <p className="text-xs font-mono mt-0.5" style={PNL_COLORS(s.unrealised_pnl)}>${formatCurrency(s.unrealised_pnl)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Dividends</p>
                          <p className="text-xs font-mono mt-0.5" style={{ color: '#a1a1aa' }}>${formatCurrency(s.dividends)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Closed Positions */}
        {closedBreakdown.length > 0 && (
          <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: '#18181b', border: '1px solid #27272a', maxHeight: 450 }}>
            <div className="px-5 py-4 flex items-center gap-2 shrink-0" style={{ borderBottom: '1px solid #27272a' }}>
              <h3 className="text-base font-semibold" style={{ color: '#ECEDEE' }}>Closed Positions</h3>
              <span
                className="text-[11px] font-semibold w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: '#27272a', color: '#a1a1aa' }}
              >
                {closedBreakdown.length}
              </span>
            </div>
            <div className="overflow-y-auto flex-1">
              {[...closedBreakdown].sort((a, b) => (b.closed_date ?? '').localeCompare(a.closed_date ?? '')).map(s => {
                return (
                  <div
                    key={s.ticker}
                    className="px-5 py-4 transition-colors"
                    style={{ borderBottom: '1px solid #27272a' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                  >
                    {/* Main row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <TickerAvatar ticker={s.ticker} size={40} />
                        <div>
                          <p className="text-sm font-semibold" style={{ color: '#ECEDEE' }}>{dt(s.ticker)}</p>
                          <p className="text-xs" style={{ color: '#a1a1aa' }}>
                            {s.closed_date ? `Closed ${new Date(s.closed_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Closed'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold font-mono" style={PNL_COLORS(s.total_return)}>
                          {s.total_return >= 0 ? '+' : ''}${formatCurrency(s.total_return)}
                        </p>
                        <p className="text-xs font-mono" style={PNL_COLORS(s.total_return_pct)}>
                          {s.total_return_pct >= 0 ? '+' : ''}{s.total_return_pct.toFixed(2)}%
                        </p>
                      </div>
                    </div>
                    {/* Metrics row */}
                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Cost Basis</p>
                        <p className="text-xs font-mono mt-0.5" style={{ color: '#71717a' }}>${formatCurrency(s.cost_basis)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Realised P&L</p>
                        <p className="text-xs font-mono mt-0.5" style={PNL_COLORS(s.realised_pnl)}>${formatCurrency(s.realised_pnl)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: '#52525b' }}>Dividends</p>
                        <p className="text-xs font-mono mt-0.5" style={{ color: '#71717a' }}>${formatCurrency(s.dividends)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sector Allocation + Upcoming Events -- 2 col, same height */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {allocation.length > 0 && (
          <SectorDonutChart allocation={allocation} />
        )}

        {/* Upcoming Events — fixed height matching Sector Allocation */}
        <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: '#18181b', border: '1px solid #27272a', maxHeight: 330 }}>
          <div className="px-5 py-4 flex items-center gap-2 shrink-0" style={{ borderBottom: '1px solid #27272a' }}>
            <h3 className="text-base font-semibold" style={{ color: '#ECEDEE' }}>Upcoming Events</h3>
            {events.length > 0 && (
              <span
                className="text-[11px] font-semibold w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: '#27272a', color: '#a1a1aa' }}
              >
                {events.length}
              </span>
            )}
          </div>
          {eventsLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin w-4 h-4 rounded-full" style={{ border: '2px solid #006FEE', borderTopColor: 'transparent' }} />
              <span className="ml-2 text-xs" style={{ color: '#71717a' }}>Loading events...</span>
            </div>
          ) : events.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              <p className="text-xs" style={{ color: '#52525b' }}>No upcoming events</p>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              {events.map((ev, i) => {
                const d = new Date(ev.date + 'T00:00:00');
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const daysUntil = Math.round((d.getTime() - now.getTime()) / 86400000);
                const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const typeConfig: Record<string, { color: string; bg: string; icon: JSX.Element }> = {
                  earnings: {
                    color: '#f5a524',
                    bg: 'rgba(245,165,36,0.12)',
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
                  },
                  'ex-dividend': {
                    color: '#17c964',
                    bg: 'rgba(34,197,94,0.12)',
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" /></svg>,
                  },
                  dividend: {
                    color: '#006FEE',
                    bg: 'rgba(0,111,238,0.12)',
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" /></svg>,
                  },
                  distribution: {
                    color: '#9333ea',
                    bg: 'rgba(147,51,234,0.12)',
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" /></svg>,
                  },
                };
                const tc = typeConfig[ev.type] || typeConfig.earnings;
                const label = ev.type === 'ex-dividend' ? 'Ex-Div' : ev.type === 'earnings' ? 'Earnings' : ev.type === 'distribution' ? 'Distribution' : 'Dividend';

                return (
                  <div
                    key={`${ev.ticker}-${ev.type}-${ev.date}-${i}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors"
                    style={{ borderBottom: '1px solid #27272a' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                  >
                    {/* Icon */}
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: tc.bg, color: tc.color }}
                    >
                      {tc.icon}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold" style={{ color: '#ECEDEE' }}>{dt(ev.ticker)}</span>
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: tc.bg, color: tc.color }}
                        >
                          {label}
                        </span>
                      </div>
                      {ev.detail && (
                        <p className="text-[11px] mt-0.5 truncate" style={{ color: '#71717a' }}>{ev.detail}</p>
                      )}
                      {ev.type === 'distribution' && (ev.ex_date || ev.record_date || ev.payment_date) && (
                        <div className="flex gap-3 mt-1 text-[10px] font-mono" style={{ color: '#71717a' }}>
                          {ev.ex_date && <span>Ex: {ev.ex_date}</span>}
                          {ev.record_date && <span>Rec: {ev.record_date}</span>}
                          {ev.payment_date && <span>Pay: {ev.payment_date}</span>}
                        </div>
                      )}
                    </div>
                    {/* Date + countdown */}
                    <div className="text-right shrink-0">
                      <p className="text-xs font-mono" style={{ color: '#a1a1aa' }}>{dateStr}</p>
                      <p className="text-[10px] font-mono" style={{ color: daysUntil <= 7 ? '#f5a524' : '#52525b' }}>
                        {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Monthly Returns Bar Chart */}
      {monthlyReturns.length > 0 && <MonthlyReturnsChart data={monthlyReturns} />}

      {/* Rolling Volatility */}
      {monthlyReturns.length >= 3 && <VolatilityChart data={monthlyReturns} />}

      {/* Dividend Income */}
      {dividends.length > 0 && dividends.some(d => d.amount > 0) && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <div className="px-6 py-3" style={{ borderBottom: '1px solid #27272a' }}>
            <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: '#a1a1aa' }}>Dividend Income</h3>
          </div>
          <div className="p-4">
            <div className="flex items-end gap-1" style={{ height: 100 }}>
              {dividends.map(d => {
                const maxDiv = Math.max(...dividends.map(dd => dd.amount), 1);
                const barH = (d.amount / maxDiv) * 100;
                return (
                  <div key={d.period} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                    <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                      <div className="rounded-lg px-2 py-1 text-[10px] whitespace-nowrap shadow-lg" style={{ background: '#18181b', border: '1px solid #27272a', color: '#ECEDEE' }}>
                        {d.period}: ${formatCurrency(d.amount)}
                      </div>
                    </div>
                    <div
                      className="w-full rounded-t-sm transition-all"
                      style={{
                        height: `${barH}%`,
                        minHeight: d.amount > 0 ? 2 : 0,
                        background: '#a78bfa',
                        opacity: 0.75,
                      }}
                      onMouseEnter={e => { (e.target as HTMLElement).style.opacity = '1'; }}
                      onMouseLeave={e => { (e.target as HTMLElement).style.opacity = '0.75'; }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1 mt-2">
              {dividends.map((d, i) => (
                <div key={d.period} className="flex-1 text-center">
                  {i % Math.max(1, Math.floor(dividends.length / 8)) === 0 ? (
                    <span className="text-[9px] font-mono" style={{ color: '#a1a1aa' }}>{d.period.slice(2).replace('-', '/')}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
