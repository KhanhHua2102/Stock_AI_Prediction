import { create } from 'zustand';
import type { ProcessStatus, RunnerStatus, RunnerSignal } from '../services/types';

const MAX_LOGS = 500;

interface TradeState {
  connected: boolean;
  processStatus: ProcessStatus | null;
  runnerLogs: string[];
  selectedTickers: string[];

  setConnected: (connected: boolean) => void;
  setProcessStatus: (status: ProcessStatus) => void;
  addLog: (source: 'runner' | 'trainer', message: string) => void;
  clearLogs: (source: 'runner' | 'trainer') => void;
  setSelectedTickers: (tickers: string[]) => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  connected: false,
  processStatus: null,
  runnerLogs: [],
  selectedTickers: [],

  setConnected: (connected) => set({ connected }),
  setProcessStatus: (status) => set({ processStatus: status }),

  addLog: (_source, message) =>
    set((state) => ({
      runnerLogs: [...state.runnerLogs, message].slice(-MAX_LOGS),
    })),

  clearLogs: (_source) => set({ runnerLogs: [] }),

  setSelectedTickers: (tickers) => set({ selectedTickers: tickers }),
}));

// Helper function to parse runner status from log messages
export function parseRunnerStatus(logs: string[]): RunnerStatus | null {
  let ticker = '';
  let currentPrice = 0;
  const signals: RunnerSignal[] = [];

  const priceRegex = /([A-Z^.]+)\s+([\d.]+)/;
  const signalRegex = /(WITHIN|ABOVE|BELOW) on (\w+) timeframe\. Low Boundary: ([\d.]+) High Boundary: ([\d.]+)/;

  for (const log of logs) {
    const cleanLog = log
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\[\d*[JHKm]/g, '')
      .replace(/[\[\]']/g, '')
      .trim();
    if (!cleanLog) continue;

    const priceMatch = cleanLog.match(priceRegex);
    if (priceMatch && !cleanLog.includes('timeframe')) {
      ticker = priceMatch[1];
      currentPrice = parseFloat(priceMatch[2]);
      continue;
    }

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

  if (!ticker || currentPrice === 0) {
    return null;
  }

  const uniqueSignals = new Map<string, RunnerSignal>();
  for (const signal of signals) {
    uniqueSignals.set(signal.timeframe, signal);
  }

  return {
    ticker,
    currentPrice,
    signals: Array.from(uniqueSignals.values()),
  };
}

// Selectors
export const selectIsNeuralRunning = (state: TradeState) =>
  state.processStatus?.neural.running ?? false;

export const selectRunnerReady = (state: TradeState) =>
  state.processStatus?.runner_ready ?? { ready: false, stage: 'unknown', ready_tickers: [], total_tickers: 0 };
