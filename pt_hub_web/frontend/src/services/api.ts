import type {
  TraderStatus,
  PortfolioItem,
  Trade,
  Candle,
  ChartOverlays,
  TrainingStatus,
  NeuralSignal,
  ProcessStatus,
  Settings,
} from './types';

const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || 'API request failed');
  }

  return response.json();
}

// Account endpoints
export const accountApi = {
  getStatus: () => fetchJson<TraderStatus>('/account/status'),

  getPortfolio: () =>
    fetchJson<{ portfolio: PortfolioItem[]; timestamp: number }>('/account/portfolio'),

  getPnl: () => fetchJson<{ total_realized_profit_aud: number }>('/account/pnl'),

  getHistory: (limit = 500) =>
    fetchJson<{ history: { ts: number; total_account_value: number }[] }>(
      `/account/history?limit=${limit}`
    ),

  getTrades: (limit = 250) => fetchJson<{ trades: Trade[] }>(`/account/trades?limit=${limit}`),

  getHoldingHistory: (asset: string, interval = 240) =>
    fetchJson<{
      asset: string;
      current_balance: number;
      data: { time: number; balance: number; price: number; value: number }[];
      trades: { time: number; side: string; price: number; qty: number }[];
    }>(`/account/holding-history/${asset}?interval=${interval}`),
};

// Trading endpoints
export const tradingApi = {
  getProcesses: () => fetchJson<ProcessStatus>('/trading/processes'),

  startAll: () =>
    fetchJson<{ status: string; message: string }>('/trading/start-all', { method: 'POST' }),

  stopAll: () => fetchJson<{ status: string }>('/trading/stop-all', { method: 'POST' }),

  startNeural: () => fetchJson<{ status: string }>('/trading/start-neural', { method: 'POST' }),

  stopNeural: () => fetchJson<{ status: string }>('/trading/stop-neural', { method: 'POST' }),

  startTrader: () => fetchJson<{ status: string }>('/trading/start-trader', { method: 'POST' }),

  stopTrader: () => fetchJson<{ status: string }>('/trading/stop-trader', { method: 'POST' }),

  getPositions: () => fetchJson<{ positions: Record<string, unknown> }>('/trading/positions'),

  getCoins: () => fetchJson<{ coins: string[]; available: string[] }>('/trading/coins'),

  setCoins: (coins: string[]) =>
    fetchJson<{ coins: string[] }>('/trading/coins', {
      method: 'POST',
      body: JSON.stringify({ coins }),
    }),

  getLogs: (source: string, limit = 100, coin?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (coin) params.set('coin', coin);
    return fetchJson<{ logs: string[] }>(`/trading/logs/${source}?${params}`);
  },
};

// Training endpoints
export const trainingApi = {
  getStatus: () => fetchJson<{ status: TrainingStatus }>('/training/status'),

  start: (coin: string) =>
    fetchJson<{ status: string; coin: string; process_status?: ProcessStatus }>(`/training/start/${coin}`, { method: 'POST' }),

  stop: (coin: string) =>
    fetchJson<{ status: string; coin: string; process_status?: ProcessStatus }>(`/training/stop/${coin}`, { method: 'POST' }),

  clear: () => fetchJson<{ status: string }>('/training/clear', { method: 'POST' }),

  getNeuralSignals: () => fetchJson<{ signals: Record<string, NeuralSignal> }>('/training/neural-signals'),

  getCoinSignals: (coin: string) => fetchJson<NeuralSignal>(`/training/neural-signals/${coin}`),

  getLogs: (coin: string, limit = 100) =>
    fetchJson<{ logs: string[]; coin: string }>(`/training/logs/${coin}?limit=${limit}`),
};

// Charts endpoints
export const chartsApi = {
  getCandles: (coin: string, timeframe = '1hour', limit = 120) =>
    fetchJson<{ candles: Candle[]; pair: string; timeframe: string }>(
      `/charts/candles/${coin}?timeframe=${timeframe}&limit=${limit}`
    ),

  getNeuralLevels: (coin: string) =>
    fetchJson<{ long: number[]; short: number[] }>(`/charts/neural-levels/${coin}`),

  getAccountValue: (limit = 500, holding?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (holding) params.set('holding', holding);
    return fetchJson<{
      data: { time: number; value: number }[];
      trades: {
        time: number;
        side: string;
        tag: string;
        symbol: string;
        price: number;
        qty: number;
        pnl: number;
      }[];
    }>(`/charts/account-value?${params}`);
  },

  getHoldingsList: () => fetchJson<{ holdings: string[] }>('/charts/holdings-list'),

  getOverlays: (coin: string) => fetchJson<ChartOverlays>(`/charts/overlays/${coin}`),
};

// Settings endpoints
export const settingsApi = {
  get: () => fetchJson<Settings>('/settings'),
};

// Health check
export const healthApi = {
  check: () => fetchJson<{ status: string; project_dir: string }>('/health'),
};
