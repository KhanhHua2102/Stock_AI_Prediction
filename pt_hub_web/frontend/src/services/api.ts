import type {
  AnalysisReport,
  Candle,
  ChartOverlays,
  TrainingStatus,
  NeuralSignal,
  ProcessStatus,
  PortfolioOptimizationResult,
  RiskReturnResult,
  RebalanceResult,
  CorrelationResult,
  Holding,
  Settings,
  Portfolio,
  Transaction,
  ImportPreviewResult,
  ImportConfirmResult,
  PortfolioSummary,
  ValueHistoryPoint,
  PerformanceData,
  DividendDataPoint,
  SectorAllocation,
  MonthlyReturn,
  DrawdownPoint,
  StockBreakdown,
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

// Analysis endpoints
export const analysisApi = {
  run: (ticker: string) =>
    fetchJson<{ status: string; ticker: string }>(`/analysis/run/${ticker}`, { method: 'POST' }),

  getStatus: () =>
    fetchJson<{ running: boolean; ticker: string | null }>('/analysis/status'),

  getReports: (ticker: string, limit = 20, offset = 0) =>
    fetchJson<{ reports: AnalysisReport[]; total: number }>(
      `/analysis/reports/${ticker}?limit=${limit}&offset=${offset}`
    ),

  getLatest: (ticker: string) =>
    fetchJson<{ report: AnalysisReport | null }>(`/analysis/reports/${ticker}/latest`),

  getReport: (id: number) =>
    fetchJson<AnalysisReport>(`/analysis/report/${id}`),
};

// Portfolio endpoints
export const portfolioApi = {
  optimize: (tickers: string[], strategy = 'mean-variance') =>
    fetchJson<PortfolioOptimizationResult>('/portfolio/optimize', {
      method: 'POST',
      body: JSON.stringify({ tickers, strategy }),
    }),

  riskReturn: (tickers: string[], weights: number[]) =>
    fetchJson<RiskReturnResult>('/portfolio/risk-return', {
      method: 'POST',
      body: JSON.stringify({ tickers, weights }),
    }),

  rebalance: (
    holdings: Holding[],
    targetWeights: { ticker: string; weight: number }[],
    strategy: 'rebalance' | 'buy-only',
    additionalCapital = 0,
  ) =>
    fetchJson<RebalanceResult>('/portfolio/rebalance', {
      method: 'POST',
      body: JSON.stringify({
        holdings,
        target_weights: targetWeights,
        strategy,
        additional_capital: additionalCapital,
      }),
    }),

  correlation: (tickers: string[]) =>
    fetchJson<CorrelationResult>('/portfolio/correlation', {
      method: 'POST',
      body: JSON.stringify({ tickers }),
    }),

  // Portfolio Management
  createPortfolio: (name: string, currency = 'AUD', benchmark = '^AXJO') =>
    fetchJson<{ id: number; name: string }>('/portfolio/portfolios', {
      method: 'POST',
      body: JSON.stringify({ name, currency, benchmark }),
    }),

  listPortfolios: () =>
    fetchJson<{ portfolios: Portfolio[] }>('/portfolio/portfolios'),

  getPortfolio: (id: number) =>
    fetchJson<Portfolio>(`/portfolio/portfolios/${id}`),

  updatePortfolio: (id: number, data: { name?: string; currency?: string; benchmark?: string }) =>
    fetchJson<{ status: string }>(`/portfolio/portfolios/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deletePortfolio: (id: number) =>
    fetchJson<{ status: string }>(`/portfolio/portfolios/${id}`, { method: 'DELETE' }),

  // Transactions
  addTransaction: (portfolioId: number, txn: {
    ticker: string; type: string; date: string; quantity: number; price?: number; fees?: number; notes?: string;
  }) =>
    fetchJson<{ id: number }>(`/portfolio/portfolios/${portfolioId}/transactions`, {
      method: 'POST',
      body: JSON.stringify(txn),
    }),

  listTransactions: (portfolioId: number, ticker?: string, limit = 100, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (ticker) params.set('ticker', ticker);
    return fetchJson<{ transactions: Transaction[]; total: number }>(
      `/portfolio/portfolios/${portfolioId}/transactions?${params}`
    );
  },

  deleteTransaction: (portfolioId: number, txnId: number) =>
    fetchJson<{ status: string }>(`/portfolio/portfolios/${portfolioId}/transactions/${txnId}`, {
      method: 'DELETE',
    }),

  batchDeleteTransactions: (portfolioId: number, ids: number[]) =>
    fetchJson<{ status: string; count: number }>(
      `/portfolio/portfolios/${portfolioId}/transactions/batch-delete`,
      { method: 'POST', body: JSON.stringify({ ids }) },
    ),

  rebuildSnapshots: (portfolioId: number) =>
    fetchJson<{ status: string }>(`/portfolio/portfolios/${portfolioId}/rebuild-snapshots`, {
      method: 'POST',
    }),

  // Import
  importPreview: async (portfolioId: number, file: File): Promise<ImportPreviewResult> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/portfolio/portfolios/${portfolioId}/import/preview`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Import preview failed');
    }
    return response.json();
  },

  importConfirm: (
    portfolioId: number,
    fileId: string,
    mapping: Record<string, string>,
    currency?: string,
    options?: { force?: boolean; skip_duplicates?: boolean },
  ) =>
    fetchJson<ImportConfirmResult>(
      `/portfolio/portfolios/${portfolioId}/import/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({
          file_id: fileId,
          mapping,
          currency: currency || undefined,
          ...options,
        }),
      }
    ),

  // Dashboard data
  getHoldings: (portfolioId: number) =>
    fetchJson<PortfolioSummary>(`/portfolio/portfolios/${portfolioId}/holdings`),

  getValueHistory: (portfolioId: number) =>
    fetchJson<{ data: ValueHistoryPoint[] }>(`/portfolio/portfolios/${portfolioId}/value-history`),

  getPerformance: (portfolioId: number) =>
    fetchJson<PerformanceData>(`/portfolio/portfolios/${portfolioId}/performance`),

  getDividends: (portfolioId: number, groupBy: 'month' | 'year' = 'month') =>
    fetchJson<{ data: DividendDataPoint[]; group_by: string }>(
      `/portfolio/portfolios/${portfolioId}/dividends?group_by=${groupBy}`
    ),

  getAllocation: (portfolioId: number) =>
    fetchJson<{ data: SectorAllocation[] }>(`/portfolio/portfolios/${portfolioId}/allocation`),

  getReturns: (portfolioId: number) =>
    fetchJson<{ data: MonthlyReturn[] }>(`/portfolio/portfolios/${portfolioId}/returns`),

  getDrawdown: (portfolioId: number) =>
    fetchJson<{ data: DrawdownPoint[] }>(`/portfolio/portfolios/${portfolioId}/drawdown`),

  getStockBreakdown: (portfolioId: number) =>
    fetchJson<{ data: StockBreakdown[]; closed: StockBreakdown[] }>(`/portfolio/portfolios/${portfolioId}/stock-breakdown`),
};

// Health check
export const healthApi = {
  check: () => fetchJson<{ status: string; project_dir: string }>('/health'),
};
