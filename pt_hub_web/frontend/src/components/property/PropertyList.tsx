import { useState } from 'react';
import { Button } from '@heroui/button';
import { usePropertyStore } from '../../store/propertyStore';
import { PropertyForm } from './PropertyForm';
import { PropertyDetail } from './PropertyDetail';
import type { InvestmentProperty } from '../../services/types';

export function PropertyList() {
  const { properties, selectedId, selectProperty, createProperty } = usePropertyStore();
  const [showAdd, setShowAdd] = useState(false);

  const selected = properties.find(p => p.id === selectedId);

  if (selected) {
    return (
      <div>
        <Button variant="light" size="sm" onClick={() => selectProperty(null)} className="mb-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back to list
        </Button>
        <PropertyDetail />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: '#ECEDEE' }}>
          {properties.length} {properties.length === 1 ? 'Property' : 'Properties'}
        </h3>
        <Button color="primary" size="sm" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : '+ Add Property'}
        </Button>
      </div>

      {showAdd && (
        <div className="rounded-xl p-6" style={{ background: '#27272a' }}>
          <h4 className="text-sm font-semibold mb-4" style={{ color: '#ECEDEE' }}>New Property</h4>
          <PropertyForm
            submitLabel="Add Property"
            onSubmit={async (data) => {
              await createProperty(data);
              setShowAdd(false);
            }}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      {properties.length === 0 && !showAdd ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ color: '#a1a1aa' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M3 21h18M3 7v1a3 3 0 006 0V7m0 0V3h6v4m0 0v1a3 3 0 006 0V7M6 21V10m6 11V10m6 11V10" />
          </svg>
          <p className="text-sm">No properties yet. Add your first investment property.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #27272a' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: '#27272a' }}>
                <th className="text-left px-4 py-2.5 font-medium text-xs" style={{ color: '#a1a1aa' }}>Property</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs" style={{ color: '#a1a1aa' }}>Type</th>
                <th className="text-right px-4 py-2.5 font-medium text-xs" style={{ color: '#a1a1aa' }}>Purchase</th>
                <th className="text-right px-4 py-2.5 font-medium text-xs" style={{ color: '#a1a1aa' }}>Estimate</th>
                <th className="text-right px-4 py-2.5 font-medium text-xs" style={{ color: '#a1a1aa' }}>Rent/wk</th>
                <th className="text-right px-4 py-2.5 font-medium text-xs" style={{ color: '#a1a1aa' }}>Loan</th>
              </tr>
            </thead>
            <tbody>
              {properties.map(p => (
                <PropertyRow key={p.id} property={p} onClick={() => selectProperty(p.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PropertyRow({ property: p, onClick }: { property: InvestmentProperty; onClick: () => void }) {
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer transition-colors"
      style={{ borderTop: '1px solid #27272a' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1e1e22'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <td className="px-4 py-3">
        <div className="font-medium" style={{ color: '#ECEDEE' }}>{p.name}</div>
        <div className="text-xs" style={{ color: '#a1a1aa' }}>{p.suburb} {p.state} {p.postcode}</div>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#3f3f46', color: '#ECEDEE' }}>
          {p.property_type}
        </span>
      </td>
      <td className="px-4 py-3 text-right" style={{ color: '#ECEDEE' }}>
        {p.purchase_price ? `$${p.purchase_price.toLocaleString()}` : '—'}
      </td>
      <td className="px-4 py-3 text-right font-medium" style={{ color: '#17c964' }}>
        {p.current_estimate ? `$${p.current_estimate.toLocaleString()}` : '—'}
      </td>
      <td className="px-4 py-3 text-right" style={{ color: '#f5a524' }}>
        ${p.rental_income_weekly}
      </td>
      <td className="px-4 py-3 text-right" style={{ color: '#f31260' }}>
        {p.loan_amount ? `$${p.loan_amount.toLocaleString()}` : '—'}
      </td>
    </tr>
  );
}
