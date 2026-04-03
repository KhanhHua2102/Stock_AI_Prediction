import { useRef, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/modal';
import { Button } from '@heroui/button';
import { Input } from '@heroui/input';
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

  // Backup state
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await settingsApi.searchTicker(value.trim());
        setResults(data.results.filter((r) => !tickers.includes(r.symbol)));
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 400);
  };

  const addTicker = (symbol: string) => {
    if (!tickers.includes(symbol)) {
      setTickers([...tickers, symbol]);
    }
    setQuery('');
    setResults([]);
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

  const handleExport = async () => {
    setExporting(true);
    setBackupMsg(null);
    try {
      await settingsApi.exportBackup();
      setBackupMsg({ type: 'success', text: 'Backup downloaded successfully' });
    } catch (err) {
      setBackupMsg({ type: 'error', text: err instanceof Error ? err.message : 'Export failed' });
    }
    setExporting(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setConfirmRestore(file);
      setBackupMsg(null);
    }
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleRestore = async () => {
    if (!confirmRestore) return;
    setImporting(true);
    setBackupMsg(null);
    try {
      const result = await settingsApi.importBackup(confirmRestore);
      setBackupMsg({
        type: 'success',
        text: `Restored: ${result.restored.join(', ')}. Please restart the app.`,
      });
    } catch (err) {
      setBackupMsg({ type: 'error', text: err instanceof Error ? err.message : 'Import failed' });
    }
    setConfirmRestore(null);
    setImporting(false);
  };

  return (
    <Modal isOpen={true} onClose={onClose} size="2xl">
      <ModalContent>
        <ModalHeader className="text-sm font-semibold" style={{ color: '#ECEDEE' }}>
          Settings
        </ModalHeader>

        <ModalBody className="space-y-6">
          {/* ── Section 1: Manage Tickers ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#a1a1aa' }}>
              Manage Tickers
            </h3>

            {/* Search */}
            <div className="relative">
              <Input
                autoFocus
                placeholder="Search ticker (e.g. AAPL, VNM, BHP.AX)..."
                value={query}
                onValueChange={handleQueryChange}
                variant="bordered"
                size="sm"
              />
              {searching && (
                <span className="absolute right-3 top-2.5 text-xs" style={{ color: '#a1a1aa' }}>Searching...</span>
              )}

              {results.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 rounded-xl max-h-48 overflow-y-auto z-10 p-1 shadow-lg" style={{ background: '#18181b', border: '1px solid #27272a' }}>
                  {results.map((r) => (
                    <Button
                      key={r.symbol}
                      variant="light"
                      size="sm"
                      onClick={() => addTicker(r.symbol)}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left rounded-lg"
                    >
                      <div>
                        <span className="text-sm font-medium" style={{ color: '#17c964' }}>{r.symbol}</span>
                        <span className="text-xs ml-2" style={{ color: '#a1a1aa' }}>{r.name}</span>
                      </div>
                      {r.exchange && <span className="text-xs" style={{ color: '#a1a1aa' }}>{r.exchange}</span>}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {/* Current Tickers */}
            <div className="mt-3">
              <span className="text-xs font-medium" style={{ color: '#a1a1aa' }}>Current tickers ({tickers.length})</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {tickers.map((ticker) => (
                  <span key={ticker} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full" style={{ background: '#27272a' }}>
                    <span style={{ color: '#ECEDEE' }}>{ticker}</span>
                    <button onClick={() => removeTicker(ticker)} className="text-xs leading-none ml-0.5 transition-colors" style={{ color: '#a1a1aa' }}>&times;</button>
                  </span>
                ))}
                {tickers.length === 0 && <span className="text-xs" style={{ color: '#a1a1aa' }}>No tickers added</span>}
              </div>
            </div>

            {error && <div className="text-xs mt-2" style={{ color: '#f31260' }}>{error}</div>}
          </section>

          {/* ── Divider ── */}
          <div style={{ borderTop: '1px solid #27272a' }} />

          {/* ── Section 2: Data Backup ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#a1a1aa' }}>
              Data Backup
            </h3>
            <p className="text-xs mb-4" style={{ color: '#71717a' }}>
              Export or import all your data including portfolio, analysis history, expenses, property, and receipts.
            </p>

            <div className="flex gap-3">
              {/* Export */}
              <Button
                size="sm"
                variant="bordered"
                onClick={handleExport}
                isDisabled={exporting}
                startContent={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                }
              >
                {exporting ? 'Exporting...' : 'Export Backup'}
              </Button>

              {/* Import */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                size="sm"
                variant="bordered"
                onClick={() => fileInputRef.current?.click()}
                isDisabled={importing}
                startContent={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                }
              >
                Import Backup
              </Button>
            </div>

            {/* Confirm restore dialog */}
            {confirmRestore && (
              <div className="mt-3 p-3 rounded-lg" style={{ background: '#27272a', border: '1px solid #f5a524' }}>
                <p className="text-xs font-medium mb-2" style={{ color: '#f5a524' }}>
                  Restore from "{confirmRestore.name}"?
                </p>
                <p className="text-xs mb-3" style={{ color: '#a1a1aa' }}>
                  This will overwrite your current data. Existing databases will be backed up as .bak files. You will need to restart the app after restore.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" color="warning" onClick={handleRestore} isDisabled={importing}>
                    {importing ? 'Restoring...' : 'Confirm Restore'}
                  </Button>
                  <Button size="sm" variant="light" onClick={() => setConfirmRestore(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Status message */}
            {backupMsg && (
              <div
                className="mt-3 text-xs px-3 py-2 rounded-lg"
                style={{
                  color: backupMsg.type === 'success' ? '#17c964' : '#f31260',
                  background: backupMsg.type === 'success' ? 'rgba(23,201,100,0.1)' : 'rgba(243,18,96,0.1)',
                }}
              >
                {backupMsg.text}
              </div>
            )}
          </section>
        </ModalBody>

        <ModalFooter>
          <Button variant="light" size="sm" onClick={onClose}>Cancel</Button>
          <Button color="primary" size="sm" onClick={handleSave} isDisabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
