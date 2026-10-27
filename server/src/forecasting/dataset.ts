import { FEATURE_COUNT, OUTPUT_COUNT, buildFeatures, encodeDelta } from '../../../shared/features';
import { FORECAST_HORIZON, FORECAST_POINTS, ZONES, ZONE_IDS } from '../../../shared/zones';
import type { ScenarioId, ZoneId } from '../../../shared/types';
import { ThermalSimulation } from '../simulation/thermalSimulation';

// Small seeded random generator so the same seed always gives the same dataset.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Dataset {
  x: number[][];
  y: number[][];
  positives: number;
  episodes: number;
}

interface Options {
  episodes: number;
  seed: number;
  stepsPerEpisode?: number;
}

const PAD = 40; // steady-state steps placed before each episode so history is always available

/**
 * Generates training sequences by running the SAME thermal simulation with randomised incidents
 * (different scenario types, zones, severities, start times and recovery times).
 */
export function generateDataset({ episodes, seed, stepsPerEpisode = 300 }: Options): Dataset {
  const rand = mulberry32(seed);
  const between = (a: number, b: number) => a + (b - a) * rand();
  const sim = new ThermalSimulation();
  const x: number[][] = [];
  const y: number[][] = [];
  let positives = 0;

  for (let ep = 0; ep < episodes; ep++) {
    sim.reset();
    const base = sim.getBaselinePeaks();
    const series: number[][] = ZONES.map((_, z) => Array(PAD).fill(base[z]));

    const r = rand();
    const kind: ScenarioId =
      r < 0.12 ? 'normal' : r < 0.42 ? 'cooling-failure' : r < 0.72 ? 'machine-overheating' : 'fire';
    const onset = Math.floor(between(15, 70));
    const restoreAt = rand() < 0.6 ? onset + Math.floor(between(25, 160)) : Infinity;
    const fireZone: ZoneId = ZONE_IDS[Math.floor(rand() * ZONE_IDS.length)];
    const severity =
      kind === 'cooling-failure' ? between(0.0, 0.55)
        : kind === 'machine-overheating' ? between(1.5, 3.4)
          : between(0.35, 1.2);
    const machine = rand() < 0.5 ? 'machine-a' : 'machine-b';

    for (let s = 0; s < stepsPerEpisode; s++) {
      if (s === onset && kind !== 'normal') sim.setScenario(kind, { zoneId: fireZone, severity, machine });
      if (s === restoreAt) sim.setScenario('normal');
      sim.tick();
      const stats = sim.getZoneStats();
      for (let z = 0; z < ZONES.length; z++) series[z].push(stats[z].peak);
    }

    // Turn the recorded series into (features -> future) examples.
    const total = series[0].length;
    for (let z = 0; z < ZONES.length; z++) {
      const zone = ZONES[z];
      const s = series[z];
      for (let t = PAD; t < total - FORECAST_HORIZON; t += 2) {
        const now = s[t];
        if (now >= zone.limit) continue; // already breached: nothing left to predict
        let maxFuture = -Infinity;
        for (let k = 1; k <= FORECAST_HORIZON; k++) maxFuture = Math.max(maxFuture, s[t + k]);
        const risk = maxFuture >= zone.limit ? 1 : 0;
        const slope = (now - s[t - 8]) / 8;
        const interesting = risk === 1 || Math.abs(slope) > 0.03 || zone.limit - now < 10;
        if (!interesting && rand() > 0.06) continue; // thin out boring flat samples
        const feats = buildFeatures(s.slice(t - 30, t + 1), z);
        const target = [risk, ...FORECAST_POINTS.map((h) => encodeDelta(s[t + h] - now))];
        if (feats.length !== FEATURE_COUNT || target.length !== OUTPUT_COUNT) throw new Error('shape mismatch');
        x.push(feats);
        y.push(target);
        if (risk === 1) positives++;
      }
    }
  }
  return { x, y, positives, episodes };
}
