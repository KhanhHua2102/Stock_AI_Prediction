import { create } from 'zustand';
import type { Settings } from '../services/types';

type ChartMode = string;

interface SettingsState {
  settings: Settings | null;
  activeTab: 'trade' | 'training' | 'predictions' | 'charts';
  chartTicker: ChartMode;
  chartTimeframe: string;

  setSettings: (settings: Settings) => void;
  setActiveTab: (tab: 'trade' | 'training' | 'predictions' | 'charts') => void;
  setChartTicker: (ticker: ChartMode) => void;
  setChartTimeframe: (timeframe: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  activeTab: 'trade',
  chartTicker: '',
  chartTimeframe: '1day',

  setSettings: (settings) =>
    set({
      settings,
      chartTimeframe: settings.default_timeframe,
      chartTicker: settings.tickers[0] || '',
    }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setChartTicker: (ticker) => set({ chartTicker: ticker }),

  setChartTimeframe: (timeframe) => set({ chartTimeframe: timeframe }),
}));

export const selectTickers = (state: SettingsState) => state.settings?.tickers ?? [];
export const selectTimeframes = (state: SettingsState) => state.settings?.timeframes ?? [];
