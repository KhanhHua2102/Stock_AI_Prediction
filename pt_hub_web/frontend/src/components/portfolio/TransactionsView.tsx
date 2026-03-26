import { useState, useEffect } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore';

const TYPE_COLORS: Record<string, string> = {
  BUY: 'bg-green-500/20 text-green-400 border-green-500/30',
  SELL: 'bg-red-500/20 text-red-400 border-red-500/30',
  DIVIDEND: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  SPLIT: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

function formatCurrency(v: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function TransactionsView() {
  const { selectedId, transactions, txnTotal, txnPage, txnLoading, fetchTransactions, addTransaction, deleteTransaction, batchDeleteTransactions } = usePortfolioStore();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ticker: '', type: 'BUY', date: '', quantity: '', price: '', fees: '', notes: '' });
  const [addError, setAddError] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const pageSize = 50;
  const totalPages = Math.ceil(txnTotal / pageSize);

  useEffect(() => {
    if (selectedId) fetchTransactions(selectedId);
  }, [selectedId, fetchTransactions]);

  const handleAdd = async () => {
    if (!selectedId) return;
    if (!form.ticker || !form.date || !form.quantity) {
      setAddError('Ticker, date, and quantity are required');
      return;
    }
    setAddError('');
    try {
      await addTransaction(selectedId, {
        ticker: form.ticker.toUpperCase(),
        type: form.type,
        date: form.date,
        quantity: parseFloat(form.quantity),
        price: parseFloat(form.price) || 0,
        fees: parseFloat(form.fees) || 0,
        notes: form.notes || undefined,
      });
      setForm({ ticker: '', type: 'BUY', date: '', quantity: '', price: '', fees: '', notes: '' });
      setShowAdd(false);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add transaction');
    }
  };

  const handleDelete = async (txnId: number) => {
    if (!selectedId) return;
    if (!confirm('Delete this transaction?')) return;
    await deleteTransaction(selectedId, txnId);
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === transactions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transactions.map(t => t.id)));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const handleBatchDelete = async () => {
    if (!selectedId || selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} transaction${selected.size > 1 ? 's' : ''}?`)) return;
    setDeleting(true);
    try {
      await batchDeleteTransactions(selectedId, Array.from(selected));
      exitSelectMode();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-dark-fg">
          {selectMode ? `${selected.size} selected` : `Transactions (${txnTotal})`}
        </h2>
        <div className="flex items-center gap-2">
          {selectMode ? (
            <>
              <button
                onClick={handleBatchDelete}
                disabled={selected.size === 0 || deleting}
                className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium hover:bg-red-500/30 disabled:opacity-30 transition-colors"
              >
                {deleting ? 'Deleting...' : `Delete (${selected.size})`}
              </button>
              <button
                onClick={exitSelectMode}
                className="px-4 py-2 bg-dark-panel border border-dark-border text-dark-fg rounded-lg text-sm font-medium hover:bg-dark-panel2 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setSelectMode(true)}
                disabled={transactions.length === 0}
                className="px-4 py-2 bg-dark-panel border border-dark-border text-dark-fg rounded-lg text-sm font-medium hover:bg-dark-panel2 disabled:opacity-30 transition-colors"
              >
                Select
              </button>
              <button
                onClick={() => setShowAdd(!showAdd)}
                className="px-4 py-2 bg-dark-accent text-white rounded-lg text-sm font-medium hover:bg-dark-accent/90 transition-colors"
              >
                {showAdd ? 'Cancel' : '+ Add Transaction'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Add Transaction Form */}
      {showAdd && (
        <div className="bg-dark-panel border border-dark-border rounded-xl p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-dark-muted uppercase block mb-1">Ticker *</label>
              <input
                type="text"
                value={form.ticker}
                onChange={e => setForm(f => ({ ...f, ticker: e.target.value }))}
                placeholder="AAPL"
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-sm focus:ring-dark-accent focus:border-dark-accent"
              />
            </div>
            <div>
              <label className="text-xs text-dark-muted uppercase block mb-1">Type *</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-sm focus:ring-dark-accent focus:border-dark-accent"
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
                <option value="DIVIDEND">DIVIDEND</option>
                <option value="SPLIT">SPLIT</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-dark-muted uppercase block mb-1">Date *</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-sm focus:ring-dark-accent focus:border-dark-accent"
              />
            </div>
            <div>
              <label className="text-xs text-dark-muted uppercase block mb-1">Quantity *</label>
              <input
                type="number"
                step="any"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                placeholder="100"
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-sm font-mono focus:ring-dark-accent focus:border-dark-accent"
              />
            </div>
            <div>
              <label className="text-xs text-dark-muted uppercase block mb-1">Price ($)</label>
              <input
                type="number"
                step="any"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                placeholder="150.00"
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-sm font-mono focus:ring-dark-accent focus:border-dark-accent"
              />
            </div>
            <div>
              <label className="text-xs text-dark-muted uppercase block mb-1">Fees ($)</label>
              <input
                type="number"
                step="any"
                value={form.fees}
                onChange={e => setForm(f => ({ ...f, fees: e.target.value }))}
                placeholder="9.95"
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-sm font-mono focus:ring-dark-accent focus:border-dark-accent"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-dark-muted uppercase block mb-1">Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes"
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-dark-fg text-sm focus:ring-dark-accent focus:border-dark-accent"
              />
            </div>
          </div>
          {addError && <p className="text-red-400 text-sm mt-2">{addError}</p>}
          <button
            onClick={handleAdd}
            className="mt-3 px-5 py-2 bg-dark-accent text-white rounded-lg text-sm font-medium hover:bg-dark-accent/90 transition-colors"
          >
            Add Transaction
          </button>
        </div>
      )}

      {/* Transaction Table */}
      <div className="bg-dark-panel border border-dark-border rounded-xl overflow-hidden">
        {txnLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-5 h-5 border-2 border-dark-accent border-t-transparent rounded-full" />
            <span className="ml-2 text-dark-muted text-sm">Loading...</span>
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-dark-muted text-center py-12 text-sm">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border text-xs text-dark-muted uppercase">
                  {selectMode && (
                    <th className="px-4 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={transactions.length > 0 && selected.size === transactions.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-dark-border bg-dark-bg text-dark-accent focus:ring-dark-accent cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Ticker</th>
                  <th className="px-4 py-2 text-center">Type</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Price</th>
                  <th className="px-4 py-2 text-right">Fees</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  {!selectMode && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {transactions.map(txn => (
                  <tr
                    key={txn.id}
                    className={`border-b border-dark-border last:border-0 hover:bg-dark-panel2/50 ${selectMode && selected.has(txn.id) ? 'bg-dark-accent/10' : ''}`}
                    onClick={selectMode ? () => toggleSelect(txn.id) : undefined}
                    style={selectMode ? { cursor: 'pointer' } : undefined}
                  >
                    {selectMode && (
                      <td className="px-4 py-2 w-8" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(txn.id)}
                          onChange={() => toggleSelect(txn.id)}
                          className="w-4 h-4 rounded border-dark-border bg-dark-bg text-dark-accent focus:ring-dark-accent cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-4 py-2 text-dark-muted font-mono">{txn.date}</td>
                    <td className="px-4 py-2 font-bold text-dark-fg">{txn.ticker}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold border ${TYPE_COLORS[txn.type] || ''}`}>
                        {txn.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-dark-fg">{txn.quantity}</td>
                    <td className="px-4 py-2 text-right font-mono text-dark-fg">${formatCurrency(txn.price)}</td>
                    <td className="px-4 py-2 text-right font-mono text-dark-muted">${formatCurrency(txn.fees)}</td>
                    <td className="px-4 py-2 text-right font-mono text-dark-fg font-semibold">
                      ${formatCurrency(txn.quantity * txn.price)}
                    </td>
                    {!selectMode && (
                      <td className="px-4 py-2">
                        <button
                          onClick={() => handleDelete(txn.id)}
                          className="text-dark-muted hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => selectedId && fetchTransactions(selectedId, txnPage - 1)}
            disabled={txnPage === 0}
            className="px-3 py-1 text-sm bg-dark-panel border border-dark-border rounded-lg text-dark-fg disabled:opacity-30 hover:bg-dark-panel2 transition-colors"
          >
            Prev
          </button>
          <span className="text-sm text-dark-muted">
            Page {txnPage + 1} of {totalPages}
          </span>
          <button
            onClick={() => selectedId && fetchTransactions(selectedId, txnPage + 1)}
            disabled={txnPage >= totalPages - 1}
            className="px-3 py-1 text-sm bg-dark-panel border border-dark-border rounded-lg text-dark-fg disabled:opacity-30 hover:bg-dark-panel2 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
