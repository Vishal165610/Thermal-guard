import { AlertTriangle, WifiOff } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ZoneId } from '@shared/types';
import { useSimulation } from './hooks/useSimulation';
import { usePage } from './hooks/usePage';
import { TopNav } from './components/dashboard/TopNav';
import { AlertsPage } from './pages/AlertsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { FixPage } from './pages/FixPage';
import { OverviewPage } from './pages/OverviewPage';
import { TwinPage } from './pages/TwinPage';

export default function App() {
  const { snapshot, connected, setScenario, reset, acknowledge, control, applyAction } = useSimulation();
  const [page, go] = usePage();
  const [selected, setSelected] = useState<ZoneId>('cooling');
  const onSelect = useCallback((id: ZoneId) => setSelected(id), []);
  const openZone = useCallback((id: ZoneId) => {
    setSelected(id);
    go('twin');
  }, [go]);

  if (!snapshot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas text-center">
        <div className="text-3xl font-extrabold tracking-tight text-ink">Thermal Guard</div>
        <div className="flex items-center gap-2 text-lg text-muted">
          <WifiOff className="h-5 w-5 text-crit" />
          {connected ? 'Waiting for the first simulation step…' : 'Connecting to the simulation server on port 4000…'}
        </div>
        <div className="text-base text-muted">
          Start everything with <code className="rounded-lg bg-white px-2 py-1 font-semibold text-accent">npm run dev</code>
        </div>
      </div>
    );
  }

  const stale = !connected;

  return (
    <div className="flex h-full min-w-[1180px] flex-col bg-canvas text-ink">
      <TopNav page={page} onPage={go} snapshot={snapshot} connected={connected} onReset={reset} onControl={control} />
      {stale && (
        <div className="flex items-center justify-center gap-2 border-b border-crit/30 bg-crit/10 py-2 text-[15px] font-bold text-crit">
          <AlertTriangle className="h-5 w-5" />
          Disconnected from the simulation server. These values are stale (last update at step {snapshot.step}), not live. Reconnecting…
        </div>
      )}
      <main className={`min-h-0 flex-1 overflow-y-auto transition ${stale ? 'opacity-50 grayscale' : ''}`}>
        {page === 'overview' && <OverviewPage snapshot={snapshot} onOpenZone={openZone} onPage={go} />}
        {page === 'twin' && <TwinPage snapshot={snapshot} selected={selected} onSelect={onSelect} onPage={go} />}
        {page === 'fix' && (
          <FixPage
            snapshot={snapshot} disabled={stale} selected={selected}
            onScenario={setScenario} onReset={reset} onAction={applyAction}
          />
        )}
        {page === 'analytics' && <AnalyticsPage snapshot={snapshot} selected={selected} onSelect={onSelect} />}
        {page === 'alerts' && <AlertsPage snapshot={snapshot} disabled={stale} onAck={acknowledge} />}
      </main>
    </div>
  );
}
