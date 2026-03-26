import { useState } from 'react';

const TICKER_COLORS = [
  { bg: 'rgba(0,111,238,0.20)', ring: 'rgba(0,111,238,0.35)', text: '#3b82f6' },
  { bg: 'rgba(34,197,94,0.20)', ring: 'rgba(34,197,94,0.35)', text: '#22c55e' },
  { bg: 'rgba(168,85,247,0.20)', ring: 'rgba(168,85,247,0.35)', text: '#a855f7' },
  { bg: 'rgba(245,158,11,0.20)', ring: 'rgba(245,158,11,0.35)', text: '#f59e0b' },
  { bg: 'rgba(236,72,153,0.20)', ring: 'rgba(236,72,153,0.35)', text: '#ec4899' },
  { bg: 'rgba(6,182,212,0.20)', ring: 'rgba(6,182,212,0.35)', text: '#06b6d4' },
  { bg: 'rgba(239,68,68,0.20)', ring: 'rgba(239,68,68,0.35)', text: '#ef4444' },
  { bg: 'rgba(132,204,22,0.20)', ring: 'rgba(132,204,22,0.35)', text: '#84cc16' },
];

function hashColor(ticker: string) {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) hash = ticker.charCodeAt(i) + ((hash << 5) - hash);
  return TICKER_COLORS[Math.abs(hash) % TICKER_COLORS.length];
}

/** Extract the base ticker symbol: "GLOB:AU" → "GLOB", "BHP.AX" → "BHP", "AAPL" → "AAPL" */
function baseTicker(raw: string): string {
  return raw.split(/[:.]/)[0];
}

/** Normalize ticker for Yahoo-style logo lookup: "BGBL:AU" → "BGBL.AX" */
function yahooTicker(raw: string): string {
  if (raw.includes(':AU')) return raw.replace(':AU', '.AX');
  if (raw.includes(':')) return raw.split(':')[0];
  return raw;
}

/** Known AU ETF issuers — map ticker prefixes to issuer domains for logo fallback */
const AU_ETF_ISSUERS: Record<string, string> = {
  // BetaShares
  A200: 'betashares.com.au', BGBL: 'betashares.com.au', HCRD: 'betashares.com.au',
  HGBL: 'betashares.com.au', NDQ: 'betashares.com.au', DHHF: 'betashares.com.au',
  AAA: 'betashares.com.au', BEAR: 'betashares.com.au', BBOZ: 'betashares.com.au',
  BBUS: 'betashares.com.au', QFN: 'betashares.com.au', HACK: 'betashares.com.au',
  ERTH: 'betashares.com.au', CLDD: 'betashares.com.au', BNDS: 'betashares.com.au',
  // iShares (BlackRock) — most have individual logos on FMP, skip issuer fallback
  // Vanguard
  VAS: 'vanguard.com.au', VGS: 'vanguard.com.au', VDHG: 'vanguard.com.au',
  VTS: 'vanguard.com.au', VEU: 'vanguard.com.au', VAF: 'vanguard.com.au',
  VGAD: 'vanguard.com.au', VESG: 'vanguard.com.au',
  // SPDR
  STW: 'ssga.com', SPY: 'ssga.com',
  // VanEck
  MVW: 'vaneck.com.au', QUAL: 'vaneck.com.au',
};

/** Build ordered list of logo URLs to try */
function logoUrls(ticker: string): string[] {
  const base = baseTicker(ticker);
  const yahoo = yahooTicker(ticker);
  const isAU = ticker.includes(':AU') || ticker.endsWith('.AX');
  const issuerDomain = AU_ETF_ISSUERS[base];

  const urls: string[] = [];

  if (issuerDomain) {
    // Known issuer — use issuer brand first, then try FMP with exchange-specific ticker
    urls.push(`https://www.google.com/s2/favicons?domain=${issuerDomain}&sz=64`);
    // Still try FMP with Yahoo-style (.AX) since some have individual logos (e.g. IVV.AX)
    urls.push(`https://financialmodelingprep.com/image-stock/${yahoo}.png`);
  } else {
    // Unknown issuer — try FMP variants
    urls.push(`https://financialmodelingprep.com/image-stock/${yahoo}.png`);
    if (yahoo !== base) {
      urls.push(`https://financialmodelingprep.com/image-stock/${base}.png`);
    }
    if (isAU) {
      urls.push(`https://financialmodelingprep.com/image-stock/ASX:${base}.png`);
    }
  }
  // Google favicon by guessing domain
  urls.push(
    `https://www.google.com/s2/favicons?domain=${base.toLowerCase()}.com&sz=64`,
  );
  if (isAU) {
    urls.push(
      `https://www.google.com/s2/favicons?domain=${base.toLowerCase()}.com.au&sz=64`,
    );
  }
  return urls;
}

interface TickerAvatarProps {
  ticker: string;
  size?: number;
  muted?: boolean;
}

export function TickerAvatar({ ticker, size = 40, muted = false }: TickerAvatarProps) {
  const [srcIndex, setSrcIndex] = useState(0);
  const [allFailed, setAllFailed] = useState(false);
  const tc = hashColor(ticker);
  const fontSize = size <= 32 ? 9 : 11;
  const urls = logoUrls(ticker);
  const base = baseTicker(ticker);

  const handleError = () => {
    const next = srcIndex + 1;
    if (next < urls.length) {
      setSrcIndex(next);
    } else {
      setAllFailed(true);
    }
  };

  if (allFailed) {
    return (
      <div
        className="rounded-full flex items-center justify-center font-bold shrink-0"
        style={{
          width: size,
          height: size,
          background: tc.bg,
          boxShadow: `0 0 0 1.5px ${tc.ring}`,
          color: tc.text,
          fontSize,
          opacity: muted ? 0.6 : 1,
        }}
      >
        {base.slice(0, 4)}
      </div>
    );
  }

  return (
    <div
      className="rounded-full overflow-hidden shrink-0 flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: tc.bg,
        boxShadow: `0 0 0 1.5px ${tc.ring}`,
        opacity: muted ? 0.6 : 1,
      }}
    >
      <img
        src={urls[srcIndex]}
        alt={ticker}
        width={size}
        height={size}
        className="w-full h-full object-cover"
        onError={handleError}
        loading="lazy"
      />
    </div>
  );
}
