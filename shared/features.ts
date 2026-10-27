import { AMBIENT_TEMP, ZONES } from './zones';

// The neural network sees ONLY these numbers: recent peak-temperature history
// for one zone, that zone's limits, and which zone it is. It is never told
// which incident scenario is running.

export const FEATURE_VERSION = 1;
const LAGS = [1, 2, 3, 4, 6, 8, 10, 12, 15, 18, 21, 24];
export const MIN_HISTORY = 25;
export const FEATURE_COUNT = 3 + LAGS.length + 1 + ZONES.length; // 22
export const OUTPUT_COUNT = 7; // [risk, +5, +10, +15, +20, +25, +30 step temperature changes]

// Temperature-change targets are squashed into 0..1 for a sigmoid output.
export const DELTA_OFFSET = 15;
export const DELTA_SCALE = 60;
export const encodeDelta = (d: number) => Math.min(1, Math.max(0, (d + DELTA_OFFSET) / DELTA_SCALE));
export const decodeDelta = (v: number) => v * DELTA_SCALE - DELTA_OFFSET;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `history` = peak temperatures of one zone, oldest first, newest last. */
export function buildFeatures(history: number[], zoneIdx: number): number[] {
  const zone = ZONES[zoneIdx];
  const n = history.length;
  const at = (k: number) => history[Math.max(0, n - 1 - k)]; // value k steps ago
  const t = at(0);
  const f: number[] = [];
  f.push(clamp((zone.limit - t) / 30, -5, 5)); // distance to limit
  f.push(clamp((zone.limit - zone.warningMargin - t) / 30, -5, 5)); // distance to warning level
  f.push(clamp((t - AMBIENT_TEMP) / 80, -5, 5)); // how far above ambient
  for (const k of LAGS) f.push(clamp((t - at(k)) / 10, -5, 5)); // rise over last k steps
  const accel = t - at(8) - (at(8) - at(16)); // is the rise speeding up?
  f.push(clamp(accel / 10, -5, 5));
  for (let i = 0; i < ZONES.length; i++) f.push(i === zoneIdx ? 1 : 0);
  return f;
}
