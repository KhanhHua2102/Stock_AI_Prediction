import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, SelectItem } from '@heroui/select';
import { Input } from '@heroui/input';
import { Button } from '@heroui/button';
import { propertyApi } from '../../services/api';
import { usePropertyStore } from '../../store/propertyStore';
import type { InvestmentProperty, PropertyValuation } from '../../services/types';
import { PropertyForm } from './PropertyForm';

export function PropertyDetail() {
  const { selectedId, properties, updateProperty, deleteProperty, setSubView } = usePropertyStore();
  const [editing, setEditing] = useState(false);
  const [showAddValuation, setShowAddValuation] = useState(false);
  const queryClient = useQueryClient();

  const property = properties.find(p => p.id === selectedId);
  if (!property) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{ color: '#ECEDEE' }}>{property.name}</h2>
          <p className="text-sm" style={{ color: '#a1a1aa' }}>
            {property.address}, {property.suburb} {property.state} {property.postcode}
          </p>
        </div>
        <div className="flex gap-2">
          <Button color="primary" size="sm" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel Edit' : 'Edit'}
          </Button>
          <Button color="danger" size="sm" onClick={async () => {
            if (!confirm(`Delete "${property.name}"? This cannot be undone.`)) return;
            await deleteProperty(property.id);
            setSubView('dashboard');
          }}>
            Delete
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="rounded-xl p-6" style={{ background: '#27272a' }}>
          <PropertyForm
            initial={property}
            submitLabel="Update Property"
            onSubmit={async (data) => {
              await updateProperty(property.id, data);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <>
          {/* Property Summary */}
          <PropertySummaryCards property={property} />

          {/* Valuations */}
          <ValuationSection
            propertyId={property.id}
            showAdd={showAddValuation}
            onToggleAdd={() => setShowAddValuation(!showAddValuation)}
            onAdded={() => {
              setShowAddValuation(false);
              queryClient.invalidateQueries({ queryKey: ['property-dashboard'] });
            }}
          />

          {/* Investment Breakdown */}
          <InvestmentBreakdown property={property} />
        </>
      )}
    </div>
  );
}

function PropertySummaryCards({ property: p }: { property: InvestmentProperty }) {
  const equity = (p.current_estimate ?? 0) - (p.loan_amount ?? 0);
  const grossYield = p.current_estimate && p.rental_income_weekly
    ? (p.rental_income_weekly * 52) / p.current_estimate * 100
    : 0;
  const monthlyRepayment = (p.loan_amount ?? 0) * (p.loan_rate_pct ?? 0) / 100 / 12;
  const weeklyNetCashflow = (p.rental_income_weekly ?? 0) - (monthlyRepayment * 12 / 52);

  const items = [
    { label: 'Purchase Price', value: p.purchase_price ? `$${p.purchase_price.toLocaleString()}` : '—' },
    { label: 'Current Estimate', value: p.current_estimate ? `$${p.current_estimate.toLocaleString()}` : '—', color: '#17c964' },
    { label: 'Equity', value: `$${equity.toLocaleString()}`, color: equity >= 0 ? '#17c964' : '#f31260' },
    { label: 'Loan Balance', value: `$${(p.loan_amount ?? 0).toLocaleString()}`, color: '#f31260' },
    { label: 'Loan Rate', value: `${(p.loan_rate_pct ?? 0).toFixed(2)}%` },
    { label: 'Weekly Rent', value: `$${(p.rental_income_weekly ?? 0).toLocaleString()}`, color: '#f5a524' },
    { label: 'Gross Yield', value: `${grossYield.toFixed(2)}%`, color: '#7828c8' },
    { label: 'Net Cashflow/wk', value: `$${Math.round(weeklyNetCashflow).toLocaleString()}`, color: weeklyNetCashflow >= 0 ? '#17c964' : '#f31260' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map(item => (
        <div key={item.label} className="rounded-xl p-4" style={{ background: '#27272a' }}>
          <div className="text-xs font-medium mb-1" style={{ color: '#a1a1aa' }}>{item.label}</div>
          <div className="text-base font-bold" style={{ color: item.color ?? '#ECEDEE' }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function ValuationSection({
  propertyId,
  showAdd,
  onToggleAdd,
  onAdded,
}: {
  propertyId: number;
  showAdd: boolean;
  onToggleAdd: () => void;
  onAdded: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['property-valuations', propertyId],
    queryFn: () => propertyApi.getValuations(propertyId),
  });

  const queryClient = useQueryClient();
  const [valDate, setValDate] = useState('');
  const [valAmount, setValAmount] = useState('');
  const [valSource, setValSource] = useState('manual');
  const [valNotes, setValNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);

  const handleFetchHistory = async () => {
    setFetching(true);
    try {
      const result = await propertyApi.fetchValuationHistory(propertyId);
      if (result.added > 0) {
        queryClient.invalidateQueries({ queryKey: ['property-valuations', propertyId] });
        queryClient.invalidateQueries({ queryKey: ['property-dashboard'] });
        onAdded();
      }
    } finally {
      setFetching(false);
    }
  };

  const handleAdd = async () => {
    if (!valDate || !valAmount) return;
    setSaving(true);
    try {
      await propertyApi.addValuation(propertyId, {
        date: valDate,
        estimated_value: Number(valAmount),
        source: valSource,
        notes: valNotes || undefined,
      });
      setValDate('');
      setValAmount('');
      setValNotes('');
      queryClient.invalidateQueries({ queryKey: ['property-valuations', propertyId] });
      onAdded();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this valuation?')) return;
    await propertyApi.deleteValuation(id);
    queryClient.invalidateQueries({ queryKey: ['property-valuations', propertyId] });
    queryClient.invalidateQueries({ queryKey: ['property-dashboard'] });
  };

  const valuations: PropertyValuation[] = data?.valuations ?? [];
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-semibold"
          style={{ color: '#ECEDEE' }}
        >
          <span style={{ color: '#a1a1aa', fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
          Valuation History
          {valuations.length > 0 && (
            <span className="text-xs font-normal" style={{ color: '#71717a' }}>({valuations.length})</span>
          )}
        </button>
        <div className="flex items-center gap-2">
          <Button variant="bordered" color="warning" size="sm" onClick={handleFetchHistory} isDisabled={fetching}>
            {fetching ? 'Fetching...' : 'Fetch History'}
          </Button>
          <Button color="primary" size="sm" onClick={onToggleAdd}>
            {showAdd ? 'Cancel' : '+ Add Valuation'}
          </Button>
        </div>
      </div>

      {expanded && showAdd && (
        <div className="rounded-xl p-4 mb-4 space-y-3" style={{ background: '#27272a' }}>
          <div className="grid grid-cols-4 gap-3">
            <Input label="Date *" labelPlacement="outside" type="date" value={valDate} onValueChange={v => setValDate(v)} variant="bordered" size="sm" />
            <Input label="Value ($) *" labelPlacement="outside" type="number" value={valAmount} onValueChange={v => setValAmount(v)} variant="bordered" size="sm" />
            <div>
              <Select
                label="Source"
                labelPlacement="outside"
                selectedKeys={new Set([valSource])}
                onSelectionChange={keys => { const v = Array.from(keys)[0] as string; if (v) setValSource(v); }}
                variant="bordered"
                size="sm"
              >
                <SelectItem key="manual">Manual</SelectItem>
                <SelectItem key="domain">Domain</SelectItem>
                <SelectItem key="corelogic">CoreLogic</SelectItem>
                <SelectItem key="proptrack">PropTrack</SelectItem>
                <SelectItem key="openagent">OpenAgent</SelectItem>
              </Select>
            </div>
            <Input label="Notes" labelPlacement="outside" type="text" value={valNotes} onValueChange={v => setValNotes(v)} placeholder="Optional" variant="bordered" size="sm" />
          </div>
          <Button color="primary" size="sm" onClick={handleAdd} isDisabled={saving || !valDate || !valAmount}>
            {saving ? 'Saving...' : 'Add'}
          </Button>
        </div>
      )}

      {expanded && (isLoading ? (
        <div className="py-4 text-center" style={{ color: '#a1a1aa' }}>Loading...</div>
      ) : valuations.length === 0 ? (
        <div className="py-8 text-center text-sm" style={{ color: '#a1a1aa' }}>No valuations recorded yet</div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #27272a' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: '#27272a' }}>
                <th className="text-left px-4 py-2 font-medium text-xs" style={{ color: '#a1a1aa' }}>Date</th>
                <th className="text-right px-4 py-2 font-medium text-xs" style={{ color: '#a1a1aa' }}>Value</th>
                <th className="text-left px-4 py-2 font-medium text-xs" style={{ color: '#a1a1aa' }}>Source</th>
                <th className="text-left px-4 py-2 font-medium text-xs" style={{ color: '#a1a1aa' }}>Notes</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {valuations.map(v => (
                <tr key={v.id} style={{ borderTop: '1px solid #27272a' }}>
                  <td className="px-4 py-2" style={{ color: '#ECEDEE' }}>{v.date}</td>
                  <td className="px-4 py-2 text-right font-medium" style={{ color: '#17c964' }}>
                    ${v.estimated_value.toLocaleString()}
                  </td>
                  <td className="px-4 py-2" style={{ color: '#a1a1aa' }}>{v.source}</td>
                  <td className="px-4 py-2" style={{ color: '#a1a1aa' }}>{v.notes || '—'}</td>
                  <td className="px-2 py-2">
                    <button onClick={() => handleDelete(v.id)} className="text-xs" style={{ color: '#f31260' }}>
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}


// ── Investment Breakdown ─────────────────────────────────────

function calcPIPayment(principal: number, annualRate: number, years: number): number {
  if (principal <= 0 || annualRate <= 0 || years <= 0) return 0;
  const r = annualRate / 100 / 12;
  const n = years * 12;
  const monthly = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return monthly * 12;
}

function calcRemainingBalance(principal: number, annualRate: number, years: number, yearsPaid: number): number {
  if (principal <= 0 || annualRate <= 0 || years <= 0) return 0;
  const r = annualRate / 100 / 12;
  const n = years * 12;
  const p = yearsPaid * 12;
  if (p >= n) return 0;
  return principal * (Math.pow(1 + r, n) - Math.pow(1 + r, p)) / (Math.pow(1 + r, n) - 1);
}

function calcIRR(cashFlows: number[], guess = 0.1): number {
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    let npv = 0, dnpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const d = Math.pow(1 + rate, t);
      npv += cashFlows[t] / d;
      dnpv -= t * cashFlows[t] / (d * (1 + rate));
    }
    if (Math.abs(dnpv) < 1e-12) break;
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < 1e-7) { rate = newRate; break; }
    rate = newRate;
  }
  return isFinite(rate) ? rate : 0;
}

const $fmt = (v: number) => `$${Math.round(v).toLocaleString()}`;
const pctFmt = (v: number) => `${v.toFixed(2)}%`;

interface BreakdownRow {
  year: number;
  income: number;
  mortgage: number;
  expenses: number;
  cashFlow: number;
  cashOnCash: number;
  equity: number;
  cashToReceive: number;
  irr: number;
}

function ParamInput({ label, value, set, unit }: { label: string; value: number; set: (v: number) => void; step?: number; unit?: string }) {
  return (
    <Input
      label={label}
      labelPlacement="outside"
      value={String(value)}
      onValueChange={v => { const n = Number(v); if (!isNaN(n)) set(n); }}
      endContent={unit ? <span className="text-[10px] text-default-400 whitespace-nowrap">{unit}</span> : undefined}
      variant="bordered"
      size="sm"
      classNames={{
        inputWrapper: 'min-h-8 h-8 bg-[#1e1e22] border-[#3f3f46] data-[hover=true]:border-[#52525b] group-data-[focus=true]:border-[#006FEE]',
        input: 'text-xs text-[#ECEDEE] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
        label: 'text-[10px] text-[#71717a]',
      }}
    />
  );
}

function InvestmentBreakdown({ property: p }: { property: InvestmentProperty }) {
  const [open, setOpen] = useState(false);

  // Load saved params or use defaults
  const saved = typeof p.projection_params === 'string'
    ? JSON.parse(p.projection_params) as Record<string, number>
    : (p.projection_params ?? {});
  const def = (key: string, fallback: number) => saved[key] ?? fallback;

  // Growth & Income
  const [rentGrowth, setRentGrowth] = useState(def('rentGrowth', 3));
  const [propGrowth, setPropGrowth] = useState(def('propGrowth', 3));
  const [mgmtFee, setMgmtFee] = useState(def('mgmtFee', 8.8));

  // Expenses (amount + individual increase rate)
  const [councilRates, setCouncilRates] = useState(def('councilRates', Math.round((p.purchase_price ?? 0) * 0.004)));
  const [councilInc, setCouncilInc] = useState(def('councilInc', 5));
  const [insurance, setInsurance] = useState(def('insurance', 1500));
  const [insuranceInc, setInsuranceInc] = useState(def('insuranceInc', 3));
  const [maintenance, setMaintenance] = useState(def('maintenance', 1000));
  const [maintenanceInc, setMaintenanceInc] = useState(def('maintenanceInc', 3));

  // Loan & Projection
  const [loanTerm, setLoanTerm] = useState(def('loanTerm', 30));
  const [projYears, setProjYears] = useState(def('projYears', 30));

  // Auto-save params on change (debounced)
  const allParams = useMemo(() => ({
    rentGrowth, propGrowth, mgmtFee,
    councilRates, councilInc, insurance, insuranceInc,
    maintenance, maintenanceInc, loanTerm, projYears,
  }), [rentGrowth, propGrowth, mgmtFee, councilRates, councilInc, insurance, insuranceInc, maintenance, maintenanceInc, loanTerm, projYears]);

  const [saveTimer, setSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    if (saveTimer) clearTimeout(saveTimer);
    const t = setTimeout(() => {
      propertyApi.saveProjectionParams(p.id, allParams).catch(() => {});
    }, 1000);
    setSaveTimer(t);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allParams, open, p.id]);

  // Fetch suburb growth defaults (only if no saved params)
  const { data: suburbData } = useQuery({
    queryKey: ['suburb-summary', p.suburb, p.state],
    queryFn: () => propertyApi.getSuburbSummary(p.suburb, p.state),
    enabled: open && !saved.propGrowth,
  });

  const [defaultsApplied, setDefaultsApplied] = useState(!!saved.propGrowth);
  useEffect(() => {
    if (!suburbData?.metrics || defaultsApplied) return;
    const m = suburbData.metrics;
    if (m.annual_growth_house) {
      const g = Math.min(Math.max(m.annual_growth_house.value, 1), 15);
      setPropGrowth(Math.round(g * 10) / 10);
    }
    setDefaultsApplied(true);
  }, [suburbData, defaultsApplied]);

  const purchasePrice = p.purchase_price ?? 0;
  const loanAmount = p.loan_amount ?? 0;
  const loanRate = p.loan_rate_pct ?? 0;
  const weeklyRent = p.rental_income_weekly ?? 0;
  const initialOutlay = purchasePrice - loanAmount;

  const calcExpenses = (yr: number, income: number) => {
    const mgmt = income * mgmtFee / 100;
    const council = councilRates * Math.pow(1 + councilInc / 100, yr - 1);
    const ins = insurance * Math.pow(1 + insuranceInc / 100, yr - 1);
    const maint = maintenance * Math.pow(1 + maintenanceInc / 100, yr - 1);
    return mgmt + council + ins + maint;
  };

  const rows: BreakdownRow[] = useMemo(() => {
    if (!purchasePrice || !weeklyRent) return [];
    const annualMortgage = calcPIPayment(loanAmount, loanRate, loanTerm);
    const result: BreakdownRow[] = [];
    let cumulativeCF = 0;

    for (let yr = 1; yr <= projYears; yr++) {
      const income = weeklyRent * 52 * Math.pow(1 + rentGrowth / 100, yr - 1);
      const expenses = calcExpenses(yr, income);
      const mortgage = yr <= loanTerm ? annualMortgage : 0;
      const cashFlow = income - mortgage - expenses;
      cumulativeCF += cashFlow;

      const propValue = purchasePrice * Math.pow(1 + propGrowth / 100, yr);
      const remaining = calcRemainingBalance(loanAmount, loanRate, loanTerm, yr);
      const equity = propValue - remaining;
      const cashOnCash = initialOutlay > 0 ? (cumulativeCF / initialOutlay) * 100 : 0;

      // IRR: initial outlay negative, yearly net CFs, final year includes sale
      const flows = [-initialOutlay];
      for (let y = 1; y <= yr; y++) {
        const inc = weeklyRent * 52 * Math.pow(1 + rentGrowth / 100, y - 1);
        const exp = calcExpenses(y, inc);
        const mort = y <= loanTerm ? annualMortgage : 0;
        const cf = inc - mort - exp;
        if (y < yr) {
          flows.push(cf);
        } else {
          const pv = purchasePrice * Math.pow(1 + propGrowth / 100, y);
          const rem = calcRemainingBalance(loanAmount, loanRate, loanTerm, y);
          flows.push(cf + pv - rem);
        }
      }
      const irr = initialOutlay > 0 ? calcIRR(flows) * 100 : 0;
      const cashToReceive = propValue - remaining + cumulativeCF;

      result.push({ year: yr, income, mortgage, expenses, cashFlow, cashOnCash, equity, cashToReceive, irr });
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchasePrice, loanAmount, loanRate, weeklyRent, rentGrowth, propGrowth, mgmtFee, councilRates, councilInc, insurance, insuranceInc, maintenance, maintenanceInc, loanTerm, projYears, initialOutlay]);

  const totals = useMemo(() => {
    if (rows.length === 0) return null;
    return {
      income: rows.reduce((s, r) => s + r.income, 0),
      mortgage: rows.reduce((s, r) => s + r.mortgage, 0),
      expenses: rows.reduce((s, r) => s + r.expenses, 0),
      cashFlow: rows.reduce((s, r) => s + r.cashFlow, 0),
      cashOnCash: rows[rows.length - 1]?.cashOnCash ?? 0,
    };
  }, [rows]);

  if (!purchasePrice || !weeklyRent) return null;

  const cellPad = 'px-3 py-1.5';

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-semibold mb-3"
        style={{ color: '#ECEDEE' }}
      >
        <span style={{ color: '#a1a1aa', fontSize: 10 }}>{open ? '▼' : '▶'}</span>
        Investment Breakdown
      </button>

      {open && (
        <div className="space-y-4">
          {/* Parameter groups */}
          <div className="space-y-3">
            {/* Row 1: Growth & Income */}
            <div className="rounded-xl p-3" style={{ background: '#27272a' }}>
              <div className="text-[10px] font-medium mb-2" style={{ color: '#a1a1aa' }}>Growth & Income</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <ParamInput label="Rent Growth" value={rentGrowth} set={setRentGrowth} step={0.5} unit="%" />
                <ParamInput label="Property Growth" value={propGrowth} set={setPropGrowth} step={0.5} unit="%" />
                <ParamInput label="Management Fee" value={mgmtFee} set={setMgmtFee} step={0.1} unit="%" />
                <ParamInput label="Loan Term" value={loanTerm} set={setLoanTerm} step={1} unit="yr" />
                <ParamInput label="Projection" value={projYears} set={setProjYears} step={5} unit="yr" />
              </div>
            </div>

            {/* Row 2: Expenses with individual increase rates */}
            <div className="rounded-xl p-3" style={{ background: '#27272a' }}>
              <div className="text-[10px] font-medium mb-2" style={{ color: '#a1a1aa' }}>Annual Expenses</div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                <ParamInput label="Council Rates" value={councilRates} set={setCouncilRates} step={100} unit="$/yr" />
                <ParamInput label="Council Increase" value={councilInc} set={setCouncilInc} step={0.5} unit="%" />
                <ParamInput label="Insurance" value={insurance} set={setInsurance} step={100} unit="$/yr" />
                <ParamInput label="Insurance Increase" value={insuranceInc} set={setInsuranceInc} step={0.5} unit="%" />
                <ParamInput label="Maintenance" value={maintenance} set={setMaintenance} step={100} unit="$/yr" />
                <ParamInput label="Maintenance Increase" value={maintenanceInc} set={setMaintenanceInc} step={0.5} unit="%" />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl overflow-auto" style={{ border: '1px solid #27272a' }}>
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr style={{ background: '#27272a' }}>
                  {['Year', 'Annual Income', 'Mortgage', 'Expenses', 'Cash Flow', 'Cash on Cash', 'Equity', 'Cash to Receive', 'Return (IRR)'].map(h => (
                    <th key={h} className={`${cellPad} font-medium text-right`} style={{ color: '#a1a1aa' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Begin row */}
                <tr style={{ borderTop: '1px solid #27272a' }}>
                  <td className={`${cellPad} text-right font-medium`} style={{ color: '#a1a1aa' }}>Begin</td>
                  <td className={cellPad} /><td className={cellPad} /><td className={cellPad} />
                  <td className={`${cellPad} text-right font-medium`} style={{ color: '#f31260' }}>-{$fmt(initialOutlay)}</td>
                  <td className={cellPad} /><td className={cellPad} /><td className={cellPad} /><td className={cellPad} />
                </tr>

                {rows.map(r => (
                  <tr key={r.year} style={{ borderTop: '1px solid #1e1e22' }}>
                    <td className={`${cellPad} text-right font-medium`} style={{ color: '#a1a1aa' }}>{r.year}.</td>
                    <td className={`${cellPad} text-right`} style={{ color: '#ECEDEE' }}>{$fmt(r.income)}</td>
                    <td className={`${cellPad} text-right`} style={{ color: '#ECEDEE' }}>{$fmt(r.mortgage)}</td>
                    <td className={`${cellPad} text-right`} style={{ color: '#ECEDEE' }}>{$fmt(r.expenses)}</td>
                    <td className={`${cellPad} text-right`} style={{ color: r.cashFlow >= 0 ? '#17c964' : '#f31260' }}>{$fmt(r.cashFlow)}</td>
                    <td className={`${cellPad} text-right`} style={{ color: r.cashOnCash >= 0 ? '#17c964' : '#f31260' }}>{pctFmt(r.cashOnCash)}</td>
                    <td className={`${cellPad} text-right`} style={{ color: '#f5a524' }}>{$fmt(r.equity)}</td>
                    <td className={`${cellPad} text-right`} style={{ color: '#006FEE' }}>{$fmt(r.cashToReceive)}</td>
                    <td className={`${cellPad} text-right`} style={{ color: r.irr >= 0 ? '#17c964' : '#f31260' }}>{pctFmt(r.irr)}</td>
                  </tr>
                ))}

                {/* Total row */}
                {totals && (
                  <tr style={{ borderTop: '2px solid #3f3f46', background: '#27272a' }}>
                    <td className={`${cellPad} text-right font-bold`} style={{ color: '#ECEDEE' }}>Total</td>
                    <td className={`${cellPad} text-right font-bold`} style={{ color: '#ECEDEE' }}>{$fmt(totals.income)}</td>
                    <td className={`${cellPad} text-right font-bold`} style={{ color: '#ECEDEE' }}>{$fmt(totals.mortgage)}</td>
                    <td className={`${cellPad} text-right font-bold`} style={{ color: '#ECEDEE' }}>{$fmt(totals.expenses)}</td>
                    <td className={`${cellPad} text-right font-bold`} style={{ color: totals.cashFlow >= 0 ? '#17c964' : '#f31260' }}>{$fmt(totals.cashFlow)}</td>
                    <td className={`${cellPad} text-right font-bold`} style={{ color: totals.cashOnCash >= 0 ? '#17c964' : '#f31260' }}>{pctFmt(totals.cashOnCash)}</td>
                    <td className={cellPad} /><td className={cellPad} /><td className={cellPad} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
