import { useState } from 'react';
import { Select, SelectItem } from '@heroui/select';
import { Input, Textarea } from '@heroui/input';
import { Button } from '@heroui/button';
import type { InvestmentProperty } from '../../services/types';

const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
const PROPERTY_TYPES = ['house', 'apartment', 'townhouse', 'land', 'villa', 'unit'];

interface PropertyFormProps {
  initial?: Partial<InvestmentProperty>;
  onSubmit: (data: Partial<InvestmentProperty>) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

export function PropertyForm({ initial, onSubmit, onCancel, submitLabel = 'Save' }: PropertyFormProps) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    address: initial?.address ?? '',
    suburb: initial?.suburb ?? '',
    state: initial?.state ?? 'NSW',
    postcode: initial?.postcode ?? '',
    property_type: initial?.property_type ?? 'house',
    bedrooms: initial?.bedrooms ?? 0,
    bathrooms: initial?.bathrooms ?? 0,
    parking: initial?.parking ?? 0,
    land_size_sqm: initial?.land_size_sqm ?? '',
    purchase_date: initial?.purchase_date ?? '',
    purchase_price: initial?.purchase_price ?? '',
    current_estimate: initial?.current_estimate ?? '',
    rental_income_weekly: initial?.rental_income_weekly ?? 0,
    loan_amount: initial?.loan_amount ?? 0,
    loan_rate_pct: initial?.loan_rate_pct ?? 0,
    notes: initial?.notes ?? '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const set = (key: string, value: string | number) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.address.trim() || !form.suburb.trim() || !form.postcode.trim()) {
      setError('Name, address, suburb, and postcode are required');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const data: Partial<InvestmentProperty> = {
        name: form.name.trim(),
        address: form.address.trim(),
        suburb: form.suburb.trim().toUpperCase(),
        state: form.state,
        postcode: form.postcode.trim(),
        property_type: form.property_type as InvestmentProperty['property_type'],
        bedrooms: Number(form.bedrooms),
        bathrooms: Number(form.bathrooms),
        parking: Number(form.parking),
        land_size_sqm: form.land_size_sqm ? Number(form.land_size_sqm) : null,
        purchase_date: form.purchase_date || null,
        purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
        current_estimate: form.current_estimate ? Number(form.current_estimate) : null,
        rental_income_weekly: Number(form.rental_income_weekly) || 0,
        loan_amount: Number(form.loan_amount) || 0,
        loan_rate_pct: Number(form.loan_rate_pct) || 0,
        notes: form.notes || null,
      };
      await onSubmit(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save property');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Row 1: Name + Type */}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Property Name *"
          labelPlacement="outside"
          value={form.name}
          onValueChange={v => set('name', v)}
          placeholder="e.g. My Investment Apartment"
          variant="bordered"
          size="sm"
        />
        <div>
          <Select
            label="Property Type *"
            labelPlacement="outside"
            selectedKeys={new Set([form.property_type])}
            onSelectionChange={keys => {
              const val = Array.from(keys)[0] as string;
              if (val) set('property_type', val);
            }}
            variant="bordered"
            size="sm"
          >
            {PROPERTY_TYPES.map(t => (
              <SelectItem key={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
            ))}
          </Select>
        </div>
      </div>

      {/* Row 2: Address */}
      <Input
        label="Address *"
        labelPlacement="outside"
        value={form.address}
        onValueChange={v => set('address', v)}
        placeholder="e.g. 42 Smith Street"
        variant="bordered"
        size="sm"
      />

      {/* Row 3: Suburb, State, Postcode */}
      <div className="grid grid-cols-3 gap-4">
        <Input
          label="Suburb *"
          labelPlacement="outside"
          value={form.suburb}
          onValueChange={v => set('suburb', v)}
          placeholder="e.g. PERTH"
          variant="bordered"
          size="sm"
        />
        <div>
          <Select
            label="State *"
            labelPlacement="outside"
            selectedKeys={new Set([form.state])}
            onSelectionChange={keys => {
              const val = Array.from(keys)[0] as string;
              if (val) set('state', val);
            }}
            variant="bordered"
            size="sm"
          >
            {AU_STATES.map(s => (
              <SelectItem key={s}>{s}</SelectItem>
            ))}
          </Select>
        </div>
        <Input
          label="Postcode *"
          labelPlacement="outside"
          value={form.postcode}
          onValueChange={v => set('postcode', v)}
          placeholder="e.g. 6000"
          variant="bordered"
          size="sm"
          maxLength={4}
        />
      </div>

      {/* Row 4: Bedrooms, Bathrooms, Parking, Land Size */}
      <div className="grid grid-cols-4 gap-4">
        <Input label="Bedrooms" labelPlacement="outside" type="number" value={String(form.bedrooms)} onValueChange={v => set('bedrooms', v)} min={0} variant="bordered" size="sm" />
        <Input label="Bathrooms" labelPlacement="outside" type="number" value={String(form.bathrooms)} onValueChange={v => set('bathrooms', v)} min={0} variant="bordered" size="sm" />
        <Input label="Parking" labelPlacement="outside" type="number" value={String(form.parking)} onValueChange={v => set('parking', v)} min={0} variant="bordered" size="sm" />
        <Input label="Land (sqm)" labelPlacement="outside" type="number" value={String(form.land_size_sqm)} onValueChange={v => set('land_size_sqm', v)} placeholder="—" variant="bordered" size="sm" />
      </div>

      {/* Row 5: Financial Details */}
      <div className="grid grid-cols-3 gap-4">
        <Input label="Purchase Date" labelPlacement="outside" type="date" value={form.purchase_date} onValueChange={v => set('purchase_date', v)} variant="bordered" size="sm" />
        <Input label="Purchase Price ($)" labelPlacement="outside" type="number" value={String(form.purchase_price)} onValueChange={v => set('purchase_price', v)} placeholder="0" variant="bordered" size="sm" />
        <Input label="Current Estimate ($)" labelPlacement="outside" type="number" value={String(form.current_estimate)} onValueChange={v => set('current_estimate', v)} placeholder="0" variant="bordered" size="sm" />
      </div>

      {/* Row 6: Rental + Loan */}
      <div className="grid grid-cols-3 gap-4">
        <Input label="Weekly Rent ($)" labelPlacement="outside" type="number" value={String(form.rental_income_weekly)} onValueChange={v => set('rental_income_weekly', v)} variant="bordered" size="sm" />
        <Input label="Loan Amount ($)" labelPlacement="outside" type="number" value={String(form.loan_amount)} onValueChange={v => set('loan_amount', v)} variant="bordered" size="sm" />
        <Input label="Loan Rate (%)" labelPlacement="outside" type="number" value={String(form.loan_rate_pct)} onValueChange={v => set('loan_rate_pct', v)} variant="bordered" size="sm" />
      </div>

      {/* Row 7: Notes */}
      <Textarea
        label="Notes"
        labelPlacement="outside"
        value={form.notes}
        onValueChange={v => set('notes', v)}
        minRows={2}
        placeholder="Optional notes..."
        variant="bordered"
        size="sm"
      />

      {error && <p className="text-xs" style={{ color: '#f31260' }}>{error}</p>}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button color="primary" size="sm" onClick={handleSubmit} isDisabled={submitting}>
          {submitting ? 'Saving...' : submitLabel}
        </Button>
        <Button variant="light" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
