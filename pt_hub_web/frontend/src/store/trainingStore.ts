import { create } from 'zustand';
import type { NeuralSignal } from '../services/types';

const MAX_LOGS = 500;

interface NeuralSignalState {
  long_signal: number;
  short_signal: number;
}

interface TrainingState {
  // Training status per ticker
  trainingStatus: Record<string, 'TRAINED' | 'TRAINING' | 'NOT_TRAINED'>;

  // Neural signals per ticker
  neuralSignals: Record<string, NeuralSignalState>;

  // Trainer logs
  trainerLogs: string[];

  // Currently running trainers
  runningTrainers: string[];

  // Actions
  setTrainingStatus: (status: Record<string, 'TRAINED' | 'TRAINING' | 'NOT_TRAINED'>) => void;
  setTickerTrainingStatus: (ticker: string, status: 'TRAINED' | 'TRAINING' | 'NOT_TRAINED') => void;
  setNeuralSignals: (ticker: string, longSignal: number, shortSignal: number) => void;
  setAllNeuralSignals: (signals: Record<string, NeuralSignal>) => void;
  addTrainerLog: (message: string, ticker?: string) => void;
  clearTrainerLogs: () => void;
  setRunningTrainers: (trainers: string[]) => void;
}

export const useTrainingStore = create<TrainingState>((set) => ({
  // Initial state
  trainingStatus: {},
  neuralSignals: {},
  trainerLogs: [],
  runningTrainers: [],

  // Actions
  setTrainingStatus: (status) => set({ trainingStatus: status }),

  setTickerTrainingStatus: (ticker, status) =>
    set((state) => ({
      trainingStatus: {
        ...state.trainingStatus,
        [ticker]: status,
      },
    })),

  setNeuralSignals: (ticker, longSignal, shortSignal) =>
    set((state) => ({
      neuralSignals: {
        ...state.neuralSignals,
        [ticker]: {
          long_signal: longSignal,
          short_signal: shortSignal,
        },
      },
    })),

  setAllNeuralSignals: (signals) =>
    set({
      neuralSignals: Object.fromEntries(
        Object.entries(signals).map(([ticker, signal]) => [
          ticker,
          { long_signal: signal.long_signal, short_signal: signal.short_signal },
        ])
      ),
    }),

  addTrainerLog: (message, ticker?) =>
    set((state) => ({
      trainerLogs: [...state.trainerLogs, ticker ? `[${ticker}] ${message}` : message].slice(-MAX_LOGS),
    })),

  clearTrainerLogs: () => set({ trainerLogs: [] }),

  setRunningTrainers: (trainers) => set({ runningTrainers: trainers }),
}));

// Selectors
export const selectTickerTrainingStatus = (ticker: string) => (state: TrainingState) =>
  state.trainingStatus[ticker] ?? 'NOT_TRAINED';

export const selectTickerNeuralSignals = (ticker: string) => (state: TrainingState) =>
  state.neuralSignals[ticker] ?? { long_signal: 0, short_signal: 0 };

export const selectIsTraining = (ticker: string) => (state: TrainingState) =>
  state.runningTrainers.includes(ticker);
