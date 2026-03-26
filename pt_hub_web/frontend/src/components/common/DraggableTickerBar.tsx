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
    <div
      className="flex items-center justify-between gap-2 px-3 py-2 mx-3 mt-2 shrink-0 rounded-xl"
      style={{ background: '#18181b', border: '1px solid #27272a' }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        {tickers.map((ticker, i) => {
          const isActive = selectedTicker === ticker;
          return (
            <button
              key={ticker}
              draggable
              onDragStart={(e) => handleDragStart(e, i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => handleDrop(e, i)}
              onDragEnd={handleDragEnd}
              onClick={() => onSelect(ticker)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all duration-200 cursor-grab active:cursor-grabbing select-none ${
                dragIndex === i ? 'opacity-50' : ''
              } ${overIndex === i ? 'ring-2 ring-indigo-400/40' : ''}`}
              style={{
                background: isActive ? '#006FEE' : '#27272a',
                color: isActive ? '#ffffff' : '#a1a1aa',
              }}
            >
              {ticker}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
