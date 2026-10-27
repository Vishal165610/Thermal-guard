import type { ZoneId } from '../../../shared/types';

// Physics constants for the 40 x 25 thermal grid. One tick = one fixed step.
export const ALPHA = 0.16; // how strongly a cell blends with its neighbours (diffusion)
export const K_BASE = 0.018; // loss to ambient everywhere
export const K_COOL_LOCAL = 0.08; // extra loss inside the cooling unit zone (scaled by cooling effectiveness)
export const K_COOL_HALO = 0.004; // small cooling effect elsewhere (facility air) (scaled by effectiveness)
export const K_SUPPRESS = 0.05; // extra loss while a fire zone is being brought under control
export const K_VENT = 0.03; // extra loss in a zone while boosted ventilation is on
export const DEGRADED_COOLING_EFFECTIVENESS = 0.7; // cooling after a remote restart, until it is repaired
export const REDUCED_LOAD_MULTIPLIER = 1.2; // machine heat output after 'reduce load'
export const MAX_TEMP = 400;
export const WARMUP_STEPS = 900;

export type SourceKind = 'static' | 'machine' | 'compressor';

export interface HeatSource {
  id: string;
  zoneId: ZoneId;
  /** Position in grid cells. */
  x: number;
  y: number;
  radius: number;
  /** Peak heating in degrees C per step at the centre, at normal operation. */
  power: number;
  kind: SourceKind;
}

export const HEAT_SOURCES: HeatSource[] = [
  { id: 'boiler-core', zoneId: 'boiler', x: 5.5, y: 4.5, radius: 3.6, power: 1.7, kind: 'static' },
  { id: 'machine-a', zoneId: 'production', x: 17.5, y: 6, radius: 3, power: 1.0, kind: 'machine' },
  { id: 'machine-b', zoneId: 'production', x: 23, y: 6, radius: 3, power: 1.0, kind: 'machine' },
  { id: 'compressor', zoneId: 'cooling', x: 33.5, y: 6, radius: 3.5, power: 0.8, kind: 'compressor' },
  { id: 'cabinet-a', zoneId: 'electrical', x: 17.5, y: 18.5, radius: 2.6, power: 0.7, kind: 'static' },
  { id: 'cabinet-b', zoneId: 'electrical', x: 23, y: 18.5, radius: 2.6, power: 0.7, kind: 'static' },
  { id: 'motor-a', zoneId: 'packaging', x: 31, y: 18.5, radius: 2.6, power: 0.38, kind: 'static' },
  { id: 'motor-b', zoneId: 'packaging', x: 36, y: 18.5, radius: 2.6, power: 0.38, kind: 'static' },
];

export const FIRE_RADIUS = 2.8;
export const FIRE_POWER = 3.2; // degrees C per step at the centre when intensity = 1

// Default scenario severities.
export const DEFAULT_COOLING_FAILURE_EFFECTIVENESS = 0.03;
export const DEFAULT_OVERHEAT_MULTIPLIER = 2.8;
export const DEFAULT_FIRE_INTENSITY = 1.0;
