import { useState, useRef } from 'react';
import { portfolioApi } from '../../services/api';
import { usePortfolioStore } from '../../store/portfolioStore';
import type { ImportPreviewResult, ImportConfirmResult } from '../../services/types';

const REQUIRED_FIELDS = ['date', 'ticker', 'type', 'quantity', 'price'] as const;
const OPTIONAL_FIELDS = ['fees', 'amount'] as const;
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS] as const;

type MappingField = (typeof ALL_FIELDS)[number];

export function ImportWizard() {
  const { selectedId, fetchDashboard, fetchTransactions, setSubView } = usePortfolioStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'map' | 'duplicates' | 'done'>('upload');
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState('AUD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState<{ imported: number } | null>(null);
  const [dupInfo, setDupInfo] = useState<ImportConfirmResult | null>(null);

  const handleUpload = async (file: File) => {
    if (!selectedId) return;
    setLoading(true);
    setError('');
    try {
      const result = await portfolioApi.importPreview(selectedId, file);
      setPreview(result);
      // Initialize mapping from suggested
      const initial: Record<string, string> = {};
      for (const field of ALL_FIELDS) {
        const suggested = result.suggested_mapping[field];
        if (suggested) initial[field] = suggested;
      }
      setMapping(initial);
      setStep('map');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedId || !preview) return;
    // Validate required fields are mapped
    for (const field of REQUIRED_FIELDS) {
      if (!mapping[field]) {
        setError(`Please map the "${field}" column`);
        return;
      }
    }
    setLoading(true);
    setError('');
    try {
      const result = await portfolioApi.importConfirm(
        selectedId, preview.file_id, mapping,
        currency !== 'AUD' ? currency : undefined,
      );
      if (result.status === 'duplicates_found') {
        setDupInfo(result);
        setStep('duplicates');
      } else {
        setImportResult({ imported: result.imported ?? 0 });
        setStep('done');
        fetchDashboard(selectedId);
        fetchTransactions(selectedId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicateChoice = async (choice: 'new_only' | 'import_all') => {
    if (!selectedId || !dupInfo?.file_id) return;
    setLoading(true);
    setError('');
    try {
      const result = await portfolioApi.importConfirm(
        selectedId, dupInfo.file_id, mapping,
        currency !== 'AUD' ? currency : undefined,
        choice === 'import_all' ? { force: true } : { skip_duplicates: true },
      );
      setImportResult({ imported: result.imported ?? 0 });
      setStep('done');
      fetchDashboard(selectedId);
      fetchTransactions(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const updateMapping = (field: MappingField, column: string) => {
    setMapping(prev => {
      const next = { ...prev };
      if (column === '') {
        delete next[field];
      } else {
        next[field] = column;
      }
      return next;
    });
  };

  if (step === 'done' && importResult) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16">
        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-dark-fg mb-2">Import Complete</h2>
          <p className="text-dark-muted">{importResult.imported} transactions imported successfully.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setSubView('dashboard')}
            className="px-5 py-2.5 bg-dark-accent text-white rounded-lg font-medium hover:bg-dark-accent/90 transition-colors"
          >
            View Dashboard
          </button>
          <button
            onClick={() => setSubView('transactions')}
            className="px-5 py-2.5 bg-dark-panel border border-dark-border text-dark-fg rounded-lg font-medium hover:bg-dark-panel2 transition-colors"
          >
            View Transactions
          </button>
        </div>
      </div>
    );
  }

  if (step === 'duplicates' && dupInfo && dupInfo.rows) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-dark-fg mb-1">Review Transactions</h2>
          <p className="text-dark-muted text-sm">
            <span className="text-yellow-400 font-medium">{dupInfo.duplicate_count}</span> of {dupInfo.total_count} transactions already exist.
            Duplicates are highlighted — matched by ticker, date, type, quantity, and price.
          </p>
        </div>

        {/* All rows table with duplicate highlighting */}
        <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
          <div className="px-6 py-3 border-b border-dark-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">
              All Transactions ({dupInfo.total_count})
            </h3>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-yellow-500/20 border border-yellow-500/40" />
                Duplicate ({dupInfo.duplicate_count})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-dark-bg" />
                New ({dupInfo.new_count})
              </span>
            </div>
          </div>
          <div className="overflow-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-dark-panel z-10">
                <tr className="border-b border-dark-border">
                  <th className="px-4 py-2 text-left text-xs text-dark-muted w-8"></th>
                  <th className="px-4 py-2 text-left text-xs text-dark-muted">Date</th>
                  <th className="px-4 py-2 text-left text-xs text-dark-muted">Ticker</th>
                  <th className="px-4 py-2 text-left text-xs text-dark-muted">Type</th>
                  <th className="px-4 py-2 text-right text-xs text-dark-muted">Qty</th>
                  <th className="px-4 py-2 text-right text-xs text-dark-muted">Price</th>
                  <th className="px-4 py-2 text-right text-xs text-dark-muted">Fees</th>
                </tr>
              </thead>
              <tbody>
                {dupInfo.rows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-dark-border last:border-0 ${
                      row.is_duplicate ? 'bg-yellow-500/5' : ''
                    }`}
                  >
                    <td className="px-4 py-1.5 text-center">
                      {row.is_duplicate && (
                        <span className="text-yellow-400 text-xs font-bold" title="Duplicate">DUP</span>
                      )}
                    </td>
                    <td className="px-4 py-1.5 text-dark-fg font-mono text-xs">{row.date}</td>
                    <td className="px-4 py-1.5 text-dark-fg font-mono text-xs">{row.ticker}</td>
                    <td className="px-4 py-1.5 text-dark-fg text-xs">{row.type}</td>
                    <td className="px-4 py-1.5 text-dark-fg font-mono text-xs text-right">{row.quantity}</td>
                    <td className="px-4 py-1.5 text-dark-fg font-mono text-xs text-right">${row.price.toFixed(2)}</td>
                    <td className="px-4 py-1.5 text-dark-muted font-mono text-xs text-right">{row.fees ? `$${row.fees.toFixed(2)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={() => { setStep('map'); setDupInfo(null); setError(''); }}
            className="px-5 py-2.5 bg-dark-panel border border-dark-border text-dark-fg rounded-lg font-medium hover:bg-dark-panel2 transition-colors"
          >
            Back
          </button>
          {dupInfo.new_count! > 0 && (
            <button
              onClick={() => handleDuplicateChoice('new_only')}
              disabled={loading}
              className="px-5 py-2.5 bg-dark-accent text-white rounded-lg font-medium hover:bg-dark-accent/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Importing...' : `Import ${dupInfo.new_count} New Only`}
            </button>
          )}
          <button
            onClick={() => handleDuplicateChoice('import_all')}
            disabled={loading}
            className="px-5 py-2.5 bg-dark-panel border border-dark-border text-dark-fg rounded-lg font-medium hover:bg-dark-panel2 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Importing...' : `Import All ${dupInfo.total_count}`}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'map' && preview) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-dark-fg mb-1">Map Columns</h2>
          <p className="text-dark-muted text-sm">
            {preview.row_count} rows found. Map your file columns to transaction fields.
          </p>
        </div>

        {/* Currency Selection */}
        <div className="bg-dark-panel border border-dark-border rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div>
              <label className="text-xs font-semibold text-dark-muted uppercase tracking-wider block mb-1.5">
                File Currency *
              </label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="py-2 px-3 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-sm focus:ring-dark-accent focus:border-dark-accent"
              >
                <option value="AUD">AUD — Australian Dollar</option>
                <option value="USD">USD — US Dollar</option>
              </select>
            </div>
            {currency === 'USD' && (
              <p className="text-xs text-dark-muted mt-4">
                Prices will be stored in USD and converted to AUD for display using live exchange rates.
              </p>
            )}
          </div>
        </div>

        {/* Column Mapping */}
        <div className="bg-dark-panel border border-dark-border rounded-xl p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ALL_FIELDS.map(field => (
              <div key={field}>
                <label className="text-xs font-semibold text-dark-muted uppercase tracking-wider block mb-1.5">
                  {field} {REQUIRED_FIELDS.includes(field as typeof REQUIRED_FIELDS[number]) ? '*' : '(optional)'}
                </label>
                <select
                  value={mapping[field] || ''}
                  onChange={e => updateMapping(field, e.target.value)}
                  className="w-full py-2 px-3 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-sm focus:ring-dark-accent focus:border-dark-accent"
                >
                  <option value="">-- Select column --</option>
                  {preview.columns.map(col => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Sample Preview */}
        <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
          <div className="px-6 py-3 border-b border-dark-border">
            <h3 className="text-sm font-semibold text-dark-muted uppercase tracking-wider">
              Preview ({preview.sample_rows.length} rows)
            </h3>
          </div>
          <div className="overflow-auto max-h-80">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border">
                  {preview.columns.map(col => {
                    const mappedTo = Object.entries(mapping).find(([, v]) => v === col)?.[0];
                    return (
                      <th key={col} className="px-4 py-2 text-left text-xs text-dark-muted whitespace-nowrap">
                        {col}
                        {mappedTo && (
                          <span className="ml-1.5 px-1.5 py-0.5 bg-dark-accent/20 text-dark-accent rounded text-[10px] font-bold uppercase">
                            {mappedTo}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {preview.sample_rows.map((row, i) => (
                  <tr key={i} className="border-b border-dark-border last:border-0">
                    {preview.columns.map(col => (
                      <td key={col} className="px-4 py-2 text-dark-fg whitespace-nowrap font-mono text-xs">
                        {row[col] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={() => { setStep('upload'); setPreview(null); setError(''); }}
            className="px-5 py-2.5 bg-dark-panel border border-dark-border text-dark-fg rounded-lg font-medium hover:bg-dark-panel2 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-5 py-2.5 bg-dark-accent text-white rounded-lg font-medium hover:bg-dark-accent/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Checking...' : `Import ${preview.row_count} Transactions`}
          </button>
        </div>
      </div>
    );
  }

  // Upload step
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-dark-fg mb-1">Import Transactions</h2>
        <p className="text-dark-muted text-sm">
          Upload a CSV or XLSX file from your broker. Supported formats include BetaShares, Sharesight, and most standard broker exports.
        </p>
      </div>

      <div
        className="border-2 border-dashed border-dark-border rounded-xl p-12 text-center hover:border-dark-accent/50 transition-colors cursor-pointer"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const file = e.dataTransfer.files[0];
          if (file) handleUpload(file);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-4 text-dark-muted">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="text-dark-fg font-medium mb-1">
          {loading ? 'Processing...' : 'Drop file here or click to browse'}
        </p>
        <p className="text-dark-muted text-sm">CSV or XLSX files supported</p>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
    </div>
  );
}
