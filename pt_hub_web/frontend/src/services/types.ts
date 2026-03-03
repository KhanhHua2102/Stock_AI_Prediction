// Process status types
export interface ProcessStatus {
  neural: {
    running: boolean;
    pid?: number;
  };
  trader: {
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
    ready_coins: string[];
    total_coins: number;
  };
}

// Account types
export interface Account {
  total_account_value: number;
  buying_power: number;
  holdings_sell_value: number;
  holdings_buy_value: number;
  percent_in_trade: number;
  pm_start_pct_no_dca: number;
  pm_start_pct_with_dca: number;
  trailing_gap_pct: number;
}

export interface Position {
  quantity: number;
  avg_cost_basis: number;
  current_buy_price: number;
  current_sell_price: number;
  gain_loss_pct_buy: number;
  gain_loss_pct_sell: number;
  value_aud: number;
  dca_triggered_stages: number;
  next_dca_display: string;
  dca_line_price: number;
  trail_active: boolean;
  trail_line: number;
  trail_peak: number;
}

export interface TraderStatus {
  timestamp: number;
  account: Account;
  positions: Record<string, Position>;
}

// Trade types
export interface Trade {
  ts: number;
  symbol: string;
  side: 'buy' | 'sell';
  tag?: string;
  qty: number;
  price: number;
  realized_profit_aud?: number;
  pnl_pct?: number;
}

// Portfolio types
export interface PortfolioItem {
  asset: string;
  balance: number;
  value_aud: number;
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
  trades: Trade[];
}

// Trader log parsed types
export interface TraderLogAccount {
  totalValue: number;
  holdingsValue: number;
  percentInTrade: number;
  trailingPmNoDca: number;
  trailingPmWithDca: number;
  trailingGap: number;
}

export interface TraderLogTrade {
  symbol: string;
  dcaPercent: number;
  dcaPrice: number;
  dcaLine: string;
  nextDca: string;
  gainLossSellPercent: number;
  gainLossSellPrice: number;
  dcaLevelsTriggered: number;
  tradeValue: number;
}

export interface TraderLogStatus {
  account: TraderLogAccount | null;
  trades: TraderLogTrade[];
}

// Legacy trader signal types (kept for compatibility)
export interface TraderSignal {
  direction: 'WITHIN' | 'ABOVE' | 'BELOW';
  timeframe: string;
  lowBoundary: number;
  highBoundary: number;
}

// Runner status types
export interface RunnerSignal {
  direction: 'WITHIN' | 'ABOVE' | 'BELOW';
  timeframe: string;
  lowBoundary: number;
  highBoundary: number;
}

export interface RunnerStatus {
  coin: string;
  currentPrice: number;
  signals: RunnerSignal[];
}

// Training types
export interface TrainingStatus {
  [coin: string]: 'TRAINED' | 'TRAINING' | 'NOT_TRAINED';
}

export interface NeuralSignal {
  long_signal: number;
  short_signal: number;
}

// WebSocket event types
export type WSEventType =
  | 'connected'
  | 'subscribed'
  | 'process_status'
  | 'trader_status'
  | 'log'
  | 'trade_executed'
  | 'runner_ready'
  | 'neural_signals'
  | 'training_status'
  | 'pong';

export interface WSMessage {
  type: WSEventType;
  data?: unknown;
  message?: string;
  channels?: string[];
  source?: string;
  coin?: string;
}

// Settings types
export interface Settings {
  coins: string[];
  default_timeframe: string;
  timeframes: string[];
  candles_limit: number;
  ui_refresh_seconds: number;
  chart_refresh_seconds: number;
  kraken_configured: boolean;
}
