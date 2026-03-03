import { useMemo } from 'react';

interface NeuralTileProps {
  coin: string;
  longSignal: number; // 0-7
  shortSignal: number; // 0-7
  onClick: () => void;
}

export function NeuralTile({ coin, longSignal, shortSignal, onClick }: NeuralTileProps) {
  const longBars = useMemo(
    () => Array.from({ length: 7 }, (_, i) => i < longSignal),
    [longSignal]
  );

  const shortBars = useMemo(
    () => Array.from({ length: 7 }, (_, i) => i < shortSignal),
    [shortSignal]
  );

  return (
    <div
      onClick={onClick}
      className="w-24 p-2 bg-dark-panel rounded border border-dark-border hover:border-dark-accent2 cursor-pointer transition-colors"
    >
      {/* Coin label */}
      <div className="text-xs font-medium text-dark-fg text-center mb-2">{coin}</div>

      {/* Signal bars */}
      <div className="flex justify-center gap-2 mb-2">
        {/* Long signal (blue) */}
        <div className="flex flex-col-reverse gap-0.5">
          {longBars.map((active, i) => (
            <div
              key={i}
              className={`w-4 h-2 rounded-sm transition-colors ${
                active ? 'bg-blue-500' : 'bg-dark-bg2'
              }`}
            />
          ))}
          {/* Trade trigger line after 2nd bar */}
          <div className="relative">
            <div
              className="absolute w-full h-px bg-dark-muted"
              style={{ bottom: '8px' }}
            />
          </div>
        </div>

        {/* Short signal (orange) */}
        <div className="flex flex-col-reverse gap-0.5">
          {shortBars.map((active, i) => (
            <div
              key={i}
              className={`w-4 h-2 rounded-sm transition-colors ${
                active ? 'bg-orange-500' : 'bg-dark-bg2'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Values */}
      <div className="flex justify-center gap-2 text-xs">
        <span className="text-blue-500">L:{longSignal}</span>
        <span className="text-orange-500">S:{shortSignal}</span>
      </div>
    </div>
  );
}
