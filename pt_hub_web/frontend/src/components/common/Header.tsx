interface HeaderProps {
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
}

export function Header({ connectionStatus }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-3 bg-dark-bg2 border-b border-dark-border">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-dark-fg">Stock AI Prediction</h1>
      </div>

      <ConnectionIndicator status={connectionStatus} />
    </header>
  );
}

function ConnectionIndicator({ status }: { status: string }) {
  const statusConfig = {
    connected: { color: 'bg-dark-accent', text: 'Connected' },
    connecting: { color: 'bg-yellow-500 animate-pulse', text: 'Connecting...' },
    disconnected: { color: 'bg-red-500', text: 'Disconnected' },
  }[status] ?? { color: 'bg-dark-muted', text: 'Unknown' };

  return (
    <div className="flex items-center gap-2 text-xs text-dark-muted">
      <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
      <span>{statusConfig.text}</span>
    </div>
  );
}
