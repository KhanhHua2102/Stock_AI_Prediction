import { create } from 'zustand';
import { portfolioApi } from '../services/api';
import type {
  Portfolio,
  Transaction,
  PortfolioSummary,
  ValueHistoryPoint,
  PerformanceData,
  DividendDataPoint,
  SectorAllocation,
  MonthlyReturn,
  DrawdownPoint,
  StockBreakdown,
} from '../services/types';

type SubView = 'dashboard' | 'transactions' | 'import' | 'optimize';

interface PortfolioState {
  // Navigation
  subView: SubView;
  setSubView: (v: SubView) => void;

  // Portfolio list
  portfolios: Portfolio[];
  selectedId: number | null;
  loading: boolean;

  // Dashboard data
  summary: PortfolioSummary | null;
  valueHistory: ValueHistoryPoint[];
  performance: PerformanceData | null;
  dividends: DividendDataPoint[];
  allocation: SectorAllocation[];
  monthlyReturns: MonthlyReturn[];
  drawdown: DrawdownPoint[];
  stockBreakdown: StockBreakdown[];
  closedBreakdown: StockBreakdown[];
  dashboardLoading: boolean;

  // Transactions
  transactions: Transaction[];
  txnTotal: number;
  txnPage: number;
  txnLoading: boolean;

  // Actions
  fetchPortfolios: () => Promise<void>;
  selectPortfolio: (id: number | null) => void;
  createPortfolio: (name: string, currency?: string, benchmark?: string) => Promise<number>;
  deletePortfolio: (id: number) => Promise<void>;
  fetchDashboard: (id: number) => Promise<void>;
  fetchTransactions: (id: number, page?: number) => Promise<void>;
  addTransaction: (portfolioId: number, txn: {
    ticker: string; type: string; date: string; quantity: number; price?: number; fees?: number; notes?: string;
  }) => Promise<void>;
  deleteTransaction: (portfolioId: number, txnId: number) => Promise<void>;
  batchDeleteTransactions: (portfolioId: number, ids: number[]) => Promise<void>;
  rebuildSnapshots: (portfolioId: number) => Promise<void>;
  changeBenchmark: (portfolioId: number, benchmark: string) => Promise<void>;
}

const PAGE_SIZE = 50;

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
  subView: 'dashboard',
  setSubView: (v) => set({ subView: v }),

  portfolios: [],
  selectedId: null,
  loading: false,

  summary: null,
  valueHistory: [],
  performance: null,
  dividends: [],
  allocation: [],
  monthlyReturns: [],
  drawdown: [],
  stockBreakdown: [],
  closedBreakdown: [],
  dashboardLoading: false,

  transactions: [],
  txnTotal: 0,
  txnPage: 0,
  txnLoading: false,

  fetchPortfolios: async () => {
    set({ loading: true });
    try {
      const { portfolios } = await portfolioApi.listPortfolios();
      set({ portfolios });
      // Auto-select first if none selected
      const { selectedId } = get();
      if (selectedId === null && portfolios.length > 0) {
        get().selectPortfolio(portfolios[0].id);
      }
    } finally {
      set({ loading: false });
    }
  },

  selectPortfolio: (id) => {
    set({ selectedId: id, summary: null, valueHistory: [], performance: null, dividends: [], allocation: [], monthlyReturns: [], drawdown: [], stockBreakdown: [], closedBreakdown: [], transactions: [], txnTotal: 0, txnPage: 0 });
    if (id !== null) {
      get().fetchDashboard(id);
    }
  },

  createPortfolio: async (name, currency, benchmark) => {
    const result = await portfolioApi.createPortfolio(name, currency, benchmark);
    await get().fetchPortfolios();
    get().selectPortfolio(result.id);
    return result.id;
  },

  deletePortfolio: async (id) => {
    await portfolioApi.deletePortfolio(id);
    const { selectedId } = get();
    await get().fetchPortfolios();
    if (selectedId === id) {
      const { portfolios } = get();
      set({ selectedId: portfolios.length > 0 ? portfolios[0].id : null });
      if (portfolios.length > 0) get().fetchDashboard(portfolios[0].id);
    }
  },

  fetchDashboard: async (id) => {
    set({ dashboardLoading: true });
    try {
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
      set({
        summary: summary.status === 'fulfilled' ? summary.value : null,
        valueHistory: vh.status === 'fulfilled' ? vh.value.data : [],
        performance: perf.status === 'fulfilled' ? perf.value : null,
        dividends: div.status === 'fulfilled' ? div.value.data : [],
        allocation: alloc.status === 'fulfilled' ? alloc.value.data : [],
        monthlyReturns: ret.status === 'fulfilled' ? ret.value.data : [],
        drawdown: dd.status === 'fulfilled' ? dd.value.data : [],
        stockBreakdown: sb.status === 'fulfilled' ? sb.value.data : [],
        closedBreakdown: sb.status === 'fulfilled' ? (sb.value.closed || []) : [],
      });
    } finally {
      set({ dashboardLoading: false });
    }
  },

  fetchTransactions: async (id, page = 0) => {
    set({ txnLoading: true });
    try {
      const { transactions, total } = await portfolioApi.listTransactions(id, undefined, PAGE_SIZE, page * PAGE_SIZE);
      set({ transactions, txnTotal: total, txnPage: page });
    } finally {
      set({ txnLoading: false });
    }
  },

  addTransaction: async (portfolioId, txn) => {
    await portfolioApi.addTransaction(portfolioId, txn);
    await get().fetchTransactions(portfolioId, 0);
    await get().fetchDashboard(portfolioId);
  },

  deleteTransaction: async (portfolioId, txnId) => {
    await portfolioApi.deleteTransaction(portfolioId, txnId);
    const { txnPage } = get();
    await get().fetchTransactions(portfolioId, txnPage);
    await get().fetchDashboard(portfolioId);
  },

  batchDeleteTransactions: async (portfolioId, ids) => {
    await portfolioApi.batchDeleteTransactions(portfolioId, ids);
    const { txnPage } = get();
    await get().fetchTransactions(portfolioId, txnPage);
    await get().fetchDashboard(portfolioId);
  },

  rebuildSnapshots: async (portfolioId) => {
    await portfolioApi.rebuildSnapshots(portfolioId);
    await get().fetchDashboard(portfolioId);
  },

  changeBenchmark: async (portfolioId, benchmark) => {
    await portfolioApi.updatePortfolio(portfolioId, { benchmark });
    // Update local portfolio list
    set(state => ({
      portfolios: state.portfolios.map(p =>
        p.id === portfolioId ? { ...p, benchmark } : p
      ),
    }));
    // Re-fetch just the performance data with new benchmark
    const perf = await portfolioApi.getPerformance(portfolioId);
    set({ performance: perf });
  },
}));
