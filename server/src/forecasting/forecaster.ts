import fs from 'node:fs';
import type { ModelStatus, ZoneForecast, ZoneId } from '../../../shared/types';
import {
  FEATURE_COUNT, OUTPUT_COUNT, buildFeatures, decodeDelta,
} from '../../../shared/features';
import {
  AI_WARN_RISK, FORECAST_HORIZON, FORECAST_POINTS, ZONES,
} from '../../../shared/zones';
import { MODEL_FILE, loadModel } from './modelIO';
import { trendEstimate } from './trendFallback';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Loads the trained TensorFlow.js model once and runs inference on live simulation history.
 * It never trains. If the model file is missing or fails to load, `predict` returns clearly
 * labelled trend-fallback estimates instead.
 */
export class Forecaster {
  private tf: any = null;
  private model: any = null;
  status: ModelStatus = {
    state: 'missing', message: 'Model not loaded yet', horizon: FORECAST_HORIZON,
  };

  async load(): Promise<void> {
    if (!fs.existsSync(MODEL_FILE)) {
      this.status = {
        state: 'missing',
        message: 'No trained model found. Run "npm run train". Showing trend estimates instead (not AI).',
        horizon: FORECAST_HORIZON,
      };
      return;
    }
    try {
      this.tf = await import('@tensorflow/tfjs');
      await this.tf.setBackend('cpu');
      await this.tf.ready();
      const { model, meta } = await loadModel(this.tf);
      const inputDim = model.inputs[0].shape[1];
      const outputDim = model.outputs[0].shape[1];
      if (inputDim !== FEATURE_COUNT || outputDim !== OUTPUT_COUNT) {
        throw new Error(`model shape ${inputDim}->${outputDim} does not match expected ${FEATURE_COUNT}->${OUTPUT_COUNT}; retrain`);
      }
      this.model = model;
      this.status = {
        state: 'ready',
        message: 'Neural network loaded',
        horizon: FORECAST_HORIZON,
        trainedAt: meta.trainedAt,
        trainingSamples: meta.trainingSamples,
        epochs: meta.epochs,
      };
    } catch (err) {
      this.model = null;
      this.status = {
        state: 'error',
        message: `Model failed to load (${(err as Error).message}). Showing trend estimates instead (not AI).`,
        horizon: FORECAST_HORIZON,
      };
    }
  }

  get ready(): boolean {
    return this.model !== null;
  }

  predict(histories: Record<ZoneId, number[]>): Record<ZoneId, ZoneForecast> {
    const out = {} as Record<ZoneId, ZoneForecast>;
    if (!this.model) {
      ZONES.forEach((z, i) => { out[z.id] = trendEstimate(histories[z.id], i); });
      return out;
    }
    try {
      const tf = this.tf;
      const rows = ZONES.map((z, i) => buildFeatures(histories[z.id], i));
      const result: Float32Array | number[] = tf.tidy(() => {
        const x = tf.tensor2d(rows, [ZONES.length, FEATURE_COUNT]);
        return (this.model.predict(x) as any).dataSync();
      });
      ZONES.forEach((z, i) => {
        const h = histories[z.id];
        const t = h[h.length - 1];
        const risk = result[i * OUTPUT_COUNT];
        const predicted = FORECAST_POINTS.map((s, k) => ({
          step: s,
          temp: t + decodeDelta(result[i * OUTPUT_COUNT + 1 + k]),
        }));
        out[z.id] = {
          zoneId: z.id,
          source: 'neural-network',
          riskScore: Math.round(risk * 1000) / 1000,
          warning: risk >= AI_WARN_RISK && t < z.limit,
          horizon: FORECAST_HORIZON,
          predicted,
          projectedBreachInSteps: firstCrossing(t, predicted, z.limit),
          slope: h.length > 8 ? (t - h[h.length - 9]) / 8 : 0,
        };
      });
      return out;
    } catch (err) {
      // Inference failed at runtime: fall back, and say so.
      this.model = null;
      this.status = {
        state: 'error',
        message: `Inference failed (${(err as Error).message}). Showing trend estimates instead (not AI).`,
        horizon: FORECAST_HORIZON,
      };
      ZONES.forEach((z, i) => { out[z.id] = trendEstimate(histories[z.id], i); });
      return out;
    }
  }
}

/** First step where the estimated trajectory reaches the limit (linear between sample points). */
function firstCrossing(t0: number, pts: { step: number; temp: number }[], limit: number): number | null {
  if (t0 >= limit) return null;
  let prevStep = 0;
  let prevTemp = t0;
  for (const p of pts) {
    if (p.temp >= limit) {
      const f = (limit - prevTemp) / (p.temp - prevTemp);
      return Math.max(1, Math.round(prevStep + f * (p.step - prevStep)));
    }
    prevStep = p.step;
    prevTemp = p.temp;
  }
  return null;
}
