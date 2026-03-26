import { useRef, useState } from 'react';
import { useSettingsStore, selectTickers } from '../../store/settingsStore';

interface Props {
  selectedTicker: string;
  onSelect: (ticker: string) => void;
  children?: React.ReactNode;
}

export function DraggableTickerBar({ selectedTicker, onSelect, children }: Props) {
  const tickers = useSettingsStore(selectTickers);
  const reorderTickers = useSettingsStore((s) => s.reorderTickers);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNode = useRef<HTMLButtonElement | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    dragNode.current = e.currentTarget as HTMLButtonElement;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIndex !== null && index !== dragIndex) {
      setOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      reorderTickers(dragIndex, index);
    }
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="flex items-center justify-between gap-2 p-3 border-b border-dark-border bg-dark-bg2">
      <div className="flex items-center gap-1 flex-wrap">
        {tickers.map((ticker, i) => (
          <button
            key={ticker}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            onClick={() => onSelect(ticker)}
            className={`px-4 py-2 text-sm font-medium rounded transition-colors cursor-grab active:cursor-grabbing select-none ${
              selectedTicker === ticker
                ? 'bg-dark-accent text-white'
                : 'bg-dark-panel text-dark-muted hover:text-dark-fg hover:bg-dark-panel2'
            } ${dragIndex === i ? 'opacity-50' : ''} ${
              overIndex === i ? 'ring-2 ring-dark-accent' : ''
            }`}
          >
            {ticker}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
