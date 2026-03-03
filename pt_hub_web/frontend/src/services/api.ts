import type {
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

// Runner endpoints (process management)
export const tradingApi = {
  getProcesses: () => fetchJson<ProcessStatus>('/trading/processes'),

  startAll: () =>
    fetchJson<{ status: string; message: string }>('/trading/start-all', { method: 'POST' }),

  stopAll: () => fetchJson<{ status: string }>('/trading/stop-all', { method: 'POST' }),

  getTickers: () => fetchJson<{ tickers: string[]; available: string[] }>('/trading/tickers'),

  setTickers: (tickers: string[]) =>
    fetchJson<{ tickers: string[] }>('/trading/tickers', {
      method: 'POST',
      body: JSON.stringify({ tickers }),
    }),

  getLogs: (source: string, limit = 100, ticker?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (ticker) params.set('ticker', ticker);
    return fetchJson<{ logs: string[] }>(`/trading/logs/${source}?${params}`);
  },
};

// Training endpoints
export const trainingApi = {
  getStatus: () => fetchJson<{ status: TrainingStatus }>('/training/status'),

  start: (ticker: string) =>
    fetchJson<{ status: string; ticker: string; process_status?: ProcessStatus }>(`/training/start/${ticker}`, { method: 'POST' }),

  stop: (ticker: string) =>
    fetchJson<{ status: string; ticker: string; process_status?: ProcessStatus }>(`/training/stop/${ticker}`, { method: 'POST' }),

  clear: () => fetchJson<{ status: string }>('/training/clear', { method: 'POST' }),

  getNeuralSignals: () => fetchJson<{ signals: Record<string, NeuralSignal> }>('/training/neural-signals'),

  getTickerSignals: (ticker: string) => fetchJson<NeuralSignal>(`/training/neural-signals/${ticker}`),

  getLogs: (ticker: string, limit = 100) =>
    fetchJson<{ logs: string[]; ticker: string }>(`/training/logs/${ticker}?limit=${limit}`),
};

// Charts endpoints
export const chartsApi = {
  getCandles: (ticker: string, timeframe = '1day', limit = 120) =>
    fetchJson<{ candles: Candle[]; pair: string; timeframe: string }>(
      `/charts/candles/${ticker}?timeframe=${timeframe}&limit=${limit}`
    ),

  getNeuralLevels: (ticker: string) =>
    fetchJson<{ long: number[]; short: number[] }>(`/charts/neural-levels/${ticker}`),

  getOverlays: (ticker: string) => fetchJson<ChartOverlays>(`/charts/overlays/${ticker}`),
};

// Predictions endpoints
export const predictionsApi = {
  get: (ticker: string) =>
    fetchJson<{
      signals: Record<string, { long: number; short: number; high_bound: number; low_bound: number }>;
      current_price: number;
    }>(`/predictions/${ticker}`),
};

// Settings endpoints
export const settingsApi = {
  get: () => fetchJson<Settings>('/settings'),

  searchTicker: (q: string) =>
    fetchJson<{ results: { symbol: string; name: string; exchange: string }[] }>(
      `/settings/search-ticker?q=${encodeURIComponent(q)}`
    ),

  updateTickers: (tickers: string[]) =>
    fetchJson<Settings>('/settings/tickers', {
      method: 'POST',
      body: JSON.stringify({ tickers }),
    }),
};

// Health check
export const healthApi = {
  check: () => fetchJson<{ status: string; project_dir: string }>('/health'),
};
