import { useState } from 'react';
import { useMultiAgentStore } from '../../store/multiAgentStore';
import { multiAgentApi } from '../../services/api';
import { AgentSelector } from './AgentSelector';
import { AgentPerspectiveCard } from './AgentPerspectiveCard';
import { ConsensusPanel } from './ConsensusPanel';
import { DebateTimeline } from './DebateTimeline';
import { MultiAgentLogStream } from './MultiAgentLogStream';

export function MultiAgentView() {
  const [tickers, setTickers] = useState('');
  const [enableRiskReasoning, setEnableRiskReasoning] = useState(false);

  const { selectedAgentIds, isRunning, latestReports, setRunning, clearLogs } =
    useMultiAgentStore();

  const handleRun = async () => {
    const tickerList = tickers
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    if (tickerList.length === 0 || selectedAgentIds.length === 0) return;

    clearLogs();
    setRunning(true, tickerList);

    try {
      await multiAgentApi.run({
        tickers: tickerList,
        agents: selectedAgentIds,
        enable_risk_reasoning: enableRiskReasoning,
      });
    } catch (e) {
      console.error('Multi-agent run failed:', e);
      setRunning(false, []);
    }
  };

  const tickerList = tickers
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const tickersWithReports = tickerList.filter(
    (t) => latestReports[t] && latestReports[t].agent_signals?.length > 0,
  );

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-6 max-w-6xl mx-auto">
        {/* Agent selector */}
        <div
          className="rounded-xl p-4"
          style={{ background: '#18181b', border: '1px solid #27272a' }}
        >
          <AgentSelector
            tickers={tickers}
            onTickersChange={setTickers}
            enableRiskReasoning={enableRiskReasoning}
            onRiskReasoningChange={setEnableRiskReasoning}
            onRun={handleRun}
            isRunning={isRunning}
          />
        </div>

        {/* Live log stream while running */}
        {isRunning && <MultiAgentLogStream />}

        {/* Per-ticker results */}
        {tickersWithReports.map((ticker) => {
          const report = latestReports[ticker];
          const sortedSignals = [...(report.agent_signals ?? [])].sort(
            (a, b) => b.confidence - a.confidence,
          );

          const debateRounds =
            (report.debate_rounds as unknown as import('./DebateTimeline').DebateRound[] | undefined) ?? [];

          return (
            <div key={ticker} className="space-y-4">
              <h3
                className="text-lg font-semibold font-mono"
                style={{ color: '#ECEDEE' }}
              >
                {ticker}
              </h3>

              <div className="grid grid-cols-3 gap-4">
                {/* Left 2/3 — agent cards */}
                <div className="col-span-2 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {sortedSignals.map((signal, i) => (
                      <AgentPerspectiveCard key={i} signal={signal} />
                    ))}
                  </div>
                </div>

                {/* Right 1/3 — consensus + debate */}
                <div className="col-span-1 space-y-4">
                  <ConsensusPanel report={report} />
                  {debateRounds.length > 0 && (
                    <DebateTimeline rounds={debateRounds} />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Log review after completion */}
        {!isRunning && tickersWithReports.length > 0 && <MultiAgentLogStream />}
      </div>
    </div>
  );
}
