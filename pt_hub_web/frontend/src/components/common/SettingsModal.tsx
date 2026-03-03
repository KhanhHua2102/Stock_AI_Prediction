import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { settingsApi } from '../../services/api';

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, setSettings } = useSettingsStore();
  const [tickers, setTickers] = useState<string[]>(settings?.tickers ?? []);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await settingsApi.searchTicker(query.trim());
        setResults(data.results.filter((r) => !tickers.includes(r.symbol)));
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, tickers]);

  const addTicker = (symbol: string) => {
    if (!tickers.includes(symbol)) {
      setTickers([...tickers, symbol]);
    }
    setQuery('');
    setResults([]);
    inputRef.current?.focus();
  };

  const removeTicker = (symbol: string) => {
    setTickers(tickers.filter((t) => t !== symbol));
  };

  const handleSave = async () => {
    if (tickers.length === 0) {
      setError('Must have at least one ticker');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await settingsApi.updateTickers(tickers);
      setSettings(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
    setSaving(false);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md bg-dark-bg2 border border-dark-border rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-border">
          <h2 className="text-sm font-semibold text-dark-fg">Manage Tickers</h2>
          <button onClick={onClose} className="text-dark-muted hover:text-dark-fg text-lg leading-none">&times;</button>
        </div>

        <div className="px-4 pt-3 relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker (e.g. AAPL, VNM, BHP.AX)..."
            className="w-full px-3 py-2 text-sm bg-dark-panel border border-dark-border rounded text-dark-fg placeholder-dark-muted focus:outline-none focus:border-dark-accent"
          />
          {searching && (
            <span className="absolute right-6 top-5 text-xs text-dark-muted">Searching...</span>
          )}

          {results.length > 0 && (
            <div className="absolute left-4 right-4 mt-1 bg-dark-panel border border-dark-border rounded shadow-lg max-h-48 overflow-y-auto z-10">
              {results.map((r) => (
                <button
                  key={r.symbol}
                  onClick={() => addTicker(r.symbol)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-dark-panel2 transition-colors"
                >
                  <div>
                    <span className="text-sm font-medium text-dark-accent">{r.symbol}</span>
                    <span className="text-xs text-dark-muted ml-2">{r.name}</span>
                  </div>
                  {r.exchange && <span className="text-xs text-dark-muted">{r.exchange}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3">
          <span className="text-xs text-dark-muted">Current tickers ({tickers.length})</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {tickers.map((ticker) => (
              <span key={ticker} className="inline-flex items-center gap-1 px-2.5 py-1 text-sm bg-dark-panel border border-dark-border rounded">
                <span className="text-dark-fg">{ticker}</span>
                <button onClick={() => removeTicker(ticker)} className="text-dark-muted hover:text-red-500 text-xs leading-none ml-1">&times;</button>
              </span>
            ))}
            {tickers.length === 0 && <span className="text-xs text-dark-muted">No tickers added</span>}
          </div>
        </div>

        {error && <div className="px-4 pb-2 text-xs text-red-500">{error}</div>}

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-dark-border">
          <button onClick={onClose} className="px-4 py-1.5 text-xs text-dark-muted hover:text-dark-fg rounded">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-xs font-medium bg-dark-accent text-dark-bg rounded hover:bg-opacity-80 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
