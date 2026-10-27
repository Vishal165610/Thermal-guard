import type { ActionId, FaultInfo, FaultKind, ZoneId, ZoneStatus } from '../../../shared/types';
import { ZONES, getZone } from '../../../shared/zones';
import {
  DEFAULT_COOLING_FAILURE_EFFECTIVENESS, DEFAULT_FIRE_INTENSITY, DEFAULT_OVERHEAT_MULTIPLIER,
  DEGRADED_COOLING_EFFECTIVENESS, REDUCED_LOAD_MULTIPLIER,
} from '../simulation/config';
import type { ThermalSimulation } from '../simulation/thermalSimulation';

type Variant = 'none' | 'restart' | 'reduce' | 'shutdown' | 'sprinklers' | 'normal-day';
type JobPhase = 'none' | 'travelling' | 'waiting' | 'repairing';

interface Fault {
  id: string;
  kind: FaultKind;
  zoneId: ZoneId;
  /** true once the symptoms are under control (online fix or "normal day"). The issue is still open. */
  contained: boolean;
  variant: Variant;
  resolved: boolean;
  openedStep: number;
  resolvedStep: number | null;
  job: { phase: JobPhase; endStep: number | null };
}

const TRAVEL_STEPS = 20;
const REPAIR_STEPS: Record<FaultKind, number> = { 'cooling-pump': 25, 'machine-bearing': 30, fire: 15 };
const MACHINE = 'machine-a';

export interface Causes {
  coolingEffectiveness: number;
  machineMultiplier: number;
}

/**
 * Tracks the ROOT CAUSE behind each incident.
 *
 *  failing    -> the problem is live (temperatures rise).
 *  contained  -> an online fix (or the NORMAL DAY button) stopped the symptoms, but the equipment
 *                still runs degraded. The issue stays open.
 *  technician -> travelling, waiting for safe conditions, repairing, then fixed for good.
 */
export class FaultManager {
  private faults: Fault[] = [];
  private counter = 0;

  reset(): void {
    this.faults = [];
    this.counter = 0;
  }

  unresolvedCount(): number {
    return this.faults.filter((f) => !f.resolved).length;
  }

  /** Open issues whose symptoms are NOT under control yet. */
  failingCount(): number {
    return this.faults.filter((f) => !f.resolved && !f.contained).length;
  }

  get(id: string): Fault | undefined {
    return this.faults.find((f) => f.id === id);
  }

  findUnresolved(kind: FaultKind, zoneId?: ZoneId): Fault | undefined {
    return this.faults.find((f) => !f.resolved && f.kind === kind && (!zoneId || f.zoneId === zoneId));
  }

  firstUnresolvedInZone(zoneId: ZoneId): Fault | undefined {
    return this.faults.find((f) => !f.resolved && f.zoneId === zoneId && f.job.phase === 'none');
  }

  /** An incident starts (or starts again): the problem is live. */
  open(kind: FaultKind, zoneId: ZoneId, step: number): Fault {
    let f = this.faults.find((x) => x.kind === kind && x.zoneId === zoneId);
    if (!f) {
      f = {
        id: `F${++this.counter}`, kind, zoneId, contained: false, variant: 'none', resolved: false,
        openedStep: step, resolvedStep: null, job: { phase: 'none', endStep: null },
      };
      this.faults.unshift(f);
    }
    f.contained = false;
    f.variant = 'none';
    f.resolved = false;
    f.resolvedStep = null;
    f.openedStep = step;
    f.job = { phase: 'none', endStep: null }; // a new failure cancels any repair in progress
    return f;
  }

  contain(f: Fault, variant: Variant): void {
    f.contained = true;
    f.variant = variant;
  }

  /** NORMAL DAY: symptoms clear, but every open issue stays open. */
  normalDay(): void {
    for (const f of this.faults) if (!f.resolved && !f.contained) this.contain(f, 'normal-day');
  }

  dispatch(f: Fault | undefined, step: number): boolean {
    if (!f || f.resolved || f.job.phase !== 'none') return false;
    f.job = { phase: 'travelling', endStep: step + TRAVEL_STEPS };
    return true;
  }

  /** Moves technician jobs forward. Returns true when a repair finished (levels must be re-applied). */
  update(step: number, statuses: Record<ZoneId, ZoneStatus>): boolean {
    let finished = false;
    for (const f of this.faults) {
      if (f.resolved) continue;
      const job = f.job;
      if (job.phase === 'travelling' && job.endStep !== null && step >= job.endStep) {
        job.phase = 'waiting';
        job.endStep = null;
      }
      if (job.phase === 'waiting' && f.contained && statuses[f.zoneId] !== 'CRITICAL') {
        job.phase = 'repairing';
        job.endStep = step + REPAIR_STEPS[f.kind];
      }
      if (job.phase === 'repairing' && job.endStep !== null && step >= job.endStep) {
        f.resolved = true;
        f.resolvedStep = step;
        f.job = { phase: 'none', endStep: null };
        finished = true;
      }
    }
    return finished;
  }

  /** Writes the effect of every open issue into the simulation. Call it whenever something changes. */
  applyLevels(sim: ThermalSimulation): void {
    let cooling = 1;
    let machine = 1;
    for (const f of this.faults) {
      if (f.resolved) continue;
      if (f.kind === 'cooling-pump') {
        cooling = f.contained ? DEGRADED_COOLING_EFFECTIVENESS : DEFAULT_COOLING_FAILURE_EFFECTIVENESS;
      } else if (f.kind === 'machine-bearing') {
        machine = !f.contained ? DEFAULT_OVERHEAT_MULTIPLIER : f.variant === 'shutdown' ? 0 : REDUCED_LOAD_MULTIPLIER;
      } else {
        sim.setFire(f.zoneId, f.contained ? 0 : DEFAULT_FIRE_INTENSITY, f.contained);
      }
    }
    sim.setCoolingTarget(cooling);
    sim.setMachineTarget(MACHINE, machine);
  }

  infos(statuses: Record<ZoneId, ZoneStatus>, causes: Causes, step: number): FaultInfo[] {
    const open = this.faults.filter((f) => !f.resolved);
    const done = this.faults.filter((f) => f.resolved).slice(0, 3);
    return [...open, ...done].map((f) => this.describe(f, statuses, causes, step));
  }

  private describe(f: Fault, statuses: Record<ZoneId, ZoneStatus>, causes: Causes, step: number): FaultInfo {
    const zoneName = getZone(f.zoneId).name;
    const left = f.job.endStep !== null ? Math.max(0, f.job.endStep - step) : null;
    const title =
      f.kind === 'cooling-pump' ? 'Cooling pump fault'
        : f.kind === 'machine-bearing' ? 'Machine A bearing overheating'
          : `Fire in ${zoneName}`;

    let summary = '';
    if (f.resolved) {
      summary = f.kind === 'cooling-pump' ? 'Repaired. Cooling is back to full power.'
        : f.kind === 'machine-bearing' ? 'Bearing repaired. The machine runs at its normal load.'
          : 'Area inspected and cleared.';
    } else if (!f.contained) {
      summary = f.kind === 'cooling-pump'
        ? `Cooling output has dropped to ${Math.round(causes.coolingEffectiveness * 100)}% of normal.`
        : f.kind === 'machine-bearing'
          ? `Machine A is producing ${causes.machineMultiplier.toFixed(1)}× its normal heat.`
          : `A fire is burning in ${zoneName}.`;
    } else {
      summary = f.kind === 'cooling-pump'
        ? 'Cooling runs at reduced power (about 70%). The pump still needs repair for full cooling.'
        : f.kind === 'machine-bearing'
          ? f.variant === 'shutdown'
            ? 'Machine A is stopped. Production on it is halted until the bearing is repaired.'
            : 'Symptoms are under control, but Machine A still runs at a reduced load. The bearing needs repair.'
          : 'The fire is out, but the area still needs a safety inspection.';
    }

    let state: FaultInfo['state'];
    let note = '';
    if (f.resolved) state = 'fixed';
    else if (f.job.phase === 'travelling') {
      state = 'travelling';
      note = `Technician is on the way, arriving in about ${left} steps.`;
    } else if (f.job.phase === 'waiting') {
      state = 'waiting';
      note = !f.contained
        ? 'Technician is on site but cannot start: the problem is still active. Use an online fix first.'
        : 'Technician is on site, waiting until the zone is no longer above its limit.';
    } else if (f.job.phase === 'repairing') {
      state = 'repairing';
      note = `Repair in progress, about ${left} steps left.`;
    } else state = f.contained ? 'contained' : 'failing';

    const onlineFixes: ActionId[] = [];
    if (!f.resolved) {
      if (f.kind === 'cooling-pump' && !f.contained) onlineFixes.push('restart-cooling');
      if (f.kind === 'machine-bearing') {
        if (!f.contained) onlineFixes.push('reduce-load');
        if (f.variant !== 'shutdown') onlineFixes.push('shutdown-machine');
      }
      if (f.kind === 'fire' && !f.contained) onlineFixes.push('sprinklers');
      onlineFixes.push('ventilate');
    }
    void statuses;
    return {
      id: f.id, kind: f.kind, zoneId: f.zoneId, title, state, summary, onlineFixes,
      canDispatch: !f.resolved && f.job.phase === 'none',
      jobStepsLeft: f.job.phase === 'travelling' || f.job.phase === 'repairing' ? left : null,
      note, openedStep: f.openedStep, resolvedStep: f.resolvedStep,
    };
  }
}

export const ALL_ZONE_IDS = ZONES.map((z) => z.id);
