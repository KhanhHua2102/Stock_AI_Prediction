import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { propertyApi } from '../services/api';
import type { InvestmentProperty, PropertyDashboardSummary } from '../services/types';

export interface PropertyDashboardData {
  summary: PropertyDashboardSummary | null;
  properties: InvestmentProperty[];
}

const EMPTY: PropertyDashboardData = { summary: null, properties: [] };

async function fetchPropertyDashboard(): Promise<PropertyDashboardData> {
  const [summary, properties] = await Promise.allSettled([
    propertyApi.getDashboard(),
    propertyApi.listProperties(),
  ]);
  return {
    summary: summary.status === 'fulfilled' ? summary.value : null,
    properties: properties.status === 'fulfilled' ? properties.value.properties : [],
  };
}

export const propertyKeys = {
  list: ['properties'] as const,
  dashboard: ['property-dashboard'] as const,
};

export function usePropertyDashboard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: propertyKeys.dashboard,
    queryFn: fetchPropertyDashboard,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: propertyKeys.dashboard });
  }, [queryClient]);

  return {
    data: query.data ?? EMPTY,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    invalidate,
  };
}
