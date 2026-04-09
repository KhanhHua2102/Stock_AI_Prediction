import { create } from 'zustand';
import type { AgentInfo, MultiAgentReport } from '../services/types';

const MAX_LOGS = 500;

interface MultiAgentState {
  availableAgents: AgentInfo[];
  selectedAgentIds: string[];
  isRunning: boolean;
  runningTickers: string[];
  logs: string[];
  latestReports: Record<string, MultiAgentReport>;
  reportHistory: MultiAgentReport[];
  reportHistoryTotal: number;

  setAvailableAgents: (agents: AgentInfo[]) => void;
  setSelectedAgents: (ids: string[]) => void;
  toggleAgent: (id: string) => void;
  selectCategory: (category: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setRunning: (running: boolean, tickers?: string[]) => void;
  addLog: (message: string) => void;
  clearLogs: () => void;
  setLatestReport: (ticker: string, report: MultiAgentReport) => void;
  setReportHistory: (reports: MultiAgentReport[], total: number) => void;
  setComplete: (reports: MultiAgentReport[]) => void;
}

export const useMultiAgentStore = create<MultiAgentState>((set) => ({
  availableAgents: [],
  selectedAgentIds: [],
  isRunning: false,
  runningTickers: [],
  logs: [],
  latestReports: {},
  reportHistory: [],
  reportHistoryTotal: 0,

  setAvailableAgents: (agents) => set({ availableAgents: agents }),

  setSelectedAgents: (ids) => set({ selectedAgentIds: ids }),

  toggleAgent: (id) =>
    set((s) => ({
      selectedAgentIds: s.selectedAgentIds.includes(id)
        ? s.selectedAgentIds.filter((a) => a !== id)
        : [...s.selectedAgentIds, id],
    })),

  selectCategory: (category) =>
    set((s) => ({
      selectedAgentIds: [
        ...new Set([
          ...s.selectedAgentIds,
          ...s.availableAgents.filter((a) => a.category === category).map((a) => a.id),
        ]),
      ],
    })),

  selectAll: () => set((s) => ({ selectedAgentIds: s.availableAgents.map((a) => a.id) })),

  deselectAll: () => set({ selectedAgentIds: [] }),

  setRunning: (running, tickers) => set({ isRunning: running, runningTickers: tickers || [] }),

  addLog: (message) => set((s) => ({ logs: [...s.logs, message].slice(-MAX_LOGS) })),

  clearLogs: () => set({ logs: [] }),

  setLatestReport: (ticker, report) =>
    set((s) => ({ latestReports: { ...s.latestReports, [ticker]: report } })),

  setReportHistory: (reports, total) => set({ reportHistory: reports, reportHistoryTotal: total }),

  setComplete: (reports) =>
    set((s) => {
      const updated = { ...s.latestReports };
      for (const r of reports) {
        updated[r.ticker] = r;
      }
      return { latestReports: updated, isRunning: false, runningTickers: [] };
    }),
}));
