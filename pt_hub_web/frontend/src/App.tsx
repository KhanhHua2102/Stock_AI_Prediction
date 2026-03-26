import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useSettingsStore } from './store/settingsStore';
import { settingsApi } from './services/api';
import { TrainingTab } from './components/training/TrainingTab';
import { ChartsTab } from './components/charts/ChartsTab';
import { PredictionsTab } from './components/predictions/PredictionsTab';
import { AnalysisTab } from './components/analysis/AnalysisTab';
import { PortfolioTab } from './components/portfolio/PortfolioTab';
import { Header } from './components/common/Header';
import { SettingsModal } from './components/common/SettingsModal';

const TAB_LABELS: Record<string, string> = {
  training: 'Training',
  predictions: 'Predictions',
  charts: 'Charts',
  analysis: 'Analysis',
  portfolio: 'Portfolio',
};

const TAB_COMPONENTS: Record<string, React.FC> = {
  training: TrainingTab,
  predictions: PredictionsTab,
  charts: ChartsTab,
  analysis: AnalysisTab,
  portfolio: PortfolioTab,
};

function App() {
  const { status } = useWebSocket();
  const { activeTab, setActiveTab, setSettings, tabOrder, reorderTabs } = useSettingsStore();
  const [showSettings, setShowSettings] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragNode = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    settingsApi.get().then(setSettings).catch(console.error);
  }, [setSettings]);

  const handleDragStart = (e: React.DragEvent<HTMLButtonElement>, index: number) => {
    setDragIndex(index);
    dragNode.current = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
    // Make the drag image slightly transparent
    requestAnimationFrame(() => {
      if (dragNode.current) dragNode.current.style.opacity = '0.4';
    });
  };

  const handleDragEnd = () => {
    if (dragNode.current) dragNode.current.style.opacity = '1';
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      reorderTabs(dragIndex, dragOverIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragNode.current = null;
  };

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) setDragOverIndex(index);
  };

  const ActiveComponent = TAB_COMPONENTS[activeTab];

  return (
    <div className="flex flex-col h-screen bg-dark-bg">
      <Header connectionStatus={status} />

      {/* Tab Navigation */}
      <div className="flex border-b border-dark-border bg-dark-bg2">
        {tabOrder.map((tabId, index) => (
          <TabButton
            key={tabId}
            active={activeTab === tabId}
            onClick={() => setActiveTab(tabId)}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            showDropIndicator={dragOverIndex === index && dragIndex !== index}
            dropSide={dragIndex !== null && dragOverIndex === index ? (dragIndex < index ? 'right' : 'left') : null}
          >
            {TAB_LABELS[tabId]}
          </TabButton>
        ))}
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
        {ActiveComponent && <ActiveComponent />}
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  showDropIndicator,
  dropSide,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent<HTMLButtonElement>) => void;
  showDropIndicator?: boolean;
  dropSide?: 'left' | 'right' | null;
}) {
  return (
    <button
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      className={`relative px-6 py-3 text-sm font-medium transition-colors cursor-grab active:cursor-grabbing select-none ${
        active
          ? 'text-dark-accent border-b-2 border-dark-accent bg-dark-panel'
          : 'text-dark-muted hover:text-dark-fg hover:bg-dark-panel'
      }`}
    >
      {showDropIndicator && dropSide === 'left' && (
        <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-dark-accent rounded" />
      )}
      {children}
      {showDropIndicator && dropSide === 'right' && (
        <span className="absolute right-0 top-1 bottom-1 w-0.5 bg-dark-accent rounded" />
      )}
    </button>
  );
}

export default App;
