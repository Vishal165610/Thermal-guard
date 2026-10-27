import type { ZoneForecast } from '../../../shared/types';
import { FORECAST_HORIZON, FORECAST_POINTS, ZONES } from '../../../shared/zones';

/**
 * Simple straight-line trend estimate. This is NOT a neural network and is always labelled
 * as 'trend-fallback'. It is only used when the trained model is missing or failed to load.
 */
export function trendEstimate(history: number[], zoneIdx: number): ZoneForecast {
  const zone = ZONES[zoneIdx];
  const n = history.length;
  const t = history[n - 1];
  const slope = n > 8 ? (t - history[n - 9]) / 8 : 0;
  const predicted = FORECAST_POINTS.map((s) => ({ step: s, temp: t + slope * s }));
  const stepsToLimit = slope > 0.01 ? (zone.limit - t) / slope : null;
  const projected = stepsToLimit !== null && stepsToLimit > 0 && stepsToLimit <= FORECAST_HORIZON
    ? Math.ceil(stepsToLimit) : null;
  return {
    zoneId: zone.id,
    source: 'trend-fallback',
    riskScore: null,
    warning: projected !== null && t < zone.limit,
    horizon: FORECAST_HORIZON,
    predicted,
    projectedBreachInSteps: projected,
    slope,
  };
}
