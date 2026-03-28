import { useQuery } from '@tanstack/react-query';
import { Button } from '@heroui/button';
import { usePropertyStore } from '../../store/propertyStore';
import { propertyApi } from '../../services/api';
import { propertyKeys } from '../../hooks/usePropertyDashboard';
import { PropertyDashboard } from './PropertyDashboard';
import { PropertyList } from './PropertyList';
import { SuburbResearch } from './SuburbResearch';

type SubView = 'dashboard' | 'properties' | 'suburb-research';

const SUB_TABS: { key: SubView; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'properties', label: 'Properties' },
  { key: 'suburb-research', label: 'Suburb Research' },
];

export function PropertyTab() {
  const { subView, setSubView } = usePropertyStore();

  useQuery({
    queryKey: propertyKeys.list,
    queryFn: async () => {
      const { properties: fetched } = await propertyApi.listProperties();
      const store = usePropertyStore.getState();
      usePropertyStore.setState({ properties: fetched });
      if (store.selectedId === null && fetched.length > 0) {
        store.selectProperty(fetched[0].id);
      }
      return fetched;
    },
  });

  return (
    <div className="rounded-xl flex flex-col h-full overflow-hidden" style={{ background: '#18181b' }}>
      {/* Sub-Tab Navigation */}
      <div className="flex gap-1 px-4 py-2 shrink-0" style={{ background: '#18181b', borderBottom: '1px solid #27272a' }}>
        {SUB_TABS.map(tab => (
          <Button
            key={tab.key}
            variant={subView === tab.key ? 'solid' : 'light'}
            color={subView === tab.key ? 'primary' : 'default'}
            radius="full"
            size="sm"
            onClick={() => setSubView(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-7xl mx-auto w-full">
          {subView === 'dashboard' && <PropertyDashboard />}
          {subView === 'properties' && <PropertyList />}
          {subView === 'suburb-research' && <SuburbResearch />}
        </div>
      </div>
    </div>
  );
}
