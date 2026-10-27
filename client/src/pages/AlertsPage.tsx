import type { SimulationSnapshot } from '@shared/types';
import { Card } from '../components/ui/Card';
import { AlertFeed } from '../components/dashboard/AlertFeed';
import { OutcomeCard } from '../components/dashboard/OutcomeCard';

interface Props {
  snapshot: SimulationSnapshot;
  disabled: boolean;
  onAck: (id: string) => void;
}

export function AlertsPage({ snapshot, disabled, onAck }: Props) {
  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-extrabold text-ink">Alerts and activity</h1>
        <p className="mt-1 text-base text-muted">Everything that happened, newest first.</p>
      </div>
      <div className="grid grid-cols-[1fr_440px] items-start gap-6">
        <Card title="Activity log" subtitle="Alerts are measured. AI items are predictions. Actions are what the operator did.">
          <AlertFeed snapshot={snapshot} onAck={onAck} disabled={disabled} />
        </Card>
        <div className="space-y-6">
          <OutcomeCard outcome={snapshot.outcome} />
          <Card title="How to read this">
            <ul className="space-y-2 text-[15px] text-ink/80">
              <li><span className="font-bold text-crit">ALERT</span> — a rule fired because a temperature crossed a configured level.</li>
              <li><span className="font-bold text-accent">AI</span> — the forecast expects a breach soon. Nothing has crossed yet.</li>
              <li><span className="font-bold text-ok">ACTION</span> — something the operator did.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}