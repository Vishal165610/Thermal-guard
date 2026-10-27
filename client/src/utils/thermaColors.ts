import type { ZoneForecast, ZoneState, ZoneStatus } from '@shared/types';
import type { ZoneConfig } from '@shared/zones';

export type DisplayLevel = 'normal' | 'predicted' | 'warning' | 'critical' | 'recovering';

export const LEVEL_COLOR: Record<DisplayLevel, string> = {
  normal: '#16A34A',
  predicted: '#D97706', // amber: the forecast says a breach is possible, limit not crossed yet
  warning: '#D97706',
  critical: '#DC2626',
  recovering: '#0891B2',
};

export const STATUS_COLOR: Record<ZoneStatus, string> = {
  NORMAL: '#16A34A',
  WARNING: '#D97706',
  CRITICAL: '#DC2626',
  RECOVERING: '#0891B2',
};

export const STATUS_LABEL: Record<ZoneStatus, string> = {
  NORMAL: 'Normal',
  WARNING: 'Warning',
  CRITICAL: 'Limit crossed',
  RECOVERING: 'Recovering',
};

/** Rule status first (observed). A forecast warning only shows when the rules still say normal. */
export function displayLevel(zone: ZoneState, forecast?: ZoneForecast): DisplayLevel {
  if (zone.status === 'CRITICAL') return 'critical';
  if (zone.status === 'WARNING') return 'warning';
  if (zone.status === 'RECOVERING') return 'recovering';
  if (forecast?.warning) return 'predicted';
  return 'normal';
}

type RGB = [number, number, number];
const BLUE: RGB = [37, 99, 235];
const GREEN: RGB = [34, 197, 94];
const YELLOW: RGB = [234, 179, 8];
const ORANGE: RGB = [249, 115, 22];
const RED: RGB = [239, 68, 68];
const DARK_RED: RGB = [127, 29, 29];

const mix = (a: RGB, b: RGB, t: number): RGB => {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};

/**
 * Temperature to colour, using the ZONE'S OWN configured numbers:
 *   ambient ........ blue    (cool)
 *   nominal ........ green   (normal for this zone)
 *   up to warning .. yellow, then orange at the warning level
 *   up to limit .... red     (critical)
 *   above limit .... dark red
 */
export function heatColor(t: number, zone: ZoneConfig, nominal: number, ambient: number): RGB {
  const warn = zone.limit - zone.warningMargin;
  if (t <= nominal) return mix(BLUE, GREEN, (t - ambient) / Math.max(1, nominal - ambient));
  if (t <= warn) {
    const u = (t - nominal) / Math.max(1, warn - nominal);
    return u < 0.5 ? mix(GREEN, YELLOW, u * 2) : mix(YELLOW, ORANGE, (u - 0.5) * 2);
  }
  if (t <= zone.limit) return mix(ORANGE, RED, (t - warn) / Math.max(1, zone.limit - warn));
  return mix(RED, DARK_RED, (t - zone.limit) / 20);
}

export const fmtTemp = (v: number) => `${v.toFixed(1)}°C`;

export function riskWord(score: number | null): { word: string; color: string } {
  if (score === null) return { word: 'Trend only', color: '#64748B' };
  if (score >= 0.5) return { word: 'High', color: '#D97706' };
  if (score >= 0.3) return { word: 'Rising', color: '#0F172A' };
  return { word: 'Low', color: '#16A34A' };
}
