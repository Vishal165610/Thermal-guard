import type {
  ForecastSource, PredictionEvent, TimelineEntry, ZoneForecast, ZoneId, ZoneStatus,
} from '../../../shared/types';
import { AI_CONFIRM_STEPS, ZONES, getZone } from '../../../shared/zones';

const MAX_ENTRIES = 12;
const MAX_EVENTS = 30;

interface ZoneTrack {
  streak: number;
  /** Consecutive steps with the zone NORMAL and no active forecast warning. */
  clearTicks: number;
  entryId: string | null;
}

/** An entry is closed after this many calm steps in a row (avoids flicker creating duplicates). */
const CLOSE_AFTER_CLEAR_STEPS = 6;

/**
 * PREDICTIVE EARLY WARNING TIMELINE
 *
 * Records two events per incident and zone:
 *   A. the step where a forecast warning was CONFIRMED (AI_CONFIRM_STEPS steps in a row)
 *      while the zone was still below its limit,
 *   B. the step where the actual configured limit was crossed (rule engine = CRITICAL).
 *
 * Lead = B - A. Nothing here is scripted: if no warning came before the breach, or no breach
 * happened, the entry says so.
 */
export class EarlyWarningTimeline {
  private entries: TimelineEntry[] = [];
  private events: PredictionEvent[] = [];
  private tracks = new Map<ZoneId, ZoneTrack>();
  private counter = 0;
  private eventCounter = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.entries = [];
    this.events = [];
    this.counter = 0;
    this.eventCounter = 0;
    this.tracks.clear();
    for (const z of ZONES) this.tracks.set(z.id, { streak: 0, clearTicks: 0, entryId: null });
  }

  /** Called when the operator starts a new incident, so the demo timeline starts fresh. */
  clearForNewIncident(): void {
    this.entries = [];
    for (const t of this.tracks.values()) {
      t.streak = 0;
      t.clearTicks = 0;
      t.entryId = null;
    }
  }

  getEntries(): TimelineEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  getEvents(): PredictionEvent[] {
    return this.events.map((e) => ({ ...e }));
  }

  update(
    step: number,
    statuses: Record<ZoneId, ZoneStatus>,
    forecasts: Record<ZoneId, ZoneForecast>,
  ): void {
    for (const zone of ZONES) {
      const track = this.tracks.get(zone.id)!;
      const status = statuses[zone.id];
      const fc = forecasts[zone.id];
      let entry = track.entryId ? this.entries.find((e) => e.id === track.entryId) : undefined;

      // --- Event A: confirmed forecast warning, only while still below the limit ---
      if (status !== 'CRITICAL' && fc.warning) track.streak++;
      else if (status !== 'CRITICAL') track.streak = 0;

      if (
        track.streak >= AI_CONFIRM_STEPS &&
        (!entry || (entry.aiWarningStep === null && entry.breachStep === null))
      ) {
        if (!entry) entry = this.openEntry(zone.id, step, track);
        entry.aiWarningStep = step;
        entry.aiWarningSource = fc.source;
        entry.aiWarningRisk = fc.riskScore;
        this.pushEvent(zone.id, step, fc.source, fc.riskScore);
      }

      // --- Event B: actual breach by the rule engine ---
      if (status === 'CRITICAL') {
        if (!entry) entry = this.openEntry(zone.id, step, track);
        if (entry.breachStep === null) entry.breachStep = step;
      }

      // --- close the entry when the zone is back to NORMAL ---
      if (status === 'NORMAL' && !fc.warning) track.clearTicks++;
      else track.clearTicks = 0;
      if (entry && entry.resolvedStep === null && track.clearTicks >= CLOSE_AFTER_CLEAR_STEPS) {
        entry.resolvedStep = step;
        track.entryId = null;
        track.streak = 0;
      }

      if (entry) this.refresh(entry);
    }
  }

  private openEntry(zoneId: ZoneId, step: number, track: ZoneTrack): TimelineEntry {
    const entry: TimelineEntry = {
      id: `T${++this.counter}`,
      zoneId,
      zoneName: getZone(zoneId).name,
      startedStep: step,
      aiWarningStep: null,
      aiWarningSource: null,
      aiWarningRisk: null,
      breachStep: null,
      resolvedStep: null,
      leadSteps: null,
      verdict: 'ai-warning-pending',
      summary: '',
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.pop();
    track.entryId = entry.id;
    return entry;
  }

  private pushEvent(zoneId: ZoneId, step: number, source: ForecastSource, risk: number | null): void {
    const name = getZone(zoneId).name;
    const who = source === 'neural-network' ? 'AI forecast' : 'Trend estimate (not AI)';
    this.events.unshift({
      id: `P${++this.eventCounter}`,
      zoneId, zoneName: name, step, source, riskScore: risk,
      message: `${who}: possible breach of the ${name} limit within 30 steps`,
    });
    if (this.events.length > MAX_EVENTS) this.events.pop();
  }

  private refresh(e: TimelineEntry): void {
    const src = e.aiWarningSource === 'trend-fallback' ? 'Trend estimate (not AI)' : 'AI forecast';
    if (e.breachStep !== null && e.aiWarningStep !== null) {
      e.leadSteps = e.breachStep - e.aiWarningStep;
      if (e.leadSteps > 0) {
        e.verdict = 'early-warning';
        e.summary = `${src} at step ${e.aiWarningStep}; limit crossed at step ${e.breachStep}. Early warning lead: ${e.leadSteps} simulation steps.`;
      } else {
        e.verdict = 'no-advance-notice';
        e.summary = `Warning and breach in the same step (${e.breachStep}). No advance notice.`;
      }
    } else if (e.breachStep !== null) {
      e.leadSteps = null;
      e.verdict = 'no-warning-before-breach';
      e.summary = `Limit crossed at step ${e.breachStep}. The forecast gave no confirmed warning before it: only the reactive threshold alarm fired.`;
    } else if (e.aiWarningStep !== null) {
      e.leadSteps = null;
      if (e.resolvedStep !== null) {
        e.verdict = 'warning-without-breach';
        e.summary = `${src} at step ${e.aiWarningStep}, but the limit was never crossed (zone back to normal at step ${e.resolvedStep}).`;
      } else {
        e.verdict = 'ai-warning-pending';
        e.summary = `${src} at step ${e.aiWarningStep}. Waiting to see whether the limit is crossed.`;
      }
    }
  }
}
