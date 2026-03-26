import { create } from 'zustand';
import { analysisApi } from '../services/api';
import type { AnalysisReport, PortfolioHoldingDetail } from '../services/types';

// Broker exports use ":AU" but analysis engine uses ".AX"
const EXCHANGE_MAP: Record<string, string> = { ':AU': '.AX', ':US': '', ':NZ': '.NZ', ':HK': '.HK', ':LN': '.L' };

function toAnalysisTicker(ticker: string): string {
  for (const [suffix, replacement] of Object.entries(EXCHANGE_MAP)) {
    if (ticker.endsWith(suffix)) return ticker.slice(0, -suffix.length) + replacement;
  }
  return ticker;
}

export interface PortfolioAnalysisResult {
  ticker: string;
  decision: 'BUY' | 'HOLD' | 'SELL';
  score: number;
  currentWeight: number;
  currentPrice: number;
  targetPrice: number;
  upside: number;
  conclusion: string;
  reportAge: string;
}

export interface AllocationRecommendation {
  ticker: string;
  currentWeight: number;
  targetWeight: number;
  delta: number;
  action: 'INCREASE' | 'DECREASE' | 'MAINTAIN';
  decision: 'BUY' | 'HOLD' | 'SELL';
  score: number;
}

interface PortfolioAnalysisState {
  // Queue — uses analysis tickers (e.g. BGBL.AX)
  totalTickers: number;
  queue: string[];
  completed: string[];
  currentTicker: string | null;
  isRunning: boolean;
  cancelled: boolean;
  errors: string[];

  // Mapping: analysis ticker → portfolio ticker (e.g. BGBL.AX → BGBL:AU)
  tickerMap: Record<string, string>;

  // Results — keyed by portfolio ticker
  reports: Record<string, AnalysisReport>;
  results: PortfolioAnalysisResult[];
  allocations: AllocationRecommendation[];
  healthScore: number | null;

  // Actions
  startAnalysis: (holdings: PortfolioHoldingDetail[], maxAgeHours?: number) => Promise<void>;
  onTickerComplete: (ticker: string, report: AnalysisReport) => void;
  cancel: () => void;
  reset: () => void;
}

function formatAge(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function computeAllocations(results: PortfolioAnalysisResult[]): AllocationRecommendation[] {
  if (results.length === 0) return [];

  const rawWeights = results.map(r => {
    let multiplier: number;
    const s = r.score / 100;
    if (r.decision === 'BUY') {
      multiplier = 1.0 + s * 0.5; // 1.0x to 1.5x
    } else if (r.decision === 'HOLD') {
      multiplier = 0.8 + s * 0.4; // 0.8x to 1.2x
    } else {
      multiplier = 0.5 - (1 - s) * 0.3; // 0.2x to 0.5x
    }
    return {
      ticker: r.ticker,
      currentWeight: r.currentWeight,
      decision: r.decision,
      score: r.score,
      rawWeight: Math.max(r.currentWeight * multiplier, 0.5), // min 0.5% raw
    };
  });

  const total = rawWeights.reduce((sum, w) => sum + w.rawWeight, 0);

  return rawWeights.map(w => {
    const targetWeight = Math.round((w.rawWeight / total) * 1000) / 10;
    const delta = Math.round((targetWeight - w.currentWeight) * 10) / 10;
    return {
      ticker: w.ticker,
      currentWeight: w.currentWeight,
      targetWeight,
      delta,
      action: delta > 1 ? 'INCREASE' as const : delta < -1 ? 'DECREASE' as const : 'MAINTAIN' as const,
      decision: w.decision,
      score: w.score,
    };
  });
}

function buildResults(
  holdings: PortfolioHoldingDetail[],
  reports: Record<string, AnalysisReport>,
): PortfolioAnalysisResult[] {
  return holdings
    .filter(h => h.quantity > 0)
    .map(h => {
      const r = reports[h.ticker];
      if (r) {
        const target = r.price_levels?.target || r.current_price;
        const upside = r.current_price > 0 ? ((target - r.current_price) / r.current_price) * 100 : 0;
        return {
          ticker: h.ticker,
          decision: r.decision,
          score: r.score,
          currentWeight: h.weight_pct,
          currentPrice: h.current_price,
          targetPrice: target,
          upside: Math.round(upside * 10) / 10,
          conclusion: r.conclusion,
          reportAge: formatAge(r.created_at),
        };
      }
      // No report available — default to HOLD with neutral score
      return {
        ticker: h.ticker,
        decision: 'HOLD' as const,
        score: 50,
        currentWeight: h.weight_pct,
        currentPrice: h.current_price,
        targetPrice: h.current_price,
        upside: 0,
        conclusion: 'Not analyzed — ticker not in settings or analysis failed.',
        reportAge: 'N/A',
      };
    });
}

export const usePortfolioAnalysisStore = create<PortfolioAnalysisState>((set, get) => ({
  totalTickers: 0,
  queue: [],
  completed: [],
  currentTicker: null,
  isRunning: false,
  cancelled: false,
  errors: [],
  tickerMap: {},
  reports: {},
  results: [],
  allocations: [],
  healthScore: null,

  startAnalysis: async (holdings, maxAgeHours = 24) => {
    const activeHoldings = holdings.filter(h => h.quantity > 0);
    if (activeHoldings.length === 0) return;

    // Build mapping: analysis ticker (BGBL.AX) → portfolio ticker (BGBL:AU)
    const portfolioTickers = activeHoldings.map(h => h.ticker);
    const analysisTickers = portfolioTickers.map(toAnalysisTicker);
    const tickerMap: Record<string, string> = {};
    for (let i = 0; i < analysisTickers.length; i++) {
      tickerMap[analysisTickers[i]] = portfolioTickers[i];
    }

    set({
      totalTickers: analysisTickers.length,
      queue: [],
      completed: [],
      currentTicker: null,
      isRunning: true,
      cancelled: false,
      errors: [],
      tickerMap,
      reports: {},
      results: [],
      allocations: [],
      healthScore: null,
    });

    // Check which tickers have fresh reports (use analysis ticker for API)
    const freshReports: Record<string, AnalysisReport> = {};
    const needAnalysis: string[] = [];
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;

    for (const aTicker of analysisTickers) {
      const pTicker = tickerMap[aTicker];
      try {
        const resp = await analysisApi.getLatest(aTicker);
        const report = resp.report;
        if (report && new Date(report.created_at).getTime() > cutoff) {
          freshReports[pTicker] = report;
        } else {
          needAnalysis.push(aTicker);
        }
      } catch {
        needAnalysis.push(aTicker);
      }
    }

    set(s => ({
      reports: { ...s.reports, ...freshReports },
      completed: Object.keys(freshReports),
      queue: needAnalysis,
    }));

    if (needAnalysis.length === 0) {
      const results = buildResults(activeHoldings, freshReports);
      const allocations = computeAllocations(results);
      const healthScore = results.reduce((sum, r) => sum + r.score * (r.currentWeight / 100), 0);
      set({ results, allocations, healthScore: Math.round(healthScore), isRunning: false });
      return;
    }

    // Start first ticker
    const first = needAnalysis[0];
    set({ currentTicker: first, queue: needAnalysis.slice(1) });
    try {
      await analysisApi.run(first);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      set(s => ({
        errors: [...s.errors, `${tickerMap[first] || first}: ${msg}`],
      }));
      get().onTickerComplete(first, null as unknown as AnalysisReport);
    }

    // Fallback polling in case WebSocket misses the event
    const pollInterval = setInterval(async () => {
      const state = get();
      if (!state.isRunning || !state.currentTicker) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const status = await analysisApi.getStatus();
        if (!status.running && state.currentTicker) {
          const resp = await analysisApi.getLatest(state.currentTicker);
          if (resp.report) {
            get().onTickerComplete(state.currentTicker, resp.report);
          }
        }
      } catch { /* ignore */ }
    }, 5000);

    const unsubscribe = usePortfolioAnalysisStore.subscribe((state) => {
      if (!state.isRunning) {
        clearInterval(pollInterval);
        unsubscribe();
      }
    });
  },

  onTickerComplete: (analysisTicker, report) => {
    const state = get();
    if (!state.isRunning) return;

    // Map analysis ticker back to portfolio ticker
    const pTicker = state.tickerMap[analysisTicker] || analysisTicker;

    const newReports = { ...state.reports };
    if (report) {
      newReports[pTicker] = report;
    }

    const newCompleted = state.completed.includes(pTicker)
      ? state.completed
      : [...state.completed, pTicker];
    const remaining = state.queue.filter(t => t !== analysisTicker);

    set({
      reports: newReports,
      completed: newCompleted,
      queue: remaining,
      currentTicker: null,
    });

    if (state.cancelled || remaining.length === 0) {
      import('./portfolioStore').then(({ usePortfolioStore }) => {
        const summary = usePortfolioStore.getState().summary;
        if (summary) {
          const results = buildResults(summary.holdings, get().reports);
          const allocations = computeAllocations(results);
          const healthScore = results.reduce((sum, r) => sum + r.score * (r.currentWeight / 100), 0);
          set({ results, allocations, healthScore: Math.round(healthScore), isRunning: false, currentTicker: null });
        } else {
          set({ isRunning: false, currentTicker: null });
        }
      });
      return;
    }

    // Start next analysis ticker (delay to let backend reset its running flag)
    const next = remaining[0];
    set({ currentTicker: next, queue: remaining.slice(1) });
    const startNext = async () => {
      // Wait for backend to clear its _running flag after the completion callback
      await new Promise(r => setTimeout(r, 1000));
      // Poll until backend is ready
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const status = await analysisApi.getStatus();
          if (!status.running) break;
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 1000));
      }
      try {
        await analysisApi.run(next);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed';
        const nextP = state.tickerMap[next] || next;
        set(s => ({ errors: [...s.errors, `${nextP}: ${msg}`] }));
        get().onTickerComplete(next, null as unknown as AnalysisReport);
      }
    };
    startNext();
  },

  cancel: () => {
    set({ cancelled: true });
  },

  reset: () => {
    set({
      totalTickers: 0,
      queue: [],
      completed: [],
      currentTicker: null,
      isRunning: false,
      cancelled: false,
      errors: [],
      tickerMap: {},
      reports: {},
      results: [],
      allocations: [],
      healthScore: null,
    });
  },
}));
