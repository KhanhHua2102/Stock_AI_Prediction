// Process status types
export interface ProcessStatus {
  neural: {
    running: boolean;
    pid?: number;
  };
  trainers: Record<string, {
    running: boolean;
    pid?: number;
  }>;
  runner_ready: {
    ready: boolean;
    stage: string;
    ready_tickers: string[];
    total_tickers: number;
  };
}

// Chart types
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ChartOverlays {
  neural_levels: {
    long: number[];
    short: number[];
  };
  ask_price: number;
  bid_price: number;
  trail_line: number;
  dca_line: number;
}

// Runner status types
export interface RunnerSignal {
  direction: 'WITHIN' | 'ABOVE' | 'BELOW';
  timeframe: string;
  lowBoundary: number;
  highBoundary: number;
}

export interface RunnerStatus {
  ticker: string;
  currentPrice: number;
  signals: RunnerSignal[];
}

// Training types
export interface TrainingStatus {
  [ticker: string]: 'TRAINED' | 'TRAINING' | 'NOT_TRAINED';
}

export interface NeuralSignal {
  long_signal: number;
  short_signal: number;
}

// Analysis types
export interface AnalysisReport {
  id: number;
  ticker: string;
  created_at: string;
  current_price: number;
  price_change_pct: number;
  indicators: {
    ma_alignment: { sma20: number | null; sma50: number | null; sma200: number | null; status: string };
    rsi: { value: number | null; zone: string };
    macd: { signal: number | null; histogram: number | null; direction: string };
    volume: { current: number; average: number; ratio: number };
    support: number[];
    resistance: number[];
    price_range_52w: { high: number; low: number };
  };
  decision: 'BUY' | 'HOLD' | 'SELL';
  score: number;
  conclusion: string;
  price_levels: {
    support: number[];
    resistance: number[];
    target: number;
    stop_loss: number;
  };
  checklist: { item: string; passed: boolean }[];
  news?: { headline: string; source: string; datetime: number; url?: string }[];
  raw_reasoning?: string;
  model_used?: string;
}

// Portfolio types
export interface PortfolioAsset {
  ticker: string;
  weight: number;
}

export interface PortfolioOptimizationResult {
  assets: PortfolioAsset[];
  portfolio_return: number | null;
  portfolio_volatility: number | null;
  sharpe_ratio: number | null;
  strategy: string;
}

export interface RiskReturnResult {
  expected_return: number;
  volatility: number;
  sharpe_ratio: number;
}

export interface Holding {
  ticker: string;
  quantity?: number;
  price?: number;
  value?: number;
}

export interface RebalanceAction {
  ticker: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  shares: number;
  dollar_amount: number;
  current_weight: number;
  target_weight: number;
  current_value: number;
}

export interface RebalanceResult {
  actions: RebalanceAction[];
  total_portfolio_value: number;
  additional_capital: number;
  strategy: string;
}

export interface CorrelationResult {
  tickers: string[];
  matrix: number[][];
  source: string;
}

// Portfolio Management types
export interface Portfolio {
  id: number;
  name: string;
  currency: string;
  benchmark: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: number;
  portfolio_id: number;
  ticker: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'SPLIT';
  date: string;
  quantity: number;
  price: number;
  fees: number;
  notes: string | null;
  created_at: string;
}

export interface ImportPreviewResult {
  file_id: string;
  columns: string[];
  sample_rows: Record<string, string>[];
  row_count: number;
  suggested_mapping: Record<string, string | null>;
}

export interface ImportConfirmRow {
  ticker: string;
  date: string;
  type: string;
  quantity: number;
  price: number;
  fees?: number;
  is_duplicate: boolean;
}

export interface ImportConfirmResult {
  status: 'success' | 'duplicates_found';
  imported?: number;
  duplicate_count?: number;
  new_count?: number;
  total_count?: number;
  rows?: ImportConfirmRow[];
  file_id?: string;
}

export interface PortfolioHoldingDetail {
  ticker: string;
  quantity: number;
  cost_basis: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  unrealised_pnl: number;
  unrealised_pnl_pct: number;
  realised_pnl: number;
  total_dividends: number;
  weight_pct: number;
}

export interface PortfolioSummary {
  total_value: number;
  total_cost: number;
  unrealised_pnl: number;
  unrealised_pnl_pct: number;
  realised_pnl: number;
  total_dividends: number;
  annualised_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  beta: number;
  holdings: PortfolioHoldingDetail[];
}

export interface ValueHistoryPoint {
  date: string;
  value: number;
  deposits: number;
}

export interface PerformancePoint {
  date: string;
  cumulative_return: number;
  value?: number;
}

export interface PerformanceData {
  portfolio: PerformancePoint[];
  benchmark: PerformancePoint[];
  benchmark_ticker: string;
}

export interface DividendDataPoint {
  period: string;
  amount: number;
}

export interface SectorAllocation {
  sector: string;
  value: number;
  weight_pct: number;
  tickers?: { ticker: string; value: number; weight_pct: number }[];
}

export interface MonthlyReturn {
  period: string;
  return_pct: number;
}

export interface DrawdownPoint {
  date: string;
  drawdown: number;
}

export interface StockBreakdown {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  unrealised_pnl: number;
  realised_pnl: number;
  dividends: number;
  total_return: number;
  total_return_pct: number;
  closed_date?: string;
}

export interface UpcomingEvent {
  ticker: string;
  type: 'earnings' | 'ex-dividend' | 'dividend' | 'distribution';
  date: string;
  detail: string | null;
  ex_date?: string;
  record_date?: string;
  payment_date?: string;
}

// WebSocket event types
export type WSEventType =
  | 'connected'
  | 'subscribed'
  | 'process_status'
  | 'log'
  | 'runner_ready'
  | 'neural_signals'
  | 'training_status'
  | 'analysis_log'
  | 'analysis_complete'
  | 'pong';

export interface WSMessage {
  type: WSEventType;
  data?: unknown;
  message?: string;
  channels?: string[];
  source?: string;
  ticker?: string;
}

// Settings types
export interface Settings {
  tickers: string[];
  default_timeframe: string;
  timeframes: string[];
  candles_limit: number;
  ui_refresh_seconds: number;
  chart_refresh_seconds: number;
}
