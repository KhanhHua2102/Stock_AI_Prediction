import { create } from 'zustand';
import type { ProcessStatus, TraderStatus, Trade, Account, Position, TraderSignal, RunnerStatus, RunnerSignal, TraderLogStatus, TraderLogAccount, TraderLogTrade } from '../services/types';

const MAX_LOGS = 500;
const MAX_TRADES = 250;

interface TradeState {
  // Connection status
  connected: boolean;

  // Process status
  processStatus: ProcessStatus | null;

  // Account data
  account: Account | null;

  // Positions
  positions: Record<string, Position>;

  // Trade history
  tradeHistory: Trade[];

  // Logs (circular buffer)
  runnerLogs: string[];
  traderLogs: string[];

  // Selected coins for trading
  selectedCoins: string[];

  // Parsed trader signals
  traderSignals: TraderSignal[];

  // Actions
  setConnected: (connected: boolean) => void;
  setProcessStatus: (status: ProcessStatus) => void;
  setTraderStatus: (status: TraderStatus) => void;
  setAccount: (account: Account) => void;
  setPositions: (positions: Record<string, Position>) => void;
  addTrade: (trade: Trade) => void;
  setTradeHistory: (trades: Trade[]) => void;
  addLog: (source: 'runner' | 'trader', message: string) => void;
  clearLogs: (source: 'runner' | 'trader') => void;
  setSelectedCoins: (coins: string[]) => void;
  setTraderSignals: (signals: TraderSignal[]) => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  // Initial state
  connected: false,
  processStatus: null,
  account: null,
  positions: {},
  tradeHistory: [],
  runnerLogs: [],
  traderLogs: [],
  selectedCoins: [],
  traderSignals: [],

  // Actions
  setConnected: (connected) => set({ connected }),

  setProcessStatus: (status) => set({ processStatus: status }),

  setTraderStatus: (status) =>
    set({
      account: status.account,
      positions: status.positions,
    }),

  setAccount: (account) => set({ account }),

  setPositions: (positions) => set({ positions }),

  addTrade: (trade) =>
    set((state) => ({
      tradeHistory: [...state.tradeHistory, trade].slice(-MAX_TRADES),
    })),

  setTradeHistory: (trades) => set({ tradeHistory: trades.slice(-MAX_TRADES) }),

  addLog: (source, message) =>
    set((state) => {
      if (source === 'runner') {
        return {
          runnerLogs: [...state.runnerLogs, message].slice(-MAX_LOGS),
        };
      } else {
        return {
          traderLogs: [...state.traderLogs, message].slice(-MAX_LOGS),
        };
      }
    }),

  clearLogs: (source) =>
    set(() => {
      if (source === 'runner') {
        return { runnerLogs: [] };
      } else {
        return { traderLogs: [] };
      }
    }),

  setSelectedCoins: (coins) => set({ selectedCoins: coins }),

  setTraderSignals: (signals) => set({ traderSignals: signals }),
}));

// Helper function to parse trader signals from log messages (legacy)
export function parseTraderSignals(logs: string[]): TraderSignal[] {
  const signals: TraderSignal[] = [];
  const signalRegex = /(WITHIN|ABOVE|BELOW) on (\w+) timeframe\. Low Boundary: ([\d.]+) High Boundary: ([\d.]+)/;

  for (const log of logs) {
    // Clean ANSI escape sequences and brackets/quotes
    const cleanLog = log
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\[\d*[JHKm]/g, '')
      .replace(/[\[\]']/g, '')
      .trim();
    if (!cleanLog) continue;

    const match = cleanLog.match(signalRegex);
    if (match) {
      signals.push({
        direction: match[1] as 'WITHIN' | 'ABOVE' | 'BELOW',
        timeframe: match[2],
        lowBoundary: parseFloat(match[3]),
        highBoundary: parseFloat(match[4]),
      });
    }
  }

  // Deduplicate by timeframe (keep the last one)
  const uniqueSignals = new Map<string, TraderSignal>();
  for (const signal of signals) {
    uniqueSignals.set(signal.timeframe, signal);
  }

  return Array.from(uniqueSignals.values());
}

// Helper function to parse trader log status (account + trades)
export function parseTraderLogStatus(logs: string[]): TraderLogStatus {
  let account: TraderLogAccount | null = null;
  const trades: TraderLogTrade[] = [];

  // Regex patterns
  const totalValueRegex = /Total Account Value: \$([\d.]+)/;
  const holdingsRegex = /Holdings Value: \$([\d.]+)/;
  const percentInTradeRegex = /Percent In Trade: ([\d.]+)%/;
  const trailingPmRegex = /Trailing PM: start \+([\d.]+)% \(no DCA\) \/ \+([\d.]+)% \(with DCA\) \| gap ([\d.]+)%/;
  const tradeRegex = /Symbol: (\w+)\s+\|\s+DCA: ([+-]?[\d.]+)% @ ([\d.]+) \(Line: ([^|]+)\| Next: ([^)]+)\)\s+\|\s+Gain\/Loss SELL: ([+-]?[\d.]+)% @ ([\d.]+)\s+\|\s+DCA Levels Triggered: (\d+)\s+\|\s+Trade Value: \$([\d.]+)/;

  let totalValue = 0;
  let holdingsValue = 0;
  let percentInTrade = 0;
  let trailingPmNoDca = 0;
  let trailingPmWithDca = 0;
  let trailingGap = 0;

  for (const log of logs) {
    // Clean ANSI escape sequences
    const cleanLog = log
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\[\d*[JHKm]/g, '')
      .trim();
    if (!cleanLog) continue;

    // Parse account summary
    const totalMatch = cleanLog.match(totalValueRegex);
    if (totalMatch) {
      totalValue = parseFloat(totalMatch[1]);
      continue;
    }

    const holdingsMatch = cleanLog.match(holdingsRegex);
    if (holdingsMatch) {
      holdingsValue = parseFloat(holdingsMatch[1]);
      continue;
    }

    const percentMatch = cleanLog.match(percentInTradeRegex);
    if (percentMatch) {
      percentInTrade = parseFloat(percentMatch[1]);
      continue;
    }

    const trailingMatch = cleanLog.match(trailingPmRegex);
    if (trailingMatch) {
      trailingPmNoDca = parseFloat(trailingMatch[1]);
      trailingPmWithDca = parseFloat(trailingMatch[2]);
      trailingGap = parseFloat(trailingMatch[3]);
      continue;
    }

    // Parse trade lines
    const tradeMatch = cleanLog.match(tradeRegex);
    if (tradeMatch) {
      trades.push({
        symbol: tradeMatch[1],
        dcaPercent: parseFloat(tradeMatch[2]),
        dcaPrice: parseFloat(tradeMatch[3]),
        dcaLine: tradeMatch[4].trim(),
        nextDca: tradeMatch[5].trim(),
        gainLossSellPercent: parseFloat(tradeMatch[6]),
        gainLossSellPrice: parseFloat(tradeMatch[7]),
        dcaLevelsTriggered: parseInt(tradeMatch[8], 10),
        tradeValue: parseFloat(tradeMatch[9]),
      });
    }
  }

  if (totalValue > 0) {
    account = {
      totalValue,
      holdingsValue,
      percentInTrade,
      trailingPmNoDca,
      trailingPmWithDca,
      trailingGap,
    };
  }

  // Deduplicate trades by symbol (keep the last one)
  const uniqueTrades = new Map<string, TraderLogTrade>();
  for (const trade of trades) {
    uniqueTrades.set(trade.symbol, trade);
  }

  return {
    account,
    trades: Array.from(uniqueTrades.values()),
  };
}

// Helper function to parse runner status from log messages
export function parseRunnerStatus(logs: string[]): RunnerStatus | null {
  let coin = '';
  let currentPrice = 0;
  const signals: RunnerSignal[] = [];

  // Regex patterns
  const priceRegex = /([A-Z]+)\s+([\d.]+)/;
  const signalRegex = /(WITHIN|ABOVE|BELOW) on (\w+) timeframe\. Low Boundary: ([\d.]+) High Boundary: ([\d.]+)/;

  for (const log of logs) {
    // Clean ANSI escape sequences: [3J, [H, [2J, etc.
    const cleanLog = log
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Standard ANSI
      .replace(/\[\d*[JHKm]/g, '')            // Bracket codes like [3J, [H, [2J
      .replace(/[\[\]']/g, '')                // Remove brackets and quotes
      .trim();
    if (!cleanLog) continue;

    // Check for price line (e.g., "BTC  143684.26")
    const priceMatch = cleanLog.match(priceRegex);
    if (priceMatch && !cleanLog.includes('timeframe')) {
      coin = priceMatch[1];
      currentPrice = parseFloat(priceMatch[2]);
      continue;
    }

    // Check for signal line
    const signalMatch = cleanLog.match(signalRegex);
    if (signalMatch) {
      signals.push({
        direction: signalMatch[1] as 'WITHIN' | 'ABOVE' | 'BELOW',
        timeframe: signalMatch[2],
        lowBoundary: parseFloat(signalMatch[3]),
        highBoundary: parseFloat(signalMatch[4]),
      });
    }
  }

  if (!coin || currentPrice === 0) {
    return null;
  }

  // Deduplicate signals by timeframe (keep the last one)
  const uniqueSignals = new Map<string, RunnerSignal>();
  for (const signal of signals) {
    uniqueSignals.set(signal.timeframe, signal);
  }

  return {
    coin,
    currentPrice,
    signals: Array.from(uniqueSignals.values()),
  };
}

// Selectors
export const selectIsNeuralRunning = (state: TradeState) =>
  state.processStatus?.neural.running ?? false;

export const selectIsTraderRunning = (state: TradeState) =>
  state.processStatus?.trader.running ?? false;

export const selectRunnerReady = (state: TradeState) =>
  state.processStatus?.runner_ready ?? { ready: false, stage: 'unknown', ready_coins: [], total_coins: 0 };

export const selectTotalValue = (state: TradeState) =>
  state.account?.total_account_value ?? 0;

export const selectBuyingPower = (state: TradeState) =>
  state.account?.buying_power ?? 0;

export const selectPercentInTrade = (state: TradeState) =>
  state.account?.percent_in_trade ?? 0;
