import { create } from 'zustand';
import type { Settings } from '../services/types';

type ChartMode = string;
type TabId = 'training' | 'predictions' | 'charts' | 'analysis' | 'portfolio';

const DEFAULT_TAB_ORDER: TabId[] = ['training', 'predictions', 'charts', 'analysis', 'portfolio'];

interface SettingsState {
  settings: Settings | null;
  activeTab: TabId;
  chartTicker: ChartMode;
  chartTimeframe: string;
  tickerOrder: string[];
  tabOrder: TabId[];

  setSettings: (settings: Settings) => void;
  setActiveTab: (tab: TabId) => void;
  setChartTicker: (ticker: ChartMode) => void;
  setChartTimeframe: (timeframe: string) => void;
  reorderTickers: (fromIndex: number, toIndex: number) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

function loadTabOrder(): TabId[] {
  try {
    const saved = localStorage.getItem('tabOrder');
    if (saved) {
      const parsed = JSON.parse(saved) as TabId[];
      // Ensure all tabs are present
      const valid = parsed.filter((t) => DEFAULT_TAB_ORDER.includes(t));
      for (const t of DEFAULT_TAB_ORDER) {
        if (!valid.includes(t)) valid.push(t);
      }
      return valid;
    }
  } catch {
    // ignore
  }
  return [...DEFAULT_TAB_ORDER];
}

function loadTickerOrder(): string[] {
  try {
    const saved = localStorage.getItem('tickerOrder');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function applyTickerOrder(tickers: string[], savedOrder: string[]): string[] {
  if (savedOrder.length === 0) return tickers;
  const ordered: string[] = [];
  for (const t of savedOrder) {
    if (tickers.includes(t)) ordered.push(t);
  }
  for (const t of tickers) {
    if (!ordered.includes(t)) ordered.push(t);
  }
  return ordered;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  activeTab: 'portfolio',
  chartTicker: '',
  chartTimeframe: '1day',
  tickerOrder: [],
  tabOrder: loadTabOrder(),

  setSettings: (settings) => {
    const saved = loadTickerOrder();
    const ordered = applyTickerOrder(settings.tickers, saved);
    set({
      settings,
      tickerOrder: ordered,
      chartTimeframe: settings.default_timeframe,
      chartTicker: ordered[0] || '',
    });
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  setChartTicker: (ticker) => set({ chartTicker: ticker }),

  setChartTimeframe: (timeframe) => set({ chartTimeframe: timeframe }),

  reorderTickers: (fromIndex, toIndex) =>
    set((state) => {
      const arr = [...state.tickerOrder];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      localStorage.setItem('tickerOrder', JSON.stringify(arr));
      return { tickerOrder: arr };
    }),

  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      const arr = [...state.tabOrder];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      localStorage.setItem('tabOrder', JSON.stringify(arr));
      return { tabOrder: arr };
    }),
}));

export const selectTickers = (state: SettingsState) => state.tickerOrder;
export const selectTimeframes = (state: SettingsState) => state.settings?.timeframes ?? [];
