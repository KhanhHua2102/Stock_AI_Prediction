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

// WebSocket event types
export type WSEventType =
  | 'connected'
  | 'subscribed'
  | 'process_status'
  | 'log'
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
