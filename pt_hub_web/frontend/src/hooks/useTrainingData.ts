import { useQuery } from '@tanstack/react-query';
import { trainingApi, predictionsApi } from '../services/api';
import { useTrainingStore } from '../store/trainingStore';

export const trainingKeys = {
  status: ['training-status'] as const,
  signals: ['neural-signals'] as const,
};

export function useTrainingStatus() {
  const setTrainingStatus = useTrainingStore((s) => s.setTrainingStatus);

  return useQuery({
    queryKey: trainingKeys.status,
    queryFn: async () => {
      const { status } = await trainingApi.getStatus();
      setTrainingStatus(status);
      return status;
    },
  });
}

export function useNeuralSignals() {
  const setAllNeuralSignals = useTrainingStore((s) => s.setAllNeuralSignals);

  return useQuery({
    queryKey: trainingKeys.signals,
    queryFn: async () => {
      const { signals } = await trainingApi.getNeuralSignals();
      setAllNeuralSignals(signals);
      return signals;
    },
    refetchInterval: 5000,
  });
}

export const predictionKeys = {
  ticker: (ticker: string) => ['predictions', ticker] as const,
};

export function usePredictions(ticker: string) {
  return useQuery({
    queryKey: predictionKeys.ticker(ticker),
    queryFn: () => predictionsApi.get(ticker),
    enabled: !!ticker,
    refetchInterval: 30_000,
  });
}

export const portfolioKeys = {
  list: ['portfolios'] as const,
};
