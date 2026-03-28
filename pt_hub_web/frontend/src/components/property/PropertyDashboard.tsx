import { usePropertyDashboard } from '../../hooks/usePropertyDashboard';
import { Button } from '@heroui/button';
import type { InvestmentProperty } from '../../services/types';
import { usePropertyStore } from '../../store/propertyStore';

const fmt = (v: number) => v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const pct = (v: number) => `${v.toFixed(2)}%`;

export function PropertyDashboard() {
  const { data, isLoading } = usePropertyDashboard();
  const { selectProperty, setSubView } = usePropertyStore();
  const { summary, properties } = data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" style={{ color: '#a1a1aa' }}>
        <div className="animate-spin w-6 h-6 rounded-full" style={{ border: '2px solid #006FEE', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!summary || properties.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ color: '#a1a1aa' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M3 21h18M3 7v1a3 3 0 006 0V7m0 0V3h6v4m0 0v1a3 3 0 006 0V7M6 21V10m6 11V10m6 11V10" />
        </svg>
        <p className="text-sm">Add a property to get started</p>
      </div>
    );
  }

  const cards = [
    { label: 'Total Properties', value: String(summary.total_properties), color: '#006FEE' },
    { label: 'Purchase Value', value: fmt(summary.total_purchase_value), color: '#a1a1aa' },
    { label: 'Current Estimate', value: fmt(summary.total_current_estimate), color: '#17c964' },
    { label: 'Total Equity', value: fmt(summary.total_equity), color: summary.total_equity >= 0 ? '#17c964' : '#f31260' },
    { label: 'Weekly Rent', value: fmt(summary.total_weekly_rent), color: '#f5a524' },
    { label: 'Gross Yield', value: pct(summary.gross_yield_pct), color: '#7828c8' },
    { label: 'Total Loans', value: fmt(summary.total_loan_amount), color: '#f31260' },
    { label: 'Monthly Repayment', value: fmt(summary.total_loan_repayment_monthly), color: '#f31260' },
  ];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(card => (
          <div
            key={card.label}
            className="rounded-xl p-4"
            style={{ background: '#27272a' }}
          >
            <div className="text-xs font-medium mb-1" style={{ color: '#a1a1aa' }}>{card.label}</div>
            <div className="text-lg font-bold" style={{ color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Property Cards */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: '#ECEDEE' }}>Your Properties</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {properties.map(p => (
            <PropertyCard
              key={p.id}
              property={p}
              onClick={() => {
                selectProperty(p.id);
                setSubView('properties');
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PropertyCard({ property: p, onClick }: { property: InvestmentProperty; onClick: () => void }) {
  const equity = (p.current_estimate ?? 0) - (p.loan_amount ?? 0);
  const capitalGain = (p.current_estimate ?? 0) - (p.purchase_price ?? 0);
  const grossYield = p.current_estimate && p.rental_income_weekly
    ? (p.rental_income_weekly * 52) / p.current_estimate * 100
    : 0;

  return (
    <Button
      variant="flat"
      size="sm"
      onClick={onClick}
      className="rounded-xl p-4 text-left w-full h-auto items-start justify-start"
    >
      <div className="w-full">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-sm font-semibold" style={{ color: '#ECEDEE' }}>{p.name}</div>
            <div className="text-xs" style={{ color: '#a1a1aa' }}>{p.address}, {p.suburb} {p.state} {p.postcode}</div>
          </div>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: '#3f3f46', color: '#ECEDEE' }}
          >
            {p.property_type}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs mb-3" style={{ color: '#a1a1aa' }}>
          {p.bedrooms > 0 && <span>{p.bedrooms} bed</span>}
          {p.bathrooms > 0 && <><span style={{ color: '#52525b' }}>|</span><span>{p.bathrooms} bath</span></>}
          {p.parking > 0 && <><span style={{ color: '#52525b' }}>|</span><span>{p.parking} car</span></>}
          {p.land_size_sqm && <><span style={{ color: '#52525b' }}>|</span><span>{p.land_size_sqm} sqm</span></>}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span style={{ color: '#a1a1aa' }}>Estimate: </span>
            <span style={{ color: '#ECEDEE' }}>
              {p.current_estimate ? `$${p.current_estimate.toLocaleString()}` : '—'}
              {p.estimate_source === 'suburb_research' && (
                <span className="ml-1 text-[10px]" style={{ color: '#71717a' }} title="From suburb median price">~</span>
              )}
            </span>
          </div>
          <div>
            <span style={{ color: '#a1a1aa' }}>Equity: </span>
            <span style={{ color: equity >= 0 ? '#17c964' : '#f31260' }}>${equity.toLocaleString()}</span>
          </div>
          <div>
            <span style={{ color: '#a1a1aa' }}>Rent/wk: </span>
            <span style={{ color: '#f5a524' }}>${p.rental_income_weekly}</span>
          </div>
          <div>
            <span style={{ color: '#a1a1aa' }}>Yield: </span>
            <span style={{ color: '#7828c8' }}>{grossYield.toFixed(1)}%</span>
          </div>
          {capitalGain !== 0 && (
            <div className="col-span-2">
              <span style={{ color: '#a1a1aa' }}>Capital Gain: </span>
              <span style={{ color: capitalGain >= 0 ? '#17c964' : '#f31260' }}>
                {capitalGain >= 0 ? '+' : ''}{`$${capitalGain.toLocaleString()}`}
              </span>
            </div>
          )}
        </div>
      </div>
    </Button>
  );
}
