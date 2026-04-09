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
    ma_alignment: { sma20: number | null; sma50: number | null; sma200: number | null; status: string; trend_level?: string };
    rsi: { value: number | null; zone: string; rsi_6?: number | null; rsi_24?: number | null };
    macd: { signal: number | null; histogram: number | null; direction: string };
    bias_rate?: { bias_5: number | null; bias_10: number | null; bias_20: number | null };
    volume: { current: number; average: number; ratio: number; category?: string };
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
  trend_analysis?: {
    signal_score: number;
    trend_status: string;
    score_breakdown: Record<string, number>;
    reasons: string[];
    risks: string[];
  };
  battle_plan?: {
    entry_strategy: string;
    exit_strategy: string;
    risk_management: string;
  };
  time_horizon?: string;
  raw_reasoning?: string;
  model_used?: string;
  strategy?: string;
}

export interface AnalysisStrategy {
  key: string;
  name: string;
  description: string;
  market_regimes?: string[];
}

export interface QuickVerification {
  report_id: number;
  ticker: string;
  analysis_date: string;
  direction_correct: boolean;
  return_pct: number;
  next_day_close: number;
  decision: string;
}

export interface BacktestResult {
  id: number;
  report_id: number;
  ticker: string;
  analysis_date: string;
  evaluation_date: string;
  entry_price: number;
  exit_price: number;
  target_price: number;
  stop_loss: number;
  decision: 'BUY' | 'HOLD' | 'SELL';
  target_hit: boolean;
  stop_hit: boolean;
  direction_correct: boolean;
  return_pct: number;
  days_held: number;
  outcome: 'WIN' | 'LOSS' | 'NEUTRAL';
}

export interface BacktestSummary {
  total: number;
  win_rate: number | null;
  direction_accuracy: number | null;
  avg_return: number | null;
  wins: number;
  losses: number;
  neutrals: number;
  newly_evaluated?: number;
  by_decision: Record<string, { count: number; win_rate: number | null; avg_return: number }>;
}

export interface MarketReview {
  id: number;
  date: string;
  indices: Record<string, { name: string; price: number; change_pct: number }>;
  sectors: { etf: string; name: string; change_pct: number }[];
  summary: string;
  fear_greed: { score: number; rating: string; previous_close?: number } | null;
  model_used: string;
  created_at: string;
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
  est_amount?: number;
}

// Property types
export interface InvestmentProperty {
  id: number;
  name: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  property_type: 'house' | 'apartment' | 'townhouse' | 'land' | 'villa' | 'unit';
  bedrooms: number;
  bathrooms: number;
  parking: number;
  land_size_sqm: number | null;
  purchase_date: string | null;
  purchase_price: number | null;
  current_estimate: number | null;
  estimate_source?: string | null;
  rental_income_weekly: number;
  loan_amount: number;
  loan_rate_pct: number;
  notes: string | null;
  projection_params?: Record<string, number> | null;
  created_at: string;
  updated_at: string;
}

export interface PropertyValuation {
  id: number;
  property_id: number;
  date: string;
  estimated_value: number;
  source: string;
  notes: string | null;
  created_at: string;
}

export interface SuburbMetric {
  id: number;
  suburb: string;
  state: string;
  postcode: string;
  date: string;
  metric_type: string;
  value: number;
  source: string;
}

export interface SuburbSummary {
  suburb: string;
  state: string;
  metrics: Record<string, { value: number; date: string; source: string }>;
}

export interface FavoriteSuburb {
  id: number;
  suburb: string;
  state: string;
  postcode: string;
  created_at: string;
}

export interface PropertyDashboardSummary {
  total_properties: number;
  total_purchase_value: number;
  total_current_estimate: number;
  total_equity: number;
  total_weekly_rent: number;
  gross_yield_pct: number;
  total_loan_amount: number;
  total_loan_repayment_monthly: number;
}

// Expense types
export interface ExpenseCategory {
  id: number;
  code: string;
  name: string;
  color: string;
  type: 'income' | 'expense';
  tax_deductible: boolean;
  ato_category: string | null;
  llm_prompt: string | null;
  sort_order: number;
}

export interface Expense {
  id: number;
  date: string;
  merchant: string | null;
  description: string | null;
  amount_cents: number;
  currency: string;
  category_id: number | null;
  category_code?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  ato_category?: string | null;
  gst_cents: number;
  is_income: boolean;
  tax_deductible: boolean;
  deduction_pct: number;
  tax_year: string | null;
  bas_quarter: string | null;
  receipt_id: number | null;
  project: string | null;
  notes: string | null;
  created_at: string;
}

export interface Receipt {
  id: number;
  filename: string;
  original_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  thumbnail_path: string | null;
  ai_extracted: Record<string, unknown> | null;
  status: 'pending' | 'processing' | 'done' | 'error';
  error_message: string | null;
  created_at: string;
}

export interface ReceiptExtraction {
  merchant: string;
  date: string;
  amount: number;
  currency: string;
  gst: number;
  description: string;
  category_suggestion: string;
  line_items: { description: string; quantity: number; unit_price: number; total: number }[];
  abn: string | null;
  payment_method: string | null;
  is_tax_invoice: boolean;
}

export interface ExpenseStatistics {
  tax_year: string;
  total_income: number;
  total_expense: number;
  total_deductions: number;
  total_gst: number;
  count: number;
  by_category: {
    id: number;
    code: string;
    name: string;
    color: string;
    type: string;
    ato_category: string | null;
    total_cents: number;
    count: number;
  }[];
  monthly: { month: string; income_cents: number; expense_cents: number }[];
}

export interface TaxSummary {
  tax_year: string;
  total_income_cents: number;
  total_deductions_cents: number;
  by_ato_category: {
    ato_category: string;
    category_name: string;
    total_cents: number;
    items: number;
  }[];
  gst_collected_cents: number;
  gst_paid_cents: number;
  gst_net_cents: number;
  rules: TaxRule[];
}

export interface TaxRule {
  id: number;
  category_code: string;
  rule_name: string;
  description: string;
  max_amount_cents: number | null;
  requires_records: boolean;
  ato_reference: string;
  tax_year: string;
}

export interface TaxAnalysisResult {
  tax_year: string;
  summary: string;
  estimated_tax_savings?: number;
  total_valid_deductions?: number;
  recommendations: string[];
  warnings: string[];
  missed_deductions: string[];
  by_category: {
    ato_category: string;
    category_name: string;
    amount: number;
    status: 'valid' | 'review' | 'warning';
    notes: string;
  }[];
}

// --- Multi-Agent Analysis Types ---

export interface AgentInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  requires_data: string[];
  is_fina_analyst: boolean;
}

export interface AgentSignalResult {
  agent_id: string;
  agent_name: string;
  category: string;
  ticker: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  max_position_pct: number;
  reasoning: string;
  key_factors: string[];
}

export interface ConsensusResult {
  ticker: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  bullish_count: number;
  bearish_count: number;
  neutral_count: number;
  weighted_bullish_pct: number;
  weighted_bearish_pct: number;
  reasoning: string;
}

export interface TradeRecommendation {
  ticker: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  suggested_allocation_pct: number;
  suggested_amount: number;
  reasoning: string;
  agent_breakdown: Partial<AgentSignalResult>[];
  risk_notes: string;
  debate_summary?: string;
}

export interface MultiAgentReport {
  id: number;
  ticker: string;
  created_at: string;
  selected_agents: string[];
  portfolio_context: Record<string, unknown> | null;
  agent_signals: AgentSignalResult[];
  debate_occurred: boolean;
  debate_rounds: Record<string, unknown>[] | null;
  risk_assessment: Record<string, unknown> | null;
  risk_reasoning: string | null;
  consensus_action: 'BUY' | 'SELL' | 'HOLD';
  consensus_confidence: number;
  consensus_reasoning: string | null;
  recommendation: TradeRecommendation | null;
  market_data_summary: Record<string, unknown> | null;
  model_used: string | null;
  total_duration_ms: number | null;
  price_at_analysis: number | null;
}

export interface MultiAgentRunRequest {
  tickers: string[];
  agents: string[];
  enable_risk_reasoning?: boolean;
  include_portfolio_context?: boolean;
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
  | 'analysis_cancelled'
  | 'multi_agent_log'
  | 'multi_agent_complete'
  | 'multi_agent_cancelled'
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
  ws_token?: string;
}
