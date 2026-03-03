import { create } from 'zustand';
import type { Settings } from '../services/types';

// Chart mode types: 'TOTAL' for combined AUD value, 'HOLDING:XXX' for individual holding, or coin symbol for candlestick
type ChartMode = string;

interface SettingsState {
  settings: Settings | null;
  activeTab: 'trade' | 'training' | 'charts' | 'account';
  chartCoin: ChartMode;
  chartTimeframe: string;
  availableHoldings: string[];
  accountChartMode: string; // 'TOTAL' or holding symbol like 'BTC'

  // Actions
  setSettings: (settings: Settings) => void;
  setActiveTab: (tab: 'trade' | 'training' | 'charts' | 'account') => void;
  setChartCoin: (coin: ChartMode) => void;
  setChartTimeframe: (timeframe: string) => void;
  setAvailableHoldings: (holdings: string[]) => void;
  setAccountChartMode: (mode: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  // Initial state
  settings: null,
  activeTab: 'trade',
  chartCoin: '',
  chartTimeframe: '1hour',
  availableHoldings: [],
  accountChartMode: 'TOTAL',

  // Actions
  setSettings: (settings) =>
    set({
      settings,
      chartTimeframe: settings.default_timeframe,
      chartCoin: settings.coins[0] || '',
    }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setChartCoin: (coin) => set({ chartCoin: coin }),

  setChartTimeframe: (timeframe) => set({ chartTimeframe: timeframe }),

  setAvailableHoldings: (holdings) => set({ availableHoldings: holdings }),

  setAccountChartMode: (mode) => set({ accountChartMode: mode }),
}));

// Selectors
export const selectCoins = (state: SettingsState) => state.settings?.coins ?? [];
export const selectTimeframes = (state: SettingsState) => state.settings?.timeframes ?? [];
export const selectKrakenConfigured = (state: SettingsState) => state.settings?.kraken_configured ?? false;
