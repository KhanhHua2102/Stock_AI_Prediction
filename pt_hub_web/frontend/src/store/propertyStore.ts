import { create } from 'zustand';
import { QueryClient } from '@tanstack/react-query';
import { propertyApi } from '../services/api';
import type { InvestmentProperty } from '../services/types';

let _queryClient: QueryClient | null = null;
export function setPropertyQueryClient(qc: QueryClient) { _queryClient = qc; }

function invalidateDashboard() {
  _queryClient?.invalidateQueries({ queryKey: ['property-dashboard'] });
}

type SubView = 'dashboard' | 'properties' | 'suburb-research';

interface PropertyState {
  subView: SubView;
  setSubView: (v: SubView) => void;

  properties: InvestmentProperty[];
  selectedId: number | null;
  loading: boolean;

  fetchProperties: () => Promise<void>;
  selectProperty: (id: number | null) => void;
  createProperty: (data: Partial<InvestmentProperty>) => Promise<number>;
  updateProperty: (id: number, data: Partial<InvestmentProperty>) => Promise<void>;
  deleteProperty: (id: number) => Promise<void>;
}

export const usePropertyStore = create<PropertyState>((set, get) => ({
  subView: 'dashboard',
  setSubView: (v) => set({ subView: v }),

  properties: [],
  selectedId: null,
  loading: false,

  fetchProperties: async () => {
    set({ loading: true });
    try {
      const { properties } = await propertyApi.listProperties();
      set({ properties });
      const { selectedId } = get();
      if (selectedId === null && properties.length > 0) {
        set({ selectedId: properties[0].id });
      }
    } finally {
      set({ loading: false });
    }
  },

  selectProperty: (id) => set({ selectedId: id }),

  createProperty: async (data) => {
    const result = await propertyApi.createProperty(data);
    await get().fetchProperties();
    set({ selectedId: result.id });
    invalidateDashboard();
    return result.id;
  },

  updateProperty: async (id, data) => {
    await propertyApi.updateProperty(id, data);
    await get().fetchProperties();
    invalidateDashboard();
  },

  deleteProperty: async (id) => {
    await propertyApi.deleteProperty(id);
    const { selectedId } = get();
    await get().fetchProperties();
    if (selectedId === id) {
      const { properties } = get();
      set({ selectedId: properties.length > 0 ? properties[0].id : null });
    }
    invalidateDashboard();
  },
}));
