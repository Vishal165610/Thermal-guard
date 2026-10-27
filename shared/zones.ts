import type { ZoneId } from './types';

// ---- Global constants (one place, used by server, training and client) ----
export const GRID_W = 40;
export const GRID_H = 25;
export const AMBIENT_TEMP = 24;
export const TICK_MS = 500; // one simulation step every 0.5 s of wall-clock time
export const SPEEDS = [0.25, 0.5, 1, 2] as const; // playback speed multipliers
export const DEFAULT_SPEED = 0.5; // slow enough to explain to an audience
export const FORECAST_HORIZON = 30; // steps
export const FORECAST_POINTS = [5, 10, 15, 20, 25, 30] as const;
export const HISTORY_LEN = 120;
export const AI_WARN_RISK = 0.5; // neural risk score at/above which we call it a warning
export const AI_CONFIRM_STEPS = 3; // consecutive steps needed to confirm an AI warning
export const HYSTERESIS = 2; // degrees C, prevents alert flapping near a threshold
export const RECOVERY_BAND = 2; // extra degrees below (warning - hysteresis) to return to NORMAL

export interface ZoneConfig {
  id: ZoneId;
  name: string;
  shortName: string;
  col: number; // 0..2 in the 3x2 factory layout
  row: number; // 0..1
  /** Grid rectangle: x0..x1 and y0..y1 (end exclusive). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Critical limit in degrees C. */
  limit: number;
  /** Warning begins at (limit - warningMargin). */
  warningMargin: number;
  guidance: string[];
}

export const ZONES: ZoneConfig[] = [
  {
    id: 'boiler', name: 'Boiler Unit', shortName: 'BOILER', col: 0, row: 0,
    x0: 0, x1: 13, y0: 0, y1: 12, limit: 95, warningMargin: 10,
    guidance: [
      'Check the pressure gauge and relief valve on the boiler.',
      'Look at the fuel / feed rate and recent changes to the setpoint.',
      'Confirm that nearby pipes and lagging are intact.',
    ],
  },
  {
    id: 'production', name: 'Production Area', shortName: 'PRODUCTION', col: 1, row: 0,
    x0: 13, x1: 27, y0: 0, y1: 12, limit: 80, warningMargin: 10,
    guidance: [
      'Inspect the machine that is running hottest (bearings, motor, lubrication).',
      'Check the load: is a machine running above its normal duty?',
      'Be ready to reduce the load or pause the line.',
    ],
  },
  {
    id: 'cooling', name: 'Cooling Unit', shortName: 'COOLING', col: 2, row: 0,
    x0: 27, x1: 40, y0: 0, y1: 12, limit: 45, warningMargin: 6,
    guidance: [
      'Check that both fans are turning and the airflow is not blocked.',
      'Check coolant level, pump status and filters.',
      'Neighbouring zones depend on this unit: watch them too.',
    ],
  },
  {
    id: 'storage', name: 'Storage Area', shortName: 'STORAGE', col: 0, row: 1,
    x0: 0, x1: 13, y0: 12, y1: 25, limit: 42, warningMargin: 7,
    guidance: [
      'Look for the source of the heat or smoke before approaching.',
      'Keep flammable material away from the hot area.',
      'Follow the site emergency procedure if a fire is suspected.',
    ],
  },
  {
    id: 'electrical', name: 'Electrical Control', shortName: 'ELECTRICAL', col: 1, row: 1,
    x0: 13, x1: 27, y0: 12, y1: 25, limit: 60, warningMargin: 8,
    guidance: [
      'Check cabinet ventilation and filters.',
      'Look for overloaded circuits or loose connections.',
      'Only qualified staff should open live cabinets.',
    ],
  },
  {
    id: 'packaging', name: 'Packaging Area', shortName: 'PACKAGING', col: 2, row: 1,
    x0: 27, x1: 40, y0: 12, y1: 25, limit: 46, warningMargin: 7,
    guidance: [
      'Check the conveyor motors and rollers for friction or jams.',
      'Make sure ventilation near the line is not blocked.',
      'Slow or stop the line if a motor keeps heating.',
    ],
  },
];

export const ZONE_IDS: ZoneId[] = ZONES.map((z) => z.id);

export function zoneIndex(id: ZoneId): number {
  return ZONES.findIndex((z) => z.id === id);
}

export function getZone(id: ZoneId): ZoneConfig {
  return ZONES[zoneIndex(id)];
}

/** Which zone owns grid cell (x, y). Every cell belongs to exactly one zone. */
export function zoneIndexOfCell(x: number, y: number): number {
  return ZONES.findIndex((z) => x >= z.x0 && x < z.x1 && y >= z.y0 && y < z.y1);
}
