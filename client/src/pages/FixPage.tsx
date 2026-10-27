import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import type { ActionId, ScenarioId, SimulationSnapshot, ZoneId } from '@shared/types';
import { Card } from '../components/ui/Card';
import { FaultCard } from '../components/controls/FaultCard';
import { IncidentControls } from '../components/controls/IncidentControls';
import { Narrator } from '../components/dashboard/Narrator';

interface Props {
  snapshot: SimulationSnapshot;
  disabled: boolean;
  selected: ZoneId;
  onScenario: (s: ScenarioId, zoneId?: ZoneId) => void;
  onReset: () => void;
  onAction: (actionId: ActionId, zoneId: ZoneId, faultId: string) => void;
}

export function FixPage({ snapshot, disabled, selected, onScenario, onReset, onAction }: Props) {
  const [fireZone, setFireZone] = useState<ZoneId>(selected === 'cooling' ? 'storage' : selected);
  const faults = snapshot.faults;
  const open = faults.filter((f) => f.state !== 'fixed');
  const fixed = faults.filter((f) => f.state === 'fixed');

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-extrabold text-ink">Fix Center</h1>
        <p className="mt-1 text-base text-muted">
          Some problems can be contained online, right now. The root cause still needs a technician on site.
        </p>
      </div>

      <Narrator snapshot={snapshot} compact />

      <div className="grid grid-cols-[1fr_400px] items-start gap-6">
        <div className="space-y-6">
          {open.length === 0 && (
            <Card>
              <div className="flex items-center gap-4 py-6">
                <CheckCircle2 className="h-12 w-12 shrink-0 text-ok" />
                <div>
                  <div className="text-xl font-extrabold text-ink">No open issues</div>
                  <p className="mt-1 text-base text-muted">
                    Everything is healthy. Use “Simulate an incident” on the right to test a failure and then fix it here.
                  </p>
                </div>
              </div>
            </Card>
          )}
          {open.map((f) => (
            <FaultCard key={f.id} fault={f} recs={snapshot.recommendations} disabled={disabled} onAction={onAction} />
          ))}
          {fixed.length > 0 && (
            <Card title="Recently fixed" subtitle="Repairs finished by a technician">
              <ul className="space-y-2">
                {fixed.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 rounded-xl bg-ok/10 px-4 py-3 text-base">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-ok" />
                    <span className="font-bold text-ink">{f.title}</span>
                    <span className="text-muted">fixed at step {f.resolvedStep}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <IncidentControls
          snapshot={snapshot}
          disabled={disabled}
          fireZone={fireZone}
          onFireZone={setFireZone}
          onScenario={onScenario}
          onReset={onReset}
        />
      </div>
    </div>
  );
}
