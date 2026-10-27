import type {
  ActionRecord, OutcomeReport, ZoneForecast, ZoneId, ZoneStatus,
} from '../../../shared/types';
import { ZONES } from '../../../shared/zones';

const idle = (): OutcomeReport => ({
  status: 'idle', startedStep: null, closedStep: null, breached: false, stepsAboveLimit: 0,
  peakOverLimit: null, firstActionStep: null, aiWarningStep: null, reactionSteps: null,
  closedBy: null, openIssues: 0, headline: '', detail: '',
});

/**
 * Scores how an incident went, from facts only:
 *   did any zone cross its limit, for how many steps, by how much,
 *   what was done, and how long after the first warning.
 */
export class OutcomeTracker {
  private report: OutcomeReport = idle();
  private actions: ActionRecord[] = [];
  private seenTrouble = false;
  private restored = false;
  private counter = 0;

  reset(): void {
    this.report = idle();
    this.actions = [];
    this.seenTrouble = false;
    this.restored = false;
    this.counter = 0;
  }

  getActions(): ActionRecord[] {
    return this.actions.map((a) => ({ ...a }));
  }

  getReport(): OutcomeReport {
    return { ...this.report };
  }

  startIncident(step: number): void {
    this.reset();
    this.report.status = 'in-progress';
    this.report.startedStep = step;
  }

  /** Operator pressed the NORMAL OPERATION test button (this is not a corrective action). */
  noteRestore(): void {
    if (this.report.status !== 'in-progress') return;
    this.restored = true;
    if (!this.seenTrouble) this.report = idle();
  }

  noteAction(step: number, actionId: ActionRecord['actionId'], label: string, zoneId: ZoneId | null): void {
    this.actions.push({ id: `X${++this.counter}`, step, actionId, label, zoneId });
    if (this.report.status === 'in-progress' && this.report.firstActionStep === null) {
      this.report.firstActionStep = step;
    }
  }

  update(
    step: number,
    statuses: Record<ZoneId, ZoneStatus>,
    peaks: Record<ZoneId, number>,
    forecasts: Record<ZoneId, ZoneForecast>,
    aiWarningStep: number | null,
    openIssues: number,
    failingIssues: number,
  ): void {
    const r = this.report;
    if (r.status === 'closed') {
      // keep the "open issues" part of the report live after the incident closed
      r.openIssues = openIssues;
      this.writeText();
      return;
    }
    if (r.status !== 'in-progress') return;
    r.aiWarningStep = aiWarningStep;

    let anyCritical = false;
    let anyTrouble = false;
    for (const z of ZONES) {
      const st = statuses[z.id];
      if (st !== 'NORMAL' || forecasts[z.id].warning) anyTrouble = true;
      if (st === 'CRITICAL') {
        anyCritical = true;
        r.peakOverLimit = Math.max(r.peakOverLimit ?? 0, peaks[z.id] - z.limit);
      }
    }
    if (anyTrouble) this.seenTrouble = true;
    if (anyCritical) {
      r.breached = true;
      r.stepsAboveLimit++;
    }

    const calm = ZONES.every((z) => statuses[z.id] === 'NORMAL' && !forecasts[z.id].warning);
    // Closed when everything is calm and no problem is still live. A fix applied before any alarm counts too.
    const handled = this.seenTrouble || this.actions.length > 0 || this.restored;
    if (handled && calm && failingIssues === 0 && step > (r.startedStep ?? 0) + 3) {
      r.status = 'closed';
      r.closedStep = step;
      r.openIssues = openIssues;
      r.closedBy = this.actions.length > 0 ? 'actions' : this.restored ? 'restore' : 'recovered';
      if (r.firstActionStep !== null && r.aiWarningStep !== null) r.reactionSteps = r.firstActionStep - r.aiWarningStep;
    }
    this.writeText();
  }

  private writeText(): void {
    const r = this.report;
    const acts = this.actions.map((a) => `${a.label} (step ${a.step})`).join(', ');
    if (r.status === 'in-progress') {
      r.headline = r.breached ? 'Limit crossed, incident still active' : 'Incident in progress';
      const so = r.breached ? `So far: ${r.stepsAboveLimit} steps above the limit. ` : '';
      r.detail = so + (this.actions.length ? `Actions so far: ${acts}.` : 'No corrective action taken yet.');
      return;
    }
    r.headline = r.breached
      ? `Limit was crossed for ${r.stepsAboveLimit} steps`
      : 'Breach avoided';
    const parts: string[] = [];
    if (r.breached && r.peakOverLimit !== null) parts.push(`The worst zone reached ${r.peakOverLimit.toFixed(1)}°C above its limit.`);
    if (r.closedBy === 'actions') parts.push(`Actions: ${acts}.`);
    if (r.closedBy === 'restore') parts.push('No corrective action was taken; conditions were restored with the NORMAL OPERATION test button.');
    if (r.closedBy === 'recovered') parts.push('No corrective action was taken; the incident passed by itself.');
    if (r.aiWarningStep !== null && r.firstActionStep !== null && r.reactionSteps !== null) {
      parts.push(
        r.reactionSteps >= 0
          ? `Warning at step ${r.aiWarningStep}, first action at step ${r.firstActionStep}: ${r.reactionSteps} steps to react.`
          : `First action (step ${r.firstActionStep}) came before the forecast warning was confirmed (step ${r.aiWarningStep}).`,
      );
    }
    if (r.openIssues > 0) {
      parts.push(`${r.openIssues} ${r.openIssues === 1 ? 'issue still needs' : 'issues still need'} an on-site repair (see the Fix Center).`);
    }
    r.detail = parts.join(' ');
  }
}
