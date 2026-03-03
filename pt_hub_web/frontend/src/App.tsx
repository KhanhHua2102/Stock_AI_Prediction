import { useEffect, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useSettingsStore } from './store/settingsStore';
import { settingsApi } from './services/api';
import { TradeTab } from './components/trade/TradeTab';
import { TrainingTab } from './components/training/TrainingTab';
import { ChartsTab } from './components/charts/ChartsTab';
import { PredictionsTab } from './components/predictions/PredictionsTab';
import { Header } from './components/common/Header';
import { SettingsModal } from './components/common/SettingsModal';

function App() {
  const { status } = useWebSocket();
  const { activeTab, setActiveTab, setSettings } = useSettingsStore();
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    settingsApi.get().then(setSettings).catch(console.error);
  }, [setSettings]);

  return (
    <div className="flex flex-col h-screen bg-dark-bg">
      <Header connectionStatus={status} />

      {/* Tab Navigation */}
      <div className="flex border-b border-dark-border bg-dark-bg2">
        <TabButton
          active={activeTab === 'trade'}
          onClick={() => setActiveTab('trade')}
        >
          Runner
        </TabButton>
        <TabButton
          active={activeTab === 'training'}
          onClick={() => setActiveTab('training')}
        >
          Training
        </TabButton>
        <TabButton
          active={activeTab === 'predictions'}
          onClick={() => setActiveTab('predictions')}
        >
          Predictions
        </TabButton>
        <TabButton
          active={activeTab === 'charts'}
          onClick={() => setActiveTab('charts')}
        >
          Charts
        </TabButton>
        <div className="flex-1" />
        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-3 text-dark-muted hover:text-dark-fg hover:bg-dark-panel transition-colors border-l border-dark-border"
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.86 1.45a1.2 1.2 0 0 1 2.28 0l.3.9a1.2 1.2 0 0 0 1.52.72l.88-.34a1.2 1.2 0 0 1 1.61 1.61l-.34.88a1.2 1.2 0 0 0 .72 1.52l.9.3a1.2 1.2 0 0 1 0 2.28l-.9.3a1.2 1.2 0 0 0-.72 1.52l.34.88a1.2 1.2 0 0 1-1.61 1.61l-.88-.34a1.2 1.2 0 0 0-1.52.72l-.3.9a1.2 1.2 0 0 1-2.28 0l-.3-.9a1.2 1.2 0 0 0-1.52-.72l-.88.34a1.2 1.2 0 0 1-1.61-1.61l.34-.88a1.2 1.2 0 0 0-.72-1.52l-.9-.3a1.2 1.2 0 0 1 0-2.28l.9-.3a1.2 1.2 0 0 0 .72-1.52l-.34-.88A1.2 1.2 0 0 1 4.16 1.73l.88.34a1.2 1.2 0 0 0 1.52-.72l.3-.9z" />
            <circle cx="8" cy="8" r="2.5" />
          </svg>
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'trade' && <TradeTab />}
        {activeTab === 'training' && <TrainingTab />}
        {activeTab === 'predictions' && <PredictionsTab />}
        {activeTab === 'charts' && <ChartsTab />}
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-3 text-sm font-medium transition-colors ${
        active
          ? 'text-dark-accent border-b-2 border-dark-accent bg-dark-panel'
          : 'text-dark-muted hover:text-dark-fg hover:bg-dark-panel'
      }`}
    >
      {children}
    </button>
  );
}

export default App;
