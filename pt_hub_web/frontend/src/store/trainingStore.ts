import { create } from 'zustand';
import type { NeuralSignal } from '../services/types';

const MAX_LOGS = 500;

interface NeuralSignalState {
  long_signal: number;
  short_signal: number;
}

interface TrainingState {
  // Training status per coin
  trainingStatus: Record<string, 'TRAINED' | 'TRAINING' | 'NOT_TRAINED'>;

  // Neural signals per coin
  neuralSignals: Record<string, NeuralSignalState>;

  // Trainer logs
  trainerLogs: string[];

  // Currently running trainers
  runningTrainers: string[];

  // Actions
  setTrainingStatus: (status: Record<string, 'TRAINED' | 'TRAINING' | 'NOT_TRAINED'>) => void;
  setCoinTrainingStatus: (coin: string, status: 'TRAINED' | 'TRAINING' | 'NOT_TRAINED') => void;
  setNeuralSignals: (coin: string, longSignal: number, shortSignal: number) => void;
  setAllNeuralSignals: (signals: Record<string, NeuralSignal>) => void;
  addTrainerLog: (message: string) => void;
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

  setCoinTrainingStatus: (coin, status) =>
    set((state) => ({
      trainingStatus: {
        ...state.trainingStatus,
        [coin]: status,
      },
    })),

  setNeuralSignals: (coin, longSignal, shortSignal) =>
    set((state) => ({
      neuralSignals: {
        ...state.neuralSignals,
        [coin]: {
          long_signal: longSignal,
          short_signal: shortSignal,
        },
      },
    })),

  setAllNeuralSignals: (signals) =>
    set({
      neuralSignals: Object.fromEntries(
        Object.entries(signals).map(([coin, signal]) => [
          coin,
          { long_signal: signal.long_signal, short_signal: signal.short_signal },
        ])
      ),
    }),

  addTrainerLog: (message) =>
    set((state) => ({
      trainerLogs: [...state.trainerLogs, message].slice(-MAX_LOGS),
    })),

  clearTrainerLogs: () => set({ trainerLogs: [] }),

  setRunningTrainers: (trainers) => set({ runningTrainers: trainers }),
}));

// Selectors
export const selectCoinTrainingStatus = (coin: string) => (state: TrainingState) =>
  state.trainingStatus[coin] ?? 'NOT_TRAINED';

export const selectCoinNeuralSignals = (coin: string) => (state: TrainingState) =>
  state.neuralSignals[coin] ?? { long_signal: 0, short_signal: 0 };

export const selectIsTraining = (coin: string) => (state: TrainingState) =>
  state.runningTrainers.includes(coin);
