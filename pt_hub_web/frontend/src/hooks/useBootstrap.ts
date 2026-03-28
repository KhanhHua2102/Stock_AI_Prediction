import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSettingsStore } from '../store/settingsStore';
import { useTrainingStore } from '../store/trainingStore';
import { usePortfolioStore } from '../store/portfolioStore';
import { usePropertyStore } from '../store/propertyStore';
import { trainingApi, portfolioApi, propertyApi } from '../services/api';
import { trainingKeys, portfolioKeys } from './useTrainingData';
import { propertyKeys } from './usePropertyDashboard';

/**
 * Warms the React Query cache on first boot so all tabs have data ready.
 * Runs once after settings are loaded.
 */
export function useBootstrap() {
  const settings = useSettingsStore((s) => s.settings);
  const queryClient = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (!settings || ran.current) return;
    ran.current = true;

    // Prefetch into React Query cache — components using useQuery with the
    // same keys will pick up the cached data instantly (no duplicate requests).
    queryClient.prefetchQuery({
      queryKey: trainingKeys.status,
      queryFn: async () => {
        const { status } = await trainingApi.getStatus();
        useTrainingStore.getState().setTrainingStatus(status);
        return status;
      },
    });

    queryClient.prefetchQuery({
      queryKey: trainingKeys.signals,
      queryFn: async () => {
        const { signals } = await trainingApi.getNeuralSignals();
        useTrainingStore.getState().setAllNeuralSignals(signals);
        return signals;
      },
    });

    queryClient.prefetchQuery({
      queryKey: portfolioKeys.list,
      queryFn: async () => {
        const { portfolios } = await portfolioApi.listPortfolios();
        // Also populate the Zustand store for components that read from it
        usePortfolioStore.setState({ portfolios });
        const store = usePortfolioStore.getState();
        if (store.selectedId === null && portfolios.length > 0) {
          store.selectPortfolio(portfolios[0].id);
        }
        return portfolios;
      },
    });

    queryClient.prefetchQuery({
      queryKey: propertyKeys.list,
      queryFn: async () => {
        const { properties } = await propertyApi.listProperties();
        usePropertyStore.setState({ properties });
        const store = usePropertyStore.getState();
        if (store.selectedId === null && properties.length > 0) {
          store.selectProperty(properties[0].id);
        }
        return properties;
      },
    });
  }, [settings, queryClient]);
}
