import { useEffect, useRef } from 'react';

interface LogViewerProps {
  logs: string[];
  className?: string;
  autoScroll?: boolean;
}

export function LogViewer({ logs, className = '', autoScroll = true }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  return (
    <div
      ref={containerRef}
      className={`overflow-auto bg-dark-panel p-3 font-mono text-xs leading-relaxed ${className}`}
    >
      {logs.length === 0 ? (
        <span className="text-dark-muted">No logs yet...</span>
      ) : (
        logs.map((log, i) => (
          <div key={i} className="text-dark-fg whitespace-pre-wrap break-all">
            {log}
          </div>
        ))
      )}
    </div>
  );
}
