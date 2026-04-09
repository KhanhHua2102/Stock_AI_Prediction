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
  UpcomingEvent,
  InvestmentProperty,
  PropertyValuation,
  SuburbMetric,
  SuburbSummary,
  FavoriteSuburb,
  PropertyDashboardSummary,
  AnalysisStrategy,
  MarketReview,
  BacktestResult,
  BacktestSummary,
  QuickVerification,
  Expense,
  ExpenseCategory,
  Receipt,
  ReceiptExtraction,
  ExpenseStatistics,
  TaxSummary,
  TaxRule,
  TaxAnalysisResult,
  AgentInfo,
  MultiAgentRunRequest,
  MultiAgentReport,
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
      signals: Record<string, { long: number; short: number; high_bound: number; low_bound: number; trained?: boolean }>;
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

  exportBackup: async () => {
    const response = await fetch(`${API_BASE}/settings/backup`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Backup export failed');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?(.+?)"?$/);
    const filename = match?.[1] || 'sai_backup.zip';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  importBackup: async (file: File): Promise<{ status: string; restored: string[]; message: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/settings/restore`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Backup import failed');
    }
    return response.json();
  },
};

// Analysis endpoints
export const analysisApi = {
  run: (ticker: string, strategy = 'default') =>
    fetchJson<{ status: string; ticker: string }>(
      `/analysis/run/${ticker}?strategy=${encodeURIComponent(strategy)}`,
      { method: 'POST' },
    ),

  getStrategies: () =>
    fetchJson<{ strategies: AnalysisStrategy[] }>('/analysis/strategies'),

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

  cancel: () =>
    fetchJson<{ status: string; ticker: string | null }>('/analysis/cancel', { method: 'POST' }),
};

// Market endpoints
export const marketApi = {
  getReview: () =>
    fetchJson<{ review: MarketReview | null }>('/market/review/latest'),

  generateReview: () =>
    fetchJson<{ review: MarketReview }>('/market/review', { method: 'GET' }),

  forceGenerate: () =>
    fetchJson<{ review: MarketReview }>('/market/review/generate', { method: 'POST' }),
};

// Backtest endpoints
export const backtestApi = {
  run: (ticker?: string, forwardDays = 10) =>
    fetchJson<{ status: string; summary: BacktestSummary }>('/backtest/run', {
      method: 'POST',
      body: JSON.stringify({ ticker: ticker || null, forward_days: forwardDays }),
    }),

  getResults: (ticker?: string, limit = 50, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (ticker) params.set('ticker', ticker);
    return fetchJson<{ results: BacktestResult[]; total: number }>(`/backtest/results?${params}`);
  },

  getSummary: (ticker?: string) => {
    const params = ticker ? `?ticker=${encodeURIComponent(ticker)}` : '';
    return fetchJson<{ summary: BacktestSummary }>(`/backtest/summary${params}`);
  },

  getResultForReport: (reportId: number) =>
    fetchJson<{ result: BacktestResult | null }>(`/backtest/results/${reportId}`),

  verify: (reportId: number) =>
    fetchJson<{ result: QuickVerification | null }>(`/backtest/verify/${reportId}`),
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

  getUpcomingEvents: (portfolioId: number) =>
    fetchJson<{ data: UpcomingEvent[] }>(`/portfolio/portfolios/${portfolioId}/upcoming-events`),
};

// Property endpoints
export const propertyApi = {
  createProperty: (data: Partial<InvestmentProperty>) =>
    fetchJson<{ id: number; name: string }>('/property/properties', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listProperties: () =>
    fetchJson<{ properties: InvestmentProperty[] }>('/property/properties'),

  getProperty: (id: number) =>
    fetchJson<InvestmentProperty>(`/property/properties/${id}`),

  updateProperty: (id: number, data: Partial<InvestmentProperty>) =>
    fetchJson<{ status: string }>(`/property/properties/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  saveProjectionParams: (id: number, params: Record<string, number>) =>
    fetchJson<{ status: string }>(`/property/properties/${id}/projection-params`, {
      method: 'PUT',
      body: JSON.stringify(params),
    }),

  deleteProperty: (id: number) =>
    fetchJson<{ status: string }>(`/property/properties/${id}`, { method: 'DELETE' }),

  // Valuations
  addValuation: (propertyId: number, data: { date: string; estimated_value: number; source?: string; notes?: string }) =>
    fetchJson<{ id: number }>(`/property/properties/${propertyId}/valuations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getValuations: (propertyId: number) =>
    fetchJson<{ valuations: PropertyValuation[] }>(`/property/properties/${propertyId}/valuations`),

  deleteValuation: (id: number) =>
    fetchJson<{ status: string; property_id: number }>(`/property/valuations/${id}`, { method: 'DELETE' }),

  fetchValuationHistory: (propertyId: number) =>
    fetchJson<{ added: number; total_fetched: number }>(`/property/properties/${propertyId}/valuations/fetch`, {
      method: 'POST',
    }),

  // Dashboard
  getDashboard: () =>
    fetchJson<PropertyDashboardSummary>('/property/dashboard'),

  // Suburb metrics
  addSuburbMetric: (data: {
    suburb: string; state: string; postcode: string;
    date: string; metric_type: string; value: number; source?: string;
  }) =>
    fetchJson<{ status: string }>('/property/suburb-metrics', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSuburbMetrics: (suburb: string, state: string, metricType?: string) => {
    const params = new URLSearchParams();
    if (metricType) params.set('metric_type', metricType);
    return fetchJson<{ metrics: SuburbMetric[] }>(
      `/property/suburb-metrics/${encodeURIComponent(suburb)}/${state}?${params}`
    );
  },

  getSuburbSummary: (suburb: string, state: string) =>
    fetchJson<SuburbSummary>(
      `/property/suburb-metrics/${encodeURIComponent(suburb)}/${state}/summary`
    ),

  refreshSuburbData: (suburb: string, state: string, postcode: string) =>
    fetchJson<{
      suburb: string; state: string; sources_tried: string[];
      metrics_fetched: number; metrics_stored: number; errors: string[];
    }>(`/property/suburb-metrics/${encodeURIComponent(suburb)}/${state}/refresh?postcode=${postcode}`, {
      method: 'POST',
    }),

  // Favorite suburbs
  getFavoriteSuburbs: () =>
    fetchJson<{ favorites: FavoriteSuburb[] }>('/property/favorite-suburbs'),

  addFavoriteSuburb: (suburb: string, state: string, postcode: string) =>
    fetchJson<{ id: number; suburb: string; state: string }>('/property/favorite-suburbs', {
      method: 'POST',
      body: JSON.stringify({ suburb, state, postcode }),
    }),

  removeFavoriteSuburb: (suburb: string, state: string) =>
    fetchJson<{ status: string }>(
      `/property/favorite-suburbs/${encodeURIComponent(suburb)}/${state}`,
      { method: 'DELETE' },
    ),
};

// Expense endpoints
export const expensesApi = {
  list: (params: {
    tax_year?: string; category_id?: number; date_from?: string; date_to?: string;
    search?: string; is_income?: boolean; limit?: number; offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.tax_year) qs.set('tax_year', params.tax_year);
    if (params.category_id != null) qs.set('category_id', String(params.category_id));
    if (params.date_from) qs.set('date_from', params.date_from);
    if (params.date_to) qs.set('date_to', params.date_to);
    if (params.search) qs.set('search', params.search);
    if (params.is_income != null) qs.set('is_income', String(params.is_income));
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return fetchJson<{ expenses: Expense[]; total: number }>(`/expenses${q ? `?${q}` : ''}`);
  },

  get: (id: number) => fetchJson<Expense>(`/expenses/${id}`),

  checkDuplicates: (date: string, amountCents: number, gstCents: number = 0) =>
    fetchJson<{ duplicates: Expense[] }>(
      `/expenses/check-duplicates?date=${encodeURIComponent(date)}&amount_cents=${amountCents}&gst_cents=${gstCents}`
    ),

  create: (data: Partial<Expense>) =>
    fetchJson<{ id: number }>('/expenses', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: number, data: Partial<Expense>) =>
    fetchJson<{ status: string }>(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  delete: (id: number) =>
    fetchJson<{ status: string }>(`/expenses/${id}`, { method: 'DELETE' }),

  batchDelete: (ids: number[]) =>
    fetchJson<{ status: string; count: number }>('/expenses/batch-delete', {
      method: 'POST', body: JSON.stringify({ ids }),
    }),

  batchDownloadReceipts: async (ids: number[]) => {
    const response = await fetch(`${API_BASE}/expenses/batch-download-receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Download failed');
    }
    return response.blob();
  },

  // Categories
  getCategories: () =>
    fetchJson<{ categories: ExpenseCategory[] }>('/expenses/categories'),

  createCategory: (data: Partial<ExpenseCategory>) =>
    fetchJson<{ id: number }>('/expenses/categories', { method: 'POST', body: JSON.stringify(data) }),

  updateCategory: (id: number, data: Partial<ExpenseCategory>) =>
    fetchJson<{ status: string }>(`/expenses/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteCategory: (id: number) =>
    fetchJson<{ status: string }>(`/expenses/categories/${id}`, { method: 'DELETE' }),

  // Receipts
  uploadReceipt: async (file: File): Promise<{ receipt_id: number; extraction: ReceiptExtraction | null; error?: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/expenses/receipts/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Receipt upload failed');
    }
    return response.json();
  },

  getReceipt: (id: number) => fetchJson<Receipt>(`/expenses/receipts/${id}`),

  getReceiptFileUrl: (id: number) => `${API_BASE}/expenses/receipts/${id}/file`,

  getReceiptThumbnailUrl: (id: number) => `${API_BASE}/expenses/receipts/${id}/thumbnail`,

  reprocessReceipt: (id: number) =>
    fetchJson<{ receipt_id: number; extraction: ReceiptExtraction | null; error?: string }>(
      `/expenses/receipts/${id}/reprocess`, { method: 'POST' }
    ),

  // Statistics & Tax
  getStatistics: (taxYear?: string) => {
    const q = taxYear ? `?tax_year=${encodeURIComponent(taxYear)}` : '';
    return fetchJson<ExpenseStatistics>(`/expenses/statistics${q}`);
  },

  getTaxSummary: (taxYear?: string) => {
    const q = taxYear ? `?tax_year=${encodeURIComponent(taxYear)}` : '';
    return fetchJson<TaxSummary>(`/expenses/tax-summary${q}`);
  },

  getBasSummary: (quarter?: string) => {
    const q = quarter ? `?quarter=${encodeURIComponent(quarter)}` : '';
    return fetchJson<TaxSummary>(`/expenses/bas-summary${q}`);
  },

  runTaxAnalysis: (taxYear?: string) =>
    fetchJson<TaxAnalysisResult>('/expenses/tax-analysis', {
      method: 'POST',
      body: JSON.stringify({ tax_year: taxYear || null }),
    }),

  getTaxRules: (taxYear?: string) => {
    const q = taxYear ? `?tax_year=${encodeURIComponent(taxYear)}` : '';
    return fetchJson<{ rules: TaxRule[] }>(`/expenses/tax-rules${q}`);
  },

  // Export
  exportCsv: (taxYear?: string) => {
    const q = taxYear ? `?tax_year=${encodeURIComponent(taxYear)}` : '';
    return `${API_BASE}/expenses/export${q}`;
  },
};

// Health check
export const healthApi = {
  check: () => fetchJson<{ status: string; project_dir: string }>('/health'),
};

export const agentsApi = {
  list: () =>
    fetchJson<{ agents: AgentInfo[] }>('/agents'),

  get: (agentId: string) =>
    fetchJson<AgentInfo>(`/agents/${agentId}`),
};

export const multiAgentApi = {
  run: (req: MultiAgentRunRequest) =>
    fetchJson<{ status: string; tickers: string[]; agents: string[]; invalid_agents: string[] }>(
      '/analysis/multi-agent',
      { method: 'POST', body: JSON.stringify(req) },
    ),

  cancel: () =>
    fetchJson<{ status: string }>('/analysis/multi-agent/cancel', { method: 'POST' }),

  getStatus: () =>
    fetchJson<{ running: boolean; tickers: string[] }>('/analysis/multi-agent/status'),

  getReports: (ticker: string, limit = 20, offset = 0) =>
    fetchJson<{ reports: MultiAgentReport[]; total: number }>(
      `/analysis/multi-agent/reports/${ticker}?limit=${limit}&offset=${offset}`,
    ),

  getLatest: (ticker: string) =>
    fetchJson<{ report: MultiAgentReport | null }>(`/analysis/multi-agent/reports/${ticker}/latest`),

  getReport: (id: number) =>
    fetchJson<MultiAgentReport>(`/analysis/multi-agent/report/${id}`),
};
