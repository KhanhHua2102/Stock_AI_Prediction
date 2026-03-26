import { create } from 'zustand';
import type { AnalysisReport } from '../services/types';

const MAX_LOGS = 300;

interface AnalysisState {
  isRunning: boolean;
  runningTicker: string | null;
  analysisLogs: string[];
  latestReports: Record<string, AnalysisReport>;
  reportHistory: AnalysisReport[];
  reportHistoryTotal: number;

  setRunning: (running: boolean, ticker: string | null) => void;
  addAnalysisLog: (message: string) => void;
  clearAnalysisLogs: () => void;
  setLatestReport: (ticker: string, report: AnalysisReport) => void;
  setReportHistory: (reports: AnalysisReport[], total: number) => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  isRunning: false,
  runningTicker: null,
  analysisLogs: [],
  latestReports: {},
  reportHistory: [],
  reportHistoryTotal: 0,

  setRunning: (running, ticker) => set({ isRunning: running, runningTicker: ticker }),

  addAnalysisLog: (message) =>
    set((state) => ({
      analysisLogs: [...state.analysisLogs, message].slice(-MAX_LOGS),
    })),

  clearAnalysisLogs: () => set({ analysisLogs: [] }),

  setLatestReport: (ticker, report) =>
    set((state) => ({
      latestReports: { ...state.latestReports, [ticker]: report },
    })),

  setReportHistory: (reports, total) =>
    set({ reportHistory: reports, reportHistoryTotal: total }),
}));
