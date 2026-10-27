import { Brain } from 'lucide-react';
import type { SimulationSnapshot, ZoneId } from '@shared/types';
import { AI_WARN_RISK, FORECAST_HORIZON } from '@shared/zones';
import { Card } from '../components/ui/Card';
import { ForecastChart } from '../components/charts/ForecastChart';
import { HistoryChart } from '../components/charts/HistoryChart';
import { EarlyWarningCard } from '../components/dashboard/EarlyWarningCard';
import { OutcomeCard } from '../components/dashboard/OutcomeCard';
import { ZoneChips } from '../components/dashboard/ZoneChips';
import { riskWord } from '../utils/thermalColors';

interface Props {
  snapshot: SimulationSnapshot;
  selected: ZoneId;
  onSelect: (id: ZoneId) => void;
}

export function AnalyticsPage({ snapshot, selected, onSelect }: Props) {
  const zone = snapshot.zones.find((z) => z.id === selected)!;
  const fc = snapshot.forecasts.find((f) => f.zoneId === selected)!;
  const m = snapshot.model;
  const ai = fc.source === 'neural-network' && fc.riskScore !== null;
  const risk = riskWord(ai ? fc.riskScore : null);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-extrabold text-ink">Analytics</h1>
        <p className="mt-1 text-base text-muted">What was measured, what the AI expects next, and how the response went.</p>
      </div>

      <ZoneChips snapshot={snapshot} selected={selected} onSelect={onSelect} />

      <div className="grid grid-cols-2 gap-6">
        <Card title={`Measured temperature · ${zone.name}`} subtitle="Hottest point of the zone, step by step">
          <div className="h-[340px]"><HistoryChart snapshot={snapshot} zoneId={selected} /></div>
        </Card>
        <Card title={`Forecast · next ${FORECAST_HORIZON} steps`} subtitle="A forecast, not a measurement">
          <div className="h-[340px]"><ForecastChart snapshot={snapshot} zoneId={selected} /></div>
        </Card>
      </div>

      <EarlyWarningCard entry={snapshot.timeline[0]} />

      <div className="grid grid-cols-2 gap-6">
        <Card title="AI model" subtitle="The neural network behind the forecast">
          <div className="flex items-center gap-3">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${m.state === 'ready' ? 'bg-accent/10 text-accent' : 'bg-warn/10 text-warn'}`}>
              <Brain className="h-6 w-6" />
            </div>
            <div>
              <div className="text-lg font-extrabold text-ink">{m.state === 'ready' ? 'Model loaded' : 'Model not available'}</div>
              <div className="text-sm text-muted">
                {m.state === 'ready'
                  ? `Trained on ${m.trainingSamples?.toLocaleString() ?? '?'} generated simulation samples`
                  : 'Showing a simple trend estimate instead (not AI)'}
              </div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-base">
            <div className="rounded-xl bg-soft px-4 py-3">
              <dt className="text-[13px] text-muted">Looks ahead</dt>
              <dd className="font-bold text-ink">{m.horizon} steps</dd>
            </div>
            <div className="rounded-xl bg-soft px-4 py-3">
              <dt className="text-[13px] text-muted">Warning level</dt>
              <dd className="font-bold text-ink">risk ≥ {Math.round(AI_WARN_RISK * 100)}% for 3 steps</dd>
            </div>
            <div className="rounded-xl bg-soft px-4 py-3">
              <dt className="text-[13px] text-muted">{zone.name} risk now</dt>
              <dd className="font-bold" style={{ color: risk.color }}>
                {ai ? `${Math.round((fc.riskScore ?? 0) * 100)}% · ${risk.word}` : 'trend only'}
              </dd>
            </div>
            <div className="rounded-xl bg-soft px-4 py-3">
              <dt className="text-[13px] text-muted">Limit reached in</dt>
              <dd className="font-bold text-ink">
                {zone.status === 'CRITICAL' ? 'already crossed' : fc.projectedBreachInSteps !== null ? `~${fc.projectedBreachInSteps} steps` : 'not in horizon'}
              </dd>
            </div>
          </dl>
          {m.state !== 'ready' && <p className="mt-3 text-sm font-medium text-warn">{m.message}</p>}
          <p className="mt-3 text-sm text-muted">
            The forecast is not a measurement. It is trained on simulated data only and is not validated on real plants.
          </p>
        </Card>
        <OutcomeCard outcome={snapshot.outcome} />
      </div>
    </div>
  );
}
