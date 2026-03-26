import { useEffect, useState } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { PortfolioDashboard } from './PortfolioDashboard';
import { TransactionsView } from './TransactionsView';
import { ImportWizard } from './ImportWizard';
import { OptimizeView } from './OptimizeView';

type SubView = 'dashboard' | 'transactions' | 'import' | 'optimize';

const SUB_TABS: { key: SubView; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'import', label: 'Import' },
  { key: 'optimize', label: 'Optimize' },
];

export function PortfolioTab() {
  const { portfolios, selectedId, loading, subView, setSubView, fetchPortfolios, selectPortfolio, createPortfolio, deletePortfolio } = usePortfolioStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    fetchPortfolios();
  }, [fetchPortfolios]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      setCreateError('Name is required');
      return;
    }
    setCreateError('');
    try {
      await createPortfolio(newName.trim());
      setNewName('');
      setShowCreate(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create portfolio');
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const name = portfolios.find(p => p.id === selectedId)?.name;
    if (!confirm(`Delete portfolio "${name}"? This will remove all transactions and data.`)) return;
    await deletePortfolio(selectedId);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Portfolio Selector Bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-dark-border bg-dark-bg2 shrink-0">
        <label className="text-xs font-semibold text-dark-muted uppercase tracking-wider">Portfolio</label>
        {loading ? (
          <div className="animate-spin w-4 h-4 border-2 border-dark-accent border-t-transparent rounded-full" />
        ) : portfolios.length === 0 ? (
          <span className="text-dark-muted text-sm">No portfolios yet</span>
        ) : (
          <select
            value={selectedId ?? ''}
            onChange={e => selectPortfolio(Number(e.target.value))}
            className="py-1.5 px-3 bg-dark-panel border border-dark-border rounded-lg text-dark-fg text-sm focus:ring-dark-accent focus:border-dark-accent"
          >
            {portfolios.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>
            ))}
          </select>
        )}

        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 text-xs bg-dark-accent text-white rounded-lg font-medium hover:bg-dark-accent/90 transition-colors"
        >
          + New
        </button>

        {selectedId && (
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-xs text-red-400 border border-red-500/30 rounded-lg font-medium hover:bg-red-500/10 transition-colors"
          >
            Delete
          </button>
        )}

        {/* Create Inline */}
        {showCreate && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Portfolio name"
              className="px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-sm focus:ring-dark-accent focus:border-dark-accent"
              autoFocus
            />
            <button
              onClick={handleCreate}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg font-medium hover:bg-green-600/90 transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(''); setCreateError(''); }}
              className="px-2 py-1.5 text-xs text-dark-muted hover:text-dark-fg transition-colors"
            >
              Cancel
            </button>
            {createError && <span className="text-red-400 text-xs">{createError}</span>}
          </div>
        )}
      </div>

      {/* Sub-Tab Navigation */}
      <div className="flex border-b border-dark-border bg-dark-bg shrink-0">
        {SUB_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setSubView(tab.key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors ${
              subView === tab.key
                ? 'text-dark-accent border-b-2 border-dark-accent bg-dark-panel/50'
                : 'text-dark-muted hover:text-dark-fg hover:bg-dark-panel/30'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-7xl mx-auto w-full">
        {!selectedId && subView !== 'optimize' ? (
          <div className="flex flex-col items-center justify-center py-16 text-dark-muted gap-4">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a4 4 0 00-8 0v2" />
            </svg>
            <p>Create a portfolio to get started</p>
          </div>
        ) : (
          <>
            {subView === 'dashboard' && <PortfolioDashboard />}
            {subView === 'transactions' && <TransactionsView />}
            {subView === 'import' && <ImportWizard />}
            {subView === 'optimize' && <OptimizeView />}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
