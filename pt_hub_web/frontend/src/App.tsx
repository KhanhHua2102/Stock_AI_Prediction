import { useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useSettingsStore } from './store/settingsStore';
import { settingsApi } from './services/api';
import { TradeTab } from './components/trade/TradeTab';
import { TrainingTab } from './components/training/TrainingTab';
import { ChartsTab } from './components/charts/ChartsTab';
import { AccountTab } from './components/account/AccountTab';
import { Header } from './components/common/Header';

function App() {
  const { status } = useWebSocket();
  const { activeTab, setActiveTab, setSettings } = useSettingsStore();

  // Load settings on mount
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
          Trade
        </TabButton>
        <TabButton
          active={activeTab === 'training'}
          onClick={() => setActiveTab('training')}
        >
          Training
        </TabButton>
        <TabButton
          active={activeTab === 'charts'}
          onClick={() => setActiveTab('charts')}
        >
          Charts
        </TabButton>
        <TabButton
          active={activeTab === 'account'}
          onClick={() => setActiveTab('account')}
        >
          Account
        </TabButton>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'trade' && <TradeTab />}
        {activeTab === 'training' && <TrainingTab />}
        {activeTab === 'charts' && <ChartsTab />}
        {activeTab === 'account' && <AccountTab />}
      </div>
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
