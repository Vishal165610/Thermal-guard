import type { ActionId, IncidentInfo, ScenarioId, ZoneId } from '../../../shared/types';
import {
  AMBIENT_TEMP, GRID_H, GRID_W, ZONES, getZone, zoneIndex, zoneIndexOfCell,
} from '../../../shared/zones';
import {
  ALPHA, DEFAULT_COOLING_FAILURE_EFFECTIVENESS, DEFAULT_FIRE_INTENSITY,
  DEFAULT_OVERHEAT_MULTIPLIER, FIRE_POWER, FIRE_RADIUS, HEAT_SOURCES, K_BASE,
  K_COOL_HALO, K_COOL_LOCAL, K_SUPPRESS, K_VENT, MAX_TEMP, REDUCED_LOAD_MULTIPLIER, WARMUP_STEPS,
} from './config';

const N = GRID_W * GRID_H;
const COOLING_IDX = zoneIndex('cooling');

export interface ZoneStat {
  id: ZoneId;
  avg: number;
  peak: number;
  min: number;
}

export interface ScenarioOptions {
  zoneId?: ZoneId;
  /** Cooling: effectiveness target (0..1). Overheating: heat multiplier. Fire: intensity. */
  severity?: number;
  machine?: 'machine-a' | 'machine-b';
}

interface Footprint {
  idx: Int32Array;
  w: Float32Array;
}

function makeFootprint(cx: number, cy: number, radius: number): Footprint {
  const sigma = radius / 1.5;
  const reach = Math.ceil(radius * 1.8);
  const idx: number[] = [];
  const w: number[] = [];
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      const v = Math.exp(-d2 / (2 * sigma * sigma));
      if (v > 0.02) {
        idx.push(y * GRID_W + x);
        w.push(v);
      }
    }
  }
  return { idx: Int32Array.from(idx), w: Float32Array.from(w) };
}

const approach = (cur: number, target: number, up: number, down: number) =>
  cur < target ? Math.min(target, cur + up) : Math.max(target, cur - down);

// The "normal operation" steady state is computed once and reused for every reset.
let warmCache: { grid: Float32Array; baseline: number[] } | null = null;

export class ThermalSimulation {
  grid = new Float32Array(N);
  private next = new Float32Array(N);
  private heat = new Float32Array(N);
  private coolCoef = new Float32Array(N);
  private cellZone = new Int8Array(N);
  private sourceFootprints: Footprint[];
  private fireFootprints: Footprint[];

  step = 0;

  // --- operator-controlled conditions (current value ramps towards target) ---
  private coolingEff = 1;
  private coolingTarget = 1;
  private machineMult: Record<string, number> = {};
  private machineTarget: Record<string, number> = {};
  private fireIntensity: number[] = ZONES.map(() => 0);
  private fireTarget: number[] = ZONES.map(() => 0);
  private suppressing: boolean[] = ZONES.map(() => false);
  private ventilation: boolean[] = ZONES.map(() => false);
  private lastPeaks: number[] = ZONES.map(() => AMBIENT_TEMP);

  private baseline: number[] = ZONES.map(() => AMBIENT_TEMP);
  private incident: { scenario: ScenarioId; zoneId: ZoneId | null; startedStep: number | null } = {
    scenario: 'normal', zoneId: null, startedStep: null,
  };

  constructor() {
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        const z = zoneIndexOfCell(x, y);
        this.cellZone[i] = z;
        this.coolCoef[i] = z === COOLING_IDX ? K_COOL_LOCAL : K_COOL_HALO;
      }
    }
    this.sourceFootprints = HEAT_SOURCES.map((s) => makeFootprint(s.x, s.y, s.radius));
    this.fireFootprints = ZONES.map((z) =>
      makeFootprint((z.x0 + z.x1 - 1) / 2, (z.y0 + z.y1 - 1) / 2, FIRE_RADIUS));
    this.reset();
  }

  /** Back to normal operation, fully settled, step 0. */
  reset(): void {
    if (!warmCache) {
      this.grid.fill(AMBIENT_TEMP);
      this.clearControls();
      for (let i = 0; i < WARMUP_STEPS; i++) this.advance();
      warmCache = { grid: this.grid.slice(), baseline: this.lastPeaks.slice() };
    }
    this.grid.set(warmCache.grid);
    this.baseline = warmCache.baseline.slice();
    this.lastPeaks = warmCache.baseline.slice();
    this.clearControls();
    this.step = 0;
    this.incident = { scenario: 'normal', zoneId: null, startedStep: null };
  }

  private clearControls(): void {
    this.coolingEff = 1;
    this.coolingTarget = 1;
    for (const s of HEAT_SOURCES) {
      this.machineMult[s.id] = 1;
      this.machineTarget[s.id] = 1;
    }
    this.fireIntensity = ZONES.map(() => 0);
    this.fireTarget = ZONES.map(() => 0);
    this.suppressing = ZONES.map(() => false);
    this.ventilation = ZONES.map(() => false);
  }

  getBaselinePeaks(): number[] {
    return this.baseline.slice();
  }

  getCoolingEffectiveness(): number {
    return this.coolingEff;
  }

  /** Apply an operator scenario. Scenarios are exclusive: each call starts from normal conditions. */
  setScenario(scenario: ScenarioId, opts: ScenarioOptions = {}): void {
    // Anything that was burning gets suppressed when the incident changes.
    for (let z = 0; z < ZONES.length; z++) {
      if (this.fireIntensity[z] > 0) this.suppressing[z] = true;
      this.fireTarget[z] = 0;
    }
    this.coolingTarget = 1;
    for (const s of HEAT_SOURCES) this.machineTarget[s.id] = 1;
    this.ventilation = ZONES.map(() => false);

    let zoneId: ZoneId | null = null;
    if (scenario === 'cooling-failure') {
      this.coolingTarget = opts.severity ?? DEFAULT_COOLING_FAILURE_EFFECTIVENESS;
      zoneId = 'cooling';
    } else if (scenario === 'machine-overheating') {
      this.machineTarget[opts.machine ?? 'machine-a'] = opts.severity ?? DEFAULT_OVERHEAT_MULTIPLIER;
      zoneId = 'production';
    } else if (scenario === 'fire') {
      zoneId = opts.zoneId ?? 'storage';
      const z = zoneIndex(zoneId);
      this.fireTarget[z] = opts.severity ?? DEFAULT_FIRE_INTENSITY;
      this.suppressing[z] = false;
    }
    this.incident = {
      scenario,
      zoneId,
      startedStep: scenario === 'normal' ? null : this.step,
    };
  }

  // --- low-level controls used by the fault manager (targets ramp, they do not jump) ---
  setCoolingTarget(v: number): void {
    this.coolingTarget = v;
  }

  setMachineTarget(id: string, v: number): void {
    this.machineTarget[id] = v;
  }

  setFire(zoneId: ZoneId, target: number, suppress: boolean): void {
    const z = zoneIndex(zoneId);
    if (target > 0) this.suppressing[z] = false;
    else if (suppress && this.fireIntensity[z] > 0) this.suppressing[z] = true;
    this.fireTarget[z] = target;
  }

  /**
   * Apply an operator corrective action. These change the real simulation, exactly like the
   * incident buttons do. Returns false if the action makes no sense right now.
   */
  applyAction(action: ActionId, zoneId?: ZoneId): boolean {
    switch (action) {
      case 'restart-cooling':
        this.coolingTarget = 1;
        return true;
      case 'reduce-load':
        for (const s of HEAT_SOURCES) {
          if (s.kind === 'machine' && this.machineTarget[s.id] > REDUCED_LOAD_MULTIPLIER) {
            this.machineTarget[s.id] = REDUCED_LOAD_MULTIPLIER;
          }
        }
        return true;
      case 'shutdown-machine':
        // the machine that is running hottest
        {
          let hottest = 'machine-a';
          for (const s of HEAT_SOURCES) {
            if (s.kind === 'machine' && this.machineTarget[s.id] > this.machineTarget[hottest]) hottest = s.id;
          }
          this.machineTarget[hottest] = 0;
        }
        return true;
      case 'sprinklers': {
        const z = zoneIndex(zoneId ?? this.incident.zoneId ?? 'storage');
        this.fireTarget[z] = 0;
        this.suppressing[z] = true;
        return true;
      }
      case 'ventilate': {
        const z = zoneIndex(zoneId ?? this.incident.zoneId ?? 'storage');
        this.ventilation[z] = true;
        return true;
      }
    }
    return false;
  }

  /** Readings an operator could see: what is wrong, not which button was pressed. */
  getCauses(): { coolingEffectiveness: number; machineMultiplier: number; fireZones: ZoneId[] } {
    let machineMultiplier = 1;
    for (const s of HEAT_SOURCES) {
      if (s.kind === 'machine') machineMultiplier = Math.max(machineMultiplier, this.machineMult[s.id]);
    }
    return {
      coolingEffectiveness: this.coolingEff,
      machineMultiplier,
      fireZones: ZONES.filter((_, z) => this.fireIntensity[z] > 0.05).map((z) => z.id),
    };
  }

  getIncident(): IncidentInfo {
    const { scenario, zoneId, startedStep } = this.incident;
    const where = zoneId ? getZone(zoneId).name : '';
    const description: Record<ScenarioId, string> = {
      normal: 'Normal operation',
      'cooling-failure': 'Cooling failure: cooling effectiveness is being reduced',
      'machine-overheating': 'Machine overheating: heat output of a production machine is rising',
      fire: `Fire scenario in ${where}: rapid abnormal temperature rise`,
    };
    return {
      scenario, zoneId, startedStep,
      description: description[scenario],
      coolingEffectiveness: Math.round(this.coolingEff * 100) / 100,
    };
  }

  tick(): void {
    this.advance();
    this.step++;
  }

  private advance(): void {
    // 1) ramp operator conditions toward their targets
    this.coolingEff = approach(this.coolingEff, this.coolingTarget, 0.05, 0.05);
    for (const s of HEAT_SOURCES) {
      if (s.kind === 'machine') {
        this.machineMult[s.id] = approach(this.machineMult[s.id], this.machineTarget[s.id], 0.06, 0.06);
      }
    }
    for (let z = 0; z < ZONES.length; z++) {
      this.fireIntensity[z] = approach(this.fireIntensity[z], this.fireTarget[z], 0.04, 0.12);
      // Suppression ends once the zone is back near its normal peak.
      if (this.suppressing[z] && this.fireIntensity[z] === 0 && this.lastPeaks[z] < this.baseline[z] + 4) {
        this.suppressing[z] = false;
      }
    }

    // 2) heat input map
    const { grid, next, heat } = this;
    heat.fill(0);
    for (let s = 0; s < HEAT_SOURCES.length; s++) {
      const src = HEAT_SOURCES[s];
      const p = src.power * (src.kind === 'machine' ? this.machineMult[src.id] : 1);
      const fp = this.sourceFootprints[s];
      for (let k = 0; k < fp.idx.length; k++) heat[fp.idx[k]] += p * fp.w[k];
    }
    for (let z = 0; z < ZONES.length; z++) {
      const f = this.fireIntensity[z];
      if (f <= 0) continue;
      const fp = this.fireFootprints[z];
      for (let k = 0; k < fp.idx.length; k++) heat[fp.idx[k]] += FIRE_POWER * f * fp.w[k];
    }

    // 3) diffusion + heating + cooling to ambient
    const eff = this.coolingEff;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        const t = grid[i];
        const l = grid[x > 0 ? i - 1 : i];
        const r = grid[x < GRID_W - 1 ? i + 1 : i];
        const u = grid[y > 0 ? i - GRID_W : i];
        const d = grid[y < GRID_H - 1 ? i + GRID_W : i];
        const avg = (l + r + u + d) / 4;
        const z = this.cellZone[i];
        const k = K_BASE + this.coolCoef[i] * eff + (this.suppressing[z] ? K_SUPPRESS : 0) + (this.ventilation[z] ? K_VENT : 0);
        let nt = t + ALPHA * (avg - t) + heat[i] - k * (t - AMBIENT_TEMP);
        if (nt > MAX_TEMP) nt = MAX_TEMP;
        if (nt < AMBIENT_TEMP - 5) nt = AMBIENT_TEMP - 5;
        next[i] = nt;
      }
    }
    this.grid = next;
    this.next = grid;

    const stats = this.getZoneStats();
    for (let z = 0; z < ZONES.length; z++) this.lastPeaks[z] = stats[z].peak;
  }

  getZoneStats(): ZoneStat[] {
    const sums = ZONES.map(() => 0);
    const counts = ZONES.map(() => 0);
    const peaks = ZONES.map(() => -Infinity);
    const mins = ZONES.map(() => Infinity);
    for (let i = 0; i < N; i++) {
      const z = this.cellZone[i];
      const t = this.grid[i];
      sums[z] += t;
      counts[z]++;
      if (t > peaks[z]) peaks[z] = t;
      if (t < mins[z]) mins[z] = t;
    }
    return ZONES.map((z, k) => ({
      id: z.id,
      avg: sums[k] / counts[k],
      peak: peaks[k],
      min: mins[k],
    }));
  }
}
