import { useEffect, useRef, useCallback, useState } from 'react';
import { useTradeStore } from '../store/tradeStore';
import { useTrainingStore } from '../store/trainingStore';
import type { WSMessage, ProcessStatus, TraderStatus, Trade, NeuralSignal } from '../services/types';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  const {
    setProcessStatus,
    setTraderStatus,
    addLog,
    addTrade,
  } = useTradeStore();

  const {
    setNeuralSignals,
    addTrainerLog,
  } = useTrainingStore();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      setStatus('connected');
      // Subscribe to all channels
      ws.send(JSON.stringify({
        type: 'subscribe',
        channels: ['logs', 'trader_status', 'process_status', 'neural_signals', 'trades']
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);

        switch (message.type) {
          case 'process_status':
            setProcessStatus(message.data as ProcessStatus);
            break;

          case 'trader_status':
            setTraderStatus(message.data as TraderStatus);
            break;

          case 'log':
            if (message.source === 'trainer') {
              addTrainerLog(message.message || '');
            } else if (message.source === 'runner' || message.source === 'trader') {
              addLog(message.source, message.message || '');
            }
            break;

          case 'trade_executed':
            addTrade(message.data as Trade);
            break;

          case 'neural_signals':
            const signals = message.data as Record<string, NeuralSignal>;
            Object.entries(signals).forEach(([coin, signal]) => {
              setNeuralSignals(coin, signal.long_signal, signal.short_signal);
            });
            break;

          case 'runner_ready':
            // Runner ready is part of process status
            break;

          case 'connected':
          case 'subscribed':
          case 'pong':
            // Acknowledgement messages, no action needed
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

      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 3000);
    };

    wsRef.current = ws;
  }, [setProcessStatus, setTraderStatus, addLog, addTrade, setNeuralSignals, addTrainerLog]);

  const disconnect = useCallback(() => {
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
