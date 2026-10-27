import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The model is stored as ONE json file (topology + weights as base64), so it can be saved and
// loaded with the plain-JavaScript TensorFlow.js build. No native add-ons are needed.
export const MODEL_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../models/thermal-guard-model.json',
);

export interface ModelMeta {
  trainedAt: string;
  trainingSamples: number;
  epochs: number;
  featureVersion: number;
  seed: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function saveModel(tf: any, model: any, meta: ModelMeta, file = MODEL_FILE): Promise<void> {
  let payload: any = null;
  await model.save(
    tf.io.withSaveHandler(async (artifacts: any) => {
      const parts: ArrayBuffer[] = Array.isArray(artifacts.weightData)
        ? artifacts.weightData : [artifacts.weightData];
      const buf = Buffer.concat(parts.map((p) => Buffer.from(p)));
      payload = {
        meta,
        modelTopology: artifacts.modelTopology,
        weightSpecs: artifacts.weightSpecs,
        weightsBase64: buf.toString('base64'),
      };
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
    }),
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
}

export async function loadModel(tf: any, file = MODEL_FILE): Promise<{ model: any; meta: ModelMeta }> {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const buf = Buffer.from(raw.weightsBase64, 'base64');
  const weightData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const model = await tf.loadLayersModel(
    tf.io.fromMemory({
      modelTopology: raw.modelTopology,
      weightSpecs: raw.weightSpecs,
      weightData,
    }),
  );
  return { model, meta: raw.meta as ModelMeta };
}
