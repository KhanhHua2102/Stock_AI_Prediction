import { useEffect, useRef, useMemo } from 'react';

export function AnalysisLogStream({ logs }: { logs: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const formattedLines = useMemo(() => {
    const raw = logs.join('');
    return raw
      .split(/(?<=\.{3})/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [logs]);

  if (formattedLines.length === 0) return null;

  return (
    <div className="bg-dark-panel rounded-lg border border-dark-border">
      <div className="px-4 py-2 border-b border-dark-border">
        <h3 className="text-sm font-medium text-dark-muted">Analysis Logs</h3>
      </div>
      <div
        ref={containerRef}
        className="p-4 max-h-[300px] overflow-auto font-mono text-xs text-dark-fg leading-relaxed"
      >
        {formattedLines.map((line, i) => (
          <div key={i} className="py-0.5">
            <span className="text-dark-muted mr-2">•</span>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
