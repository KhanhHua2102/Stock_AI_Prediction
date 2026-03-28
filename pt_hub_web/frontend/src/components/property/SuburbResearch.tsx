import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, SelectItem } from '@heroui/select';
import { Input } from '@heroui/input';
import { Button } from '@heroui/button';
import { propertyApi } from '../../services/api';
import type { SuburbMetric, FavoriteSuburb } from '../../services/types';

const METRIC_LABELS: Record<string, string> = {
  median_house_price: 'Median House Price',
  median_unit_price: 'Median Unit Price',
  median_rent_house: 'Median Rent (House)',
  median_rent_unit: 'Median Rent (Unit)',
  population: 'Population',
  vacancy_rate: 'Vacancy Rate (%)',
  days_on_market: 'Days on Market',
  auction_clearance: 'Auction Clearance (%)',
  yield_gross: 'Gross Yield (%)',
  annual_growth_house: 'Annual Growth (House)',
  annual_growth_unit: 'Annual Growth (Unit)',
};

const METRIC_TYPES = Object.keys(METRIC_LABELS);
const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

interface SearchParams {
  suburb: string;
  state: string;
  postcode: string;
}

export function SuburbResearch() {
  const [suburb, setSuburb] = useState('');
  const [state, setState] = useState('WA');
  const [postcode, setPostcode] = useState('');
  const [search, setSearch] = useState<SearchParams | null>(null);
  const [showAddMetric, setShowAddMetric] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{ metrics_fetched: number; sources_tried: string[]; errors: string[] } | null>(null);

  const queryClient = useQueryClient();

  // ── Favorites ──────────────────────────────────────────────
  const { data: favData, refetch: refetchFavorites } = useQuery({
    queryKey: ['favorite-suburbs'],
    queryFn: () => propertyApi.getFavoriteSuburbs(),
  });
  const favorites: FavoriteSuburb[] = favData?.favorites ?? [];

  const hasAutoRefreshed = useRef(false);
  useEffect(() => {
    if (favorites.length === 0 || hasAutoRefreshed.current) return;
    hasAutoRefreshed.current = true;

    // Auto-select first favorite if no search is active
    const first = favorites[0];
    setSuburb(first.suburb);
    setState(first.state);
    setPostcode(first.postcode);
    setSearch({ suburb: first.suburb, state: first.state, postcode: first.postcode });

    // Fire-and-forget: refresh all favorites from external sources
    setRefreshing(true);
    Promise.allSettled(
      favorites.map(f => propertyApi.refreshSuburbData(f.suburb, f.state, f.postcode))
    ).then(() => {
      queryClient.invalidateQueries({ queryKey: ['suburb-summary'] });
      queryClient.invalidateQueries({ queryKey: ['suburb-metrics'] });
    }).finally(() => setRefreshing(false));
  }, [favorites, queryClient]);

  const isFavorited = search
    ? favorites.some(f => f.suburb === search.suburb && f.state === search.state)
    : false;

  const handleAddFavorite = async () => {
    if (!search) return;
    await propertyApi.addFavoriteSuburb(search.suburb, search.state, search.postcode);
    refetchFavorites();
  };

  const handleRemoveFavorite = async (s: string, st: string) => {
    await propertyApi.removeFavoriteSuburb(s, st);
    refetchFavorites();
  };

  const handleFavoriteClick = (fav: FavoriteSuburb) => {
    setSuburb(fav.suburb);
    setState(fav.state);
    setPostcode(fav.postcode);
    const params: SearchParams = { suburb: fav.suburb, state: fav.state, postcode: fav.postcode };
    setSearch(params);
    setRefreshResult(null);
    setRefreshing(true);
    propertyApi.refreshSuburbData(params.suburb, params.state, params.postcode)
      .then(result => {
        setRefreshResult(result);
        queryClient.invalidateQueries({ queryKey: ['suburb-summary', params.suburb, params.state] });
        queryClient.invalidateQueries({ queryKey: ['suburb-metrics', params.suburb, params.state] });
      })
      .catch(e => {
        setRefreshResult({ metrics_fetched: 0, sources_tried: [], errors: [e instanceof Error ? e.message : 'Fetch failed'] });
      })
      .finally(() => setRefreshing(false));
  };

  const handleSearch = async () => {
    if (!suburb.trim() || !postcode.trim()) return;
    const params: SearchParams = {
      suburb: suburb.trim().toUpperCase(),
      state,
      postcode: postcode.trim(),
    };
    setSearch(params);
    setRefreshResult(null);

    // Auto-fetch from external sources on first search
    setRefreshing(true);
    try {
      const result = await propertyApi.refreshSuburbData(params.suburb, params.state, params.postcode);
      setRefreshResult(result);
      // Invalidate queries so UI shows fresh data
      queryClient.invalidateQueries({ queryKey: ['suburb-summary', params.suburb, params.state] });
      queryClient.invalidateQueries({ queryKey: ['suburb-metrics', params.suburb, params.state] });
    } catch (e) {
      setRefreshResult({ metrics_fetched: 0, sources_tried: [], errors: [e instanceof Error ? e.message : 'Fetch failed'] });
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    if (!search) return;
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await propertyApi.refreshSuburbData(search.suburb, search.state, search.postcode);
      setRefreshResult(result);
      queryClient.invalidateQueries({ queryKey: ['suburb-summary', search.suburb, search.state] });
      queryClient.invalidateQueries({ queryKey: ['suburb-metrics', search.suburb, search.state] });
    } catch (e) {
      setRefreshResult({ metrics_fetched: 0, sources_tried: [], errors: [e instanceof Error ? e.message : 'Fetch failed'] });
    } finally {
      setRefreshing(false);
    }
  };

  const handleMetricAdded = useCallback(() => {
    if (!search) return;
    queryClient.invalidateQueries({ queryKey: ['suburb-summary', search.suburb, search.state] });
    queryClient.invalidateQueries({ queryKey: ['suburb-metrics', search.suburb, search.state] });
  }, [search, queryClient]);

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="flex items-end gap-3">
        <div className="w-48">
          <Input
            label="Suburb"
            labelPlacement="outside"
            value={suburb}
            onValueChange={v => setSuburb(v)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="e.g. PERTH"
            variant="bordered"
            size="sm"
          />
        </div>
        <div className="w-24">
          <Select
            label="State"
            labelPlacement="outside"
            selectedKeys={new Set([state])}
            onSelectionChange={keys => { const v = Array.from(keys)[0] as string; if (v) setState(v); }}
            variant="bordered"
            size="sm"
          >
            {AU_STATES.map(s => <SelectItem key={s}>{s}</SelectItem>)}
          </Select>
        </div>
        <div className="w-28">
          <Input
            label="Postcode"
            labelPlacement="outside"
            value={postcode}
            onValueChange={v => setPostcode(v)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="e.g. 6000"
            maxLength={4}
            variant="bordered"
            size="sm"
          />
        </div>
        <Button color="primary" size="sm" onClick={handleSearch} isDisabled={refreshing}>
          {refreshing ? 'Fetching...' : 'Search'}
        </Button>
      </div>

      {/* Favorite Suburbs */}
      {favorites.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium" style={{ color: '#71717a' }}>Pinned:</span>
          {favorites.map(fav => {
            const isActive = search?.suburb === fav.suburb && search?.state === fav.state;
            return (
              <button
                key={`${fav.suburb}-${fav.state}`}
                onClick={() => handleFavoriteClick(fav)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors"
                style={{
                  background: isActive ? '#006FEE' : '#27272a',
                  color: '#ECEDEE',
                  border: `1px solid ${isActive ? '#006FEE' : '#3f3f46'}`,
                }}
              >
                {fav.suburb}, {fav.state} {fav.postcode}
                <span
                  role="button"
                  onClick={e => { e.stopPropagation(); handleRemoveFavorite(fav.suburb, fav.state); }}
                  className="ml-0.5 hover:text-red-400 transition-colors"
                  style={{ color: isActive ? '#93c5fd' : '#71717a' }}
                  title="Remove from favorites"
                >
                  &times;
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Refresh status */}
      {refreshing && (
        <div className="flex items-center gap-2 text-sm" style={{ color: '#a1a1aa' }}>
          <div className="animate-spin w-4 h-4 rounded-full" style={{ border: '2px solid #006FEE', borderTopColor: 'transparent' }} />
          Fetching suburb data from external sources...
        </div>
      )}

      {refreshResult && !refreshing && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#27272a' }}>
          <div style={{ color: refreshResult.metrics_fetched > 0 ? '#17c964' : '#f5a524' }}>
            {refreshResult.metrics_fetched > 0
              ? `Fetched ${refreshResult.metrics_fetched} metric${refreshResult.metrics_fetched !== 1 ? 's' : ''} from: ${refreshResult.sources_tried.join(', ')}`
              : `No metrics found from external sources (${refreshResult.sources_tried.join(', ')}). You can add data manually below.`
            }
          </div>
          {refreshResult.errors.length > 0 && (
            <div className="mt-1 text-xs" style={{ color: '#f31260' }}>
              Errors: {refreshResult.errors.join('; ')}
            </div>
          )}
        </div>
      )}

      {search && (
        <>
          {/* Refresh button */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: '#ECEDEE' }}>
              {search.suburb}, {search.state} {search.postcode}
            </h3>
            <div className="flex items-center gap-2">
              {!isFavorited && (
                <Button variant="bordered" color="warning" size="sm" onClick={handleAddFavorite} title="Pin to favorites">
                  Pin
                </Button>
              )}
              <Button variant="flat" size="sm" onClick={handleRefresh} isDisabled={refreshing}>
                {refreshing ? 'Refreshing...' : 'Refresh from Sources'}
              </Button>
            </div>
          </div>

          <SuburbSummaryView suburb={search.suburb} state={search.state} />
          <SuburbMetricsTable suburb={search.suburb} state={search.state} />

          {showAddMetric ? (
            <AddMetricForm
              suburb={search.suburb}
              state={search.state}
              defaultPostcode={search.postcode}
              onAdded={handleMetricAdded}
              onClose={() => setShowAddMetric(false)}
            />
          ) : (
            <Button variant="flat" size="sm" onClick={() => setShowAddMetric(true)}>
              + Add Metric Manually
            </Button>
          )}
        </>
      )}

      {!search && (
        <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ color: '#a1a1aa' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <p className="text-sm">Search a suburb to fetch and view metrics</p>
          <p className="text-xs" style={{ color: '#52525b' }}>
            Data is fetched from OpenAgent, realestate.com.au, and SQM Research (all free, no API keys needed).
          </p>
        </div>
      )}
    </div>
  );
}

function Sparkline({ values, color, width = 80, height = 28 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SuburbSummaryView({ suburb, state }: { suburb: string; state: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['suburb-summary', suburb, state],
    queryFn: () => propertyApi.getSuburbSummary(suburb, state),
  });

  const { data: histData } = useQuery({
    queryKey: ['suburb-metrics', suburb, state],
    queryFn: () => propertyApi.getSuburbMetrics(suburb, state),
  });

  // Group history by metric_type, sorted by date ascending
  const historyByType: Record<string, number[]> = {};
  if (histData?.metrics) {
    const sorted = [...histData.metrics].sort((a, b) => a.date.localeCompare(b.date));
    for (const m of sorted) {
      if (!historyByType[m.metric_type]) historyByType[m.metric_type] = [];
      historyByType[m.metric_type].push(m.value);
    }
  }

  if (isLoading) return <div className="py-4 text-center text-sm" style={{ color: '#a1a1aa' }}>Loading...</div>;

  if (isError) {
    return (
      <div className="rounded-xl p-4 text-center text-sm" style={{ background: '#27272a', color: '#f31260' }}>
        Error loading metrics: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }

  const metrics = data?.metrics ?? {};
  const hasData = Object.keys(metrics).length > 0;

  if (!hasData) {
    return (
      <div className="rounded-xl p-4 text-center text-sm" style={{ background: '#27272a', color: '#a1a1aa' }}>
        No metrics available yet for {suburb}, {state}. Add data manually below or try refreshing.
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-xs font-medium mb-3" style={{ color: '#a1a1aa' }}>Latest Metrics</h4>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Object.entries(metrics).map(([key, m]) => {
          const history = historyByType[key];
          const trend = history && history.length >= 2
            ? history[history.length - 1] >= history[0] ? '#17c964' : '#f31260'
            : '#71717a';
          return (
            <div key={key} className="rounded-xl p-4" style={{ background: '#27272a' }}>
              <div className="text-xs font-medium mb-1" style={{ color: '#a1a1aa' }}>
                {METRIC_LABELS[key] ?? key}
              </div>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-base font-bold" style={{ color: '#ECEDEE' }}>
                    {formatMetricValue(key, m.value)}
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#52525b' }}>
                    {m.date} &middot; {m.source}
                  </div>
                </div>
                {history && history.length >= 2 && (
                  <Sparkline values={history} color={trend} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SuburbMetricsTable({ suburb, state }: { suburb: string; state: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['suburb-metrics', suburb, state],
    queryFn: () => propertyApi.getSuburbMetrics(suburb, state),
  });

  const metrics: SuburbMetric[] = data?.metrics ?? [];
  const [expanded, setExpanded] = useState(false);

  if (isLoading) return null;
  if (metrics.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs font-medium mb-3"
        style={{ color: '#a1a1aa' }}
      >
        <span style={{ fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
        Historical Data
        <span style={{ color: '#71717a' }}>({metrics.length})</span>
      </button>
      {expanded && <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #27272a' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#27272a' }}>
              <th className="text-left px-4 py-2 font-medium text-xs" style={{ color: '#a1a1aa' }}>Date</th>
              <th className="text-left px-4 py-2 font-medium text-xs" style={{ color: '#a1a1aa' }}>Metric</th>
              <th className="text-right px-4 py-2 font-medium text-xs" style={{ color: '#a1a1aa' }}>Value</th>
              <th className="text-left px-4 py-2 font-medium text-xs" style={{ color: '#a1a1aa' }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => (
              <tr key={m.id} style={{ borderTop: '1px solid #27272a' }}>
                <td className="px-4 py-2" style={{ color: '#ECEDEE' }}>{m.date}</td>
                <td className="px-4 py-2" style={{ color: '#a1a1aa' }}>{METRIC_LABELS[m.metric_type] ?? m.metric_type}</td>
                <td className="px-4 py-2 text-right font-medium" style={{ color: '#ECEDEE' }}>
                  {formatMetricValue(m.metric_type, m.value)}
                </td>
                <td className="px-4 py-2" style={{ color: '#a1a1aa' }}>{m.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

function AddMetricForm({
  suburb,
  state,
  defaultPostcode,
  onAdded,
  onClose,
}: {
  suburb: string;
  state: string;
  defaultPostcode: string;
  onAdded: () => void;
  onClose: () => void;
}) {
  const [metricType, setMetricType] = useState(METRIC_TYPES[0]);
  const [date, setDate] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!date || !value) return;
    setSaving(true);
    try {
      await propertyApi.addSuburbMetric({
        suburb,
        state,
        postcode: defaultPostcode,
        date,
        metric_type: metricType,
        value: Number(value),
      });
      setValue('');
      onAdded();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl p-4" style={{ background: '#27272a' }}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-medium" style={{ color: '#a1a1aa' }}>Add Metric Manually</h4>
        <button onClick={onClose} className="text-xs" style={{ color: '#71717a' }} title="Close">&times;</button>
      </div>
      <div className="grid grid-cols-4 gap-3 items-end">
        <div>
          <Select
            label="Metric Type"
            labelPlacement="outside"
            selectedKeys={new Set([metricType])}
            onSelectionChange={keys => { const v = Array.from(keys)[0] as string; if (v) setMetricType(v); }}
            variant="bordered"
            size="sm"
            classNames={{
              trigger: '!bg-[#1e1e22]',
            }}
          >
            {METRIC_TYPES.map(t => (
              <SelectItem key={t}>{METRIC_LABELS[t]}</SelectItem>
            ))}
          </Select>
        </div>
        <Input label="Date" labelPlacement="outside" type="date" value={date} onValueChange={v => setDate(v)} variant="bordered" size="sm" />
        <Input label="Value" labelPlacement="outside" type="number" value={value} onValueChange={v => setValue(v)} placeholder="0" variant="bordered" size="sm" />
        <Button color="primary" size="sm" onClick={handleSubmit} isDisabled={saving || !date || !value}>
          {saving ? 'Saving...' : 'Add'}
        </Button>
      </div>
    </div>
  );
}

function formatMetricValue(metricType: string, value: number): string {
  if (metricType.startsWith('median_house_price') || metricType.startsWith('median_unit_price')) {
    return `$${value.toLocaleString()}`;
  }
  if (metricType.startsWith('median_rent')) {
    return `$${value.toLocaleString()}/wk`;
  }
  if (metricType === 'population') {
    return value.toLocaleString();
  }
  if (metricType === 'vacancy_rate' || metricType === 'auction_clearance' || metricType === 'yield_gross') {
    return `${value.toFixed(1)}%`;
  }
  if (metricType === 'days_on_market') {
    return `${Math.round(value)} days`;
  }
  if (metricType === 'annual_growth_house' || metricType === 'annual_growth_unit') {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  }
  return String(value);
}
