import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { portfolioApi } from '../services/api';
import type {
  PortfolioSummary,
  ValueHistoryPoint,
  PerformanceData,
  DividendDataPoint,
  SectorAllocation,
  MonthlyReturn,
  DrawdownPoint,
  StockBreakdown,
  UpcomingEvent,
} from '../services/types';

export interface DashboardData {
  summary: PortfolioSummary | null;
  valueHistory: ValueHistoryPoint[];
  performance: PerformanceData | null;
  dividends: DividendDataPoint[];
  allocation: SectorAllocation[];
  monthlyReturns: MonthlyReturn[];
  drawdown: DrawdownPoint[];
  stockBreakdown: StockBreakdown[];
  closedBreakdown: StockBreakdown[];
}

const EMPTY: DashboardData = {
  summary: null,
  valueHistory: [],
  performance: null,
  dividends: [],
  allocation: [],
  monthlyReturns: [],
  drawdown: [],
  stockBreakdown: [],
  closedBreakdown: [],
};

async function fetchDashboardData(id: number): Promise<DashboardData> {
  const [summary, vh, perf, div, alloc, ret, dd, sb] = await Promise.allSettled([
    portfolioApi.getHoldings(id),
    portfolioApi.getValueHistory(id),
    portfolioApi.getPerformance(id),
    portfolioApi.getDividends(id),
    portfolioApi.getAllocation(id),
    portfolioApi.getReturns(id),
    portfolioApi.getDrawdown(id),
    portfolioApi.getStockBreakdown(id),
  ]);

  return {
    summary: summary.status === 'fulfilled' ? summary.value : null,
    valueHistory: vh.status === 'fulfilled' ? vh.value.data : [],
    performance: perf.status === 'fulfilled' ? perf.value : null,
    dividends: div.status === 'fulfilled' ? div.value.data : [],
    allocation: alloc.status === 'fulfilled' ? alloc.value.data : [],
    monthlyReturns: ret.status === 'fulfilled' ? ret.value.data : [],
    drawdown: dd.status === 'fulfilled' ? dd.value.data : [],
    stockBreakdown: sb.status === 'fulfilled' ? sb.value.data : [],
    closedBreakdown: sb.status === 'fulfilled' ? (sb.value.closed || []) : [],
  };
}

export function usePortfolioDashboard(portfolioId: number | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['portfolio-dashboard', portfolioId],
    queryFn: () => fetchDashboardData(portfolioId!),
    enabled: portfolioId !== null,
    placeholderData: (prev) => prev, // keep previous data while switching portfolios
  });

  const invalidate = useCallback(() => {
    if (portfolioId !== null) {
      queryClient.invalidateQueries({ queryKey: ['portfolio-dashboard', portfolioId] });
    }
  }, [queryClient, portfolioId]);

  // Upcoming events — separate query so it doesn't block dashboard load
  const eventsQuery = useQuery({
    queryKey: ['portfolio-events', portfolioId],
    queryFn: async () => {
      const res = await portfolioApi.getUpcomingEvents(portfolioId!);
      return res.data;
    },
    enabled: portfolioId !== null,
    staleTime: 1000 * 60 * 30, // 30 min — events don't change often
  });

  return {
    data: query.data ?? EMPTY,
    events: eventsQuery.data as UpcomingEvent[] | undefined ?? [],
    eventsLoading: eventsQuery.isLoading,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    invalidate,
  };
}
