import { useEffect, useRef, useCallback, useState } from 'react';
import { useTradeStore } from '../store/tradeStore';
import { useTrainingStore } from '../store/trainingStore';
import { useAnalysisStore } from '../store/analysisStore';
import { useSettingsStore } from '../store/settingsStore';
import { useMultiAgentStore } from '../store/multiAgentStore';
import type { WSMessage, ProcessStatus, NeuralSignal, AnalysisReport } from '../services/types';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const intentionalDisconnectRef = useRef(false);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  const {
    setProcessStatus,
    addLog,
  } = useTradeStore();

  const {
    setNeuralSignals,
    addTrainerLog,
  } = useTrainingStore();

  const {
    addAnalysisLog,
    setRunning: setAnalysisRunning,
    setLatestReport,
  } = useAnalysisStore();

  const { addLog: addMultiAgentLog, setRunning: setMultiAgentRunning, setComplete: setMultiAgentComplete } = useMultiAgentStore();

  const wsToken = useSettingsStore((s) => s.settings?.ws_token);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    intentionalDisconnectRef.current = false;
    setStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const tokenParam = wsToken ? `?api_key=${encodeURIComponent(wsToken)}` : '';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws${tokenParam}`);

    ws.onopen = () => {
      setStatus('connected');
      ws.send(JSON.stringify({
        type: 'subscribe',
        channels: ['logs', 'process_status', 'neural_signals', 'analysis_logs']
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);

        switch (message.type) {
          case 'process_status':
            setProcessStatus(message.data as ProcessStatus);
            break;

          case 'log':
            if (message.source === 'trainer') {
              addTrainerLog(message.message || '', message.ticker || undefined);
            } else if (message.source === 'runner') {
              addLog('runner', message.message || '');
            }
            break;

          case 'neural_signals':
            const signals = message.data as Record<string, NeuralSignal>;
            Object.entries(signals).forEach(([ticker, signal]) => {
              setNeuralSignals(ticker, signal.long_signal, signal.short_signal);
            });
            break;

          case 'analysis_log':
            addAnalysisLog(message.message || '');
            break;

          case 'analysis_complete': {
            const report = message.data as AnalysisReport;
            setAnalysisRunning(false, null);
            if (report?.ticker) {
              setLatestReport(report.ticker, report);
              // Notify portfolio analysis queue if running
              import('../store/portfolioAnalysisStore').then(({ usePortfolioAnalysisStore }) => {
                const paState = usePortfolioAnalysisStore.getState();
                if (paState.isRunning) {
                  paState.onTickerComplete(report.ticker, report);
                }
              });
            }
            break;
          }

          case 'analysis_cancelled': {
            setAnalysisRunning(false, null);
            const ticker = message.ticker;
            if (ticker) {
              import('../store/portfolioAnalysisStore').then(({ usePortfolioAnalysisStore }) => {
                const paState = usePortfolioAnalysisStore.getState();
                if (paState.isRunning) {
                  paState.onTickerComplete(ticker, null as unknown as AnalysisReport);
                }
              });
            }
            break;
          }

          case 'multi_agent_log':
            addMultiAgentLog(message.message || '');
            break;
          case 'multi_agent_complete':
            setMultiAgentRunning(false);
            if (Array.isArray(message.data)) {
              setMultiAgentComplete(message.data);
            }
            break;
          case 'multi_agent_cancelled':
            setMultiAgentRunning(false);
            addMultiAgentLog('[Multi-Agent] Analysis cancelled');
            break;

          case 'runner_ready':
          case 'connected':
          case 'subscribed':
          case 'pong':
            break;
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onerror = () => {
      setStatus('disconnected');
    };

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;

      if (!intentionalDisconnectRef.current) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 3000);
      }
    };

    wsRef.current = ws;
  }, [setProcessStatus, addLog, setNeuralSignals, addTrainerLog, addAnalysisLog, setAnalysisRunning, setLatestReport, addMultiAgentLog, setMultiAgentRunning, setMultiAgentComplete, wsToken]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('disconnected');
  }, []);

  const sendMessage = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const refresh = useCallback((target: string) => {
    sendMessage({ type: 'refresh', target });
  }, [sendMessage]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    status,
    sendMessage,
    refresh,
    reconnect: connect,
  };
}
