import { Maximize2, Minus, Plus } from 'lucide-react';
import { useRef, useState, type MutableRefObject } from 'react';
import type { SimulationSnapshot, ZoneId } from '@shared/types';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/ui/StatusPill';
import { Narrator } from '../components/dashboard/Narrator';
import { FactoryScene, type CameraApi } from '../components/factory/FactoryScene';
import { riskWord } from '../utils/thermalColors';
import type { PageId } from '../hooks/usePage';

interface Props {
  snapshot: SimulationSnapshot;
  selected: ZoneId;
  onSelect: (id: ZoneId) => void;
  onPage: (p: PageId) => void;
}

const seg = (on: boolean) =>
  `px-4 py-2 text-[15px] font-semibold transition ${on ? 'bg-accent text-white' : 'text-muted hover:bg-soft hover:text-ink'}`;

export function TwinPage({ snapshot, selected, onSelect, onPage }: Props) {
  const [two, setTwo] = useState(false); // false = one model, true = two models side by side
  const [thermal, setThermal] = useState(false);
  const apiA = useRef<CameraApi | null>(null);
  const apiB = useRef<CameraApi | null>(null);
  const both = (fn: (a: CameraApi) => void) => {
    for (const r of [apiA, apiB] as MutableRefObject<CameraApi | null>[]) if (r.current) fn(r.current);
  };

  const zone = snapshot.zones.find((z) => z.id === selected)!;
  const fc = snapshot.forecasts.find((f) => f.zoneId === selected);
  const risk = riskWord(fc?.source === 'neural-network' ? fc.riskScore : null);
  const issues = snapshot.faults.filter((f) => f.zoneId === selected && f.state !== 'fixed').length;

  const panel = (label: string, thermalView: boolean, apiRef: MutableRefObject<CameraApi | null>) => (
    <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-line bg-[#EAF0F9]">
      <FactoryScene snapshot={snapshot} selected={selected} onSelect={onSelect} thermalView={thermalView} apiRef={apiRef} />
      {two && (
        <span className="absolute left-4 top-4 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-ink shadow">{label}</span>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Narrator snapshot={snapshot} compact />

      <div className="relative flex min-h-0 flex-1 gap-4">
        {two ? (
          <>
            {panel('Factory view', false, apiA)}
            {panel('Heat map', true, apiB)}
          </>
        ) : (
          panel(thermal ? 'Heat map' : 'Factory view', thermal, apiA)
        )}

        {/* view options */}
        <div className="absolute left-4 top-4 z-10 flex flex-col gap-2" style={{ top: two ? 64 : 16 }}>
          <div className="flex overflow-hidden rounded-xl border border-line bg-white shadow">
            <button className={seg(!two)} onClick={() => setTwo(false)}>One model</button>
            <button className={seg(two)} onClick={() => setTwo(true)}>Two models</button>
          </div>
          {!two && (
            <div className="flex overflow-hidden rounded-xl border border-line bg-white shadow">
              <button className={seg(!thermal)} onClick={() => setThermal(false)}>Factory</button>
              <button className={seg(thermal)} onClick={() => setThermal(true)}>Heat map</button>
            </div>
          )}
        </div>

        {/* camera */}
        <div className="absolute right-4 top-4 z-10 flex flex-col gap-2">
          {[
            { icon: <Plus className="h-5 w-5" />, label: 'Zoom in', fn: () => both((a) => a.zoomIn()) },
            { icon: <Minus className="h-5 w-5" />, label: 'Zoom out', fn: () => both((a) => a.zoomOut()) },
            { icon: <Maximize2 className="h-5 w-5" />, label: 'Reset camera', fn: () => both((a) => a.reset()) },
          ].map((b) => (
            <button
              key={b.label}
              title={b.label}
              aria-label={b.label}
              onClick={b.fn}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white text-ink shadow transition hover:border-accent hover:text-accent"
            >
              {b.icon}
            </button>
          ))}
        </div>

        {/* selected zone */}
        <div className="absolute bottom-4 left-4 z-10 w-[340px] rounded-2xl border border-line bg-white p-5 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-extrabold text-ink">{zone.name}</h3>
            <StatusPill status={zone.status} />
          </div>
          <div className="mt-2 flex items-end gap-3">
            <span className="text-4xl font-extrabold tabular-nums text-ink">{zone.peakTemp.toFixed(1)}°C</span>
            <span className="pb-1 text-sm text-muted">limit {zone.limit}°C</span>
          </div>
          <div className="mt-2 text-[15px] text-muted">
            AI risk: <span className="font-bold" style={{ color: risk.color }}>{risk.word}</span>
            {issues > 0 && <span className="ml-3 font-bold text-warn">· {issues} open {issues === 1 ? 'issue' : 'issues'}</span>}
          </div>
          <Button variant="outline" className="mt-3 w-full !py-2" onClick={() => onPage('fix')}>Open Fix Center</Button>
        </div>
      </div>
    </div>
  );
}
