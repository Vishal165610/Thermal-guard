import type {
  ActionId, FaultInfo, ScenarioId, SimulationSnapshot, ZoneForecast, ZoneId, ZoneState,
} from '../../shared/types';
import {
  AMBIENT_TEMP, DEFAULT_SPEED, GRID_H, GRID_W, HISTORY_LEN, HYSTERESIS, RECOVERY_BAND, SPEEDS, TICK_MS, ZONES,
} from '../../shared/zones';
import { ACTIONS, getAction } from '../../shared/actions';
import { OutcomeTracker } from './actions/outcomeTracker';
import { recommend } from './actions/recommender';
import { FaultManager } from './faults/faultManager';
import { AlertEngine } from './alerts/alertEngine';
import { EarlyWarningTimeline } from './alerts/earlyWarningTimeline';
import { Forecaster } from './forecasting/forecaster';
import { ThermalSimulation } from './simulation/thermalSimulation';

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The single owner of simulation state: thermal grid, incident, alerts, forecasts, timeline.
 * Everything the dashboard shows comes out of `snapshot()`.
 */
export class SimulationService {
  readonly sim = new ThermalSimulation();
  readonly alerts = new AlertEngine();
  readonly timeline = new EarlyWarningTimeline();
  readonly forecaster = new Forecaster();
  readonly outcome = new OutcomeTracker();
  readonly faults = new FaultManager();

  private histories = {} as Record<ZoneId, number[]>;
  private forecasts = {} as Record<ZoneId, ZoneForecast>;
  private peaks = {} as Record<ZoneId, number>;
  private avgs = {} as Record<ZoneId, number>;
  private nominal = {} as Record<ZoneId, number>;

  paused = false;
  speed: number = DEFAULT_SPEED;

  constructor() {
    this.reset();
  }

  async init(): Promise<void> {
    await this.forecaster.load();
    this.refreshDerived();
  }

  reset(): void {
    this.sim.reset();
    this.alerts.reset();
    this.timeline.reset();
    this.outcome.reset();
    this.faults.reset();
    const base = this.sim.getBaselinePeaks();
    ZONES.forEach((z, i) => {
      this.histories[z.id] = Array(HISTORY_LEN).fill(base[i]);
      this.nominal[z.id] = base[i];
    });
    this.refreshDerived();
  }

  setScenario(scenario: ScenarioId, zoneId?: ZoneId): void {
    const step = this.sim.step;
    if (scenario !== 'normal') {
      this.timeline.clearForNewIncident();
      this.outcome.startIncident(step);
      this.sim.setScenario(scenario, { zoneId });
      if (scenario === 'cooling-failure') this.faults.open('cooling-pump', 'cooling', step);
      else if (scenario === 'machine-overheating') this.faults.open('machine-bearing', 'production', step);
      else this.faults.open('fire', zoneId ?? 'storage', step);
    } else {
      // NORMAL DAY: the symptoms clear, but every open issue stays open (equipment runs degraded).
      this.outcome.noteRestore();
      this.faults.normalDay();
      this.sim.setScenario('normal');
    }
    this.faults.applyLevels(this.sim); // re-applies the effect of every open issue
  }

  /** Milliseconds of wall-clock time between simulation steps at the current speed. */
  tickIntervalMs(): number {
    return TICK_MS / this.speed;
  }

  control(p: { paused?: boolean; speed?: number; stepOnce?: boolean }): void {
    if (typeof p.speed === 'number' && (SPEEDS as readonly number[]).includes(p.speed)) this.speed = p.speed;
    if (typeof p.paused === 'boolean') this.paused = p.paused;
    if (p.stepOnce && this.paused) this.tick();
  }

  /** Operator corrective action. Changes the real simulation and is logged for the outcome report. */
  applyAction(actionId: ActionId, zoneId?: ZoneId, faultId?: string): void {
    if (!ACTIONS.some((a) => a.id === actionId)) return;
    const step = this.sim.step;
    let ok = false;
    switch (actionId) {
      case 'restart-cooling': {
        const f = this.faults.findUnresolved('cooling-pump');
        if (f && !f.contained) { this.faults.contain(f, 'restart'); ok = true; }
        break;
      }
      case 'reduce-load': {
        const f = this.faults.findUnresolved('machine-bearing');
        if (f && !f.contained) { this.faults.contain(f, 'reduce'); ok = true; }
        break;
      }
      case 'shutdown-machine': {
        const f = this.faults.findUnresolved('machine-bearing');
        if (f && f.variant !== 'shutdown') { this.faults.contain(f, 'shutdown'); ok = true; }
        break;
      }
      case 'sprinklers': {
        const f = this.faults.findUnresolved('fire', zoneId);
        if (f && !f.contained) { this.faults.contain(f, 'sprinklers'); ok = true; }
        break;
      }
      case 'ventilate':
        ok = this.sim.applyAction('ventilate', zoneId);
        break;
      case 'dispatch-technician': {
        const f = faultId ? this.faults.get(faultId) : zoneId ? this.faults.firstUnresolvedInZone(zoneId) : undefined;
        ok = this.faults.dispatch(f, step);
        break;
      }
    }
    if (!ok) return;
    if (actionId !== 'ventilate' && actionId !== 'dispatch-technician') this.faults.applyLevels(this.sim);
    this.outcome.noteAction(step, actionId, getAction(actionId).label, zoneId ?? null);
  }

  acknowledge(alertId: string): void {
    this.alerts.acknowledge(alertId, this.sim.step);
  }

  tick(): void {
    this.sim.tick();
    const stats = this.sim.getZoneStats();
    for (const s of stats) {
      const h = this.histories[s.id];
      h.push(s.peak);
      if (h.length > HISTORY_LEN) h.shift();
    }
    this.refreshDerived();
    const statuses = {} as Record<ZoneId, ReturnType<AlertEngine['getStatus']>>;
    this.alerts.update(this.sim.step, this.peaks);
    for (const z of ZONES) statuses[z.id] = this.alerts.getStatus(z.id);
    this.timeline.update(this.sim.step, statuses, this.forecasts);
    if (this.faults.update(this.sim.step, statuses)) this.faults.applyLevels(this.sim);
    const warnSteps = this.timeline.getEntries().map((e) => e.aiWarningStep).filter((v): v is number => v !== null);
    this.outcome.update(
      this.sim.step, statuses, this.peaks, this.forecasts,
      warnSteps.length ? Math.min(...warnSteps) : null,
      this.faults.unresolvedCount(),
      this.faults.failingCount(),
    );
  }

  private refreshDerived(): void {
    for (const s of this.sim.getZoneStats()) {
      this.peaks[s.id] = s.peak;
      this.avgs[s.id] = s.avg;
    }
    this.forecasts = this.forecaster.predict(this.histories);
  }

  private recoveryOf(id: ZoneId, zones: ZoneState[]) {
    const zone = zones.find((q) => q.id === id)!;
    if (zone.status === 'NORMAL') return [];
    const targetTemp = zone.warningTemp - HYSTERESIS - RECOVERY_BAND;
    const phase = zone.trend < -0.05 ? 'cooling' : zone.trend > 0.05 ? 'heating' : 'steady';
    const etaSteps =
      phase === 'cooling' && zone.peakTemp > targetTemp
        ? Math.min(999, Math.ceil((zone.peakTemp - targetTemp) / -zone.trend))
        : null;
    return [{ zoneId: id, phase, peakTemp: zone.peakTemp, targetTemp, trend: zone.trend, etaSteps }] as const;
  }

  private currentFaults(): FaultInfo[] {
    const statuses = {} as Record<ZoneId, ReturnType<AlertEngine['getStatus']>>;
    for (const z of ZONES) statuses[z.id] = this.alerts.getStatus(z.id);
    return this.faults.infos(statuses, this.sim.getCauses(), this.sim.step);
  }

  private currentRecommendations() {
    const statuses = {} as Record<ZoneId, ReturnType<AlertEngine['getStatus']>>;
    for (const z of ZONES) statuses[z.id] = this.alerts.getStatus(z.id);
    return recommend(statuses, this.forecasts, this.currentFaults());
  }

  snapshot(): SimulationSnapshot {
    const values = Array.from(this.sim.grid, round1);
    let minTemp = Infinity;
    let maxTemp = -Infinity;
    for (const v of values) {
      if (v < minTemp) minTemp = v;
      if (v > maxTemp) maxTemp = v;
    }
    const zones: ZoneState[] = ZONES.map((z) => {
      const h = this.histories[z.id];
      const n = h.length;
      return {
        id: z.id,
        name: z.name,
        avgTemp: round1(this.avgs[z.id]),
        peakTemp: round1(this.peaks[z.id]),
        limit: z.limit,
        warningTemp: z.limit - z.warningMargin,
        nominalTemp: round1(this.nominal[z.id]),
        status: this.alerts.getStatus(z.id),
        trend: Math.round(((h[n - 1] - h[n - 6]) / 5) * 1000) / 1000,
        history: h.map(round1),
      };
    });
    return {
      step: this.sim.step,
      control: { paused: this.paused, speed: this.speed },
      actions: this.outcome.getActions(),
      recommendations: this.currentRecommendations(),
      faults: this.currentFaults(),
      recovery: ZONES.flatMap((z) => this.recoveryOf(z.id, zones)),
      outcome: this.outcome.getReport(),
      serverTime: Date.now(),
      ambient: AMBIENT_TEMP,
      grid: { width: GRID_W, height: GRID_H, values },
      minTemp,
      maxTemp,
      zones,
      forecasts: ZONES.map((z) => this.forecasts[z.id]),
      model: this.forecaster.status,
      incident: this.sim.getIncident(),
      alerts: this.alerts.getAlerts(),
      predictions: this.timeline.getEvents(),
      timeline: this.timeline.getEntries(),
    };
  }
}
