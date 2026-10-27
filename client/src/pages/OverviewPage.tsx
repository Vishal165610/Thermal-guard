import { Activity, AlertTriangle, Brain, Wrench } from 'lucide-react';
import type { SimulationSnapshot, ZoneId } from '@shared/types';
import { riskWord } from '../utils/thermalColors';
import { EarlyWarningCard } from '../components/dashboard/EarlyWarningCard';
import { KpiCard } from '../components/dashboard/KpiCard';
import { Narrator } from '../components/dashboard/Narrator';
import { ZoneMeter } from '../components/dashboard/ZoneMeter';
import type { PageId } from '../hooks/usePage';

interface Props {
  snapshot: SimulationSnapshot;
  onOpenZone: (id: ZoneId) => void;
  onPage: (p: PageId) => void;
}

export function OverviewPage({ snapshot, onOpenZone, onPage }: Props) {
  const normal = snapshot.zones.filter((z) => z.status === 'NORMAL').length;
  const open = snapshot.faults.filter((f) => f.state !== 'fixed').length;
  let top = snapshot.forecasts[0];
  for (const f of snapshot.forecasts) if ((f.riskScore ?? 0) > (top.riskScore ?? 0)) top = f;
  const topZone = snapshot.zones.find((z) => z.id === top.zoneId)!;
  const risk = riskWord(top.riskScore);
  const allOk = normal === snapshot.zones.length;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-extrabold text-ink">Factory overview</h1>
        <p className="mt-1 text-base text-muted">The live temperature of every zone at a glance. Click a meter to open it in the 3D twin.</p>
      </div>

      <Narrator snapshot={snapshot} />

      <div className="grid grid-cols-4 gap-5">
        <KpiCard
          icon={<Activity className="h-4 w-4" />} label="Zones normal"
          value={`${normal} / ${snapshot.zones.length}`}
          hint={allOk ? 'Everything is within limits' : 'Some zones need attention'}
          tone={allOk ? '#16A34A' : '#D97706'}
        />
        <KpiCard
          icon={<Brain className="h-4 w-4" />} label="Highest AI risk"
          value={top.riskScore !== null ? `${Math.round(top.riskScore * 100)}%` : 'n/a'}
          hint={`${topZone.name} · ${risk.word.toLowerCase()}`}
          tone={risk.color}
        />
        <KpiCard
          icon={<Wrench className="h-4 w-4" />} label="Open issues"
          value={String(open)}
          hint={open > 0 ? 'Open the Fix Center' : 'Nothing to repair'}
          tone={open > 0 ? '#D97706' : '#16A34A'}
          onClick={() => onPage('fix')}
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />} label="Cooling output"
          value={`${Math.round(snapshot.incident.coolingEffectiveness * 100)}%`}
          hint={snapshot.incident.coolingEffectiveness < 0.99 ? 'Cooling is not at full power' : 'Full power'}
          tone={snapshot.incident.coolingEffectiveness < 0.99 ? '#D97706' : '#16A34A'}
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {snapshot.zones.map((z) => (
          <ZoneMeter
            key={z.id}
            zone={z}
            forecast={snapshot.forecasts.find((f) => f.zoneId === z.id)}
            ambient={snapshot.ambient}
            faults={snapshot.faults}
            onOpen={() => onOpenZone(z.id)}
          />
        ))}
      </div>

      <EarlyWarningCard entry={snapshot.timeline[0]} />
    </div>
  );
}
