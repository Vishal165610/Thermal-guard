// Train the breach-forecast model on generated simulation data.
//   npm run train
// Dataset generation is seeded, weight initialisation is seeded and the data is shuffled with a
// seeded shuffle, so repeated runs on the same machine give the same dataset and a very similar model.
import * as tf from '@tensorflow/tfjs';
import { FEATURE_COUNT, FEATURE_VERSION, OUTPUT_COUNT } from '../../../shared/features';
import { AI_WARN_RISK } from '../../../shared/zones';
import { generateDataset, mulberry32 } from './dataset';
import { MODEL_FILE, saveModel } from './modelIO';

const SEED = 20260;
const EPISODES = Number(process.env.EPISODES ?? 700);
const EPOCHS = Number(process.env.EPOCHS ?? 25);

async function main() {
  await tf.setBackend('cpu');
  await tf.ready();

  console.log(`Generating ${EPISODES} simulated incident sequences (seed ${SEED})...`);
  const t0 = Date.now();
  const ds = generateDataset({ episodes: EPISODES, seed: SEED });
  console.log(
    `  ${ds.x.length} samples, ${ds.positives} labelled "breach within 30 steps" ` +
    `(${((100 * ds.positives) / ds.x.length).toFixed(1)}%), ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  // seeded shuffle, then split: 85% train / 15% held-out validation (never duplicated)
  const rand = mulberry32(SEED + 1);
  const shuffle = (a: number[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const order = shuffle(ds.x.map((_, i) => i));
  const nVal = Math.floor(order.length * 0.15);
  const valIdx = order.slice(0, nVal);
  const trainBase = order.slice(nVal);
  // Breach cases are rare (a few %), so repeat them in the TRAINING part only. Otherwise the
  // network learns to answer "no breach" almost always.
  const OVERSAMPLE = 4;
  const trainIdx: number[] = [];
  for (const i of trainBase) {
    const reps = ds.y[i][0] >= 0.5 ? OVERSAMPLE : 1;
    for (let r = 0; r < reps; r++) trainIdx.push(i);
  }
  shuffle(trainIdx);
  console.log(`  train ${trainIdx.length} (breach cases repeated x${OVERSAMPLE}), validation ${valIdx.length} (not repeated)`);
  const toX = (idx: number[]) => tf.tensor2d(idx.map((i) => ds.x[i]), [idx.length, FEATURE_COUNT]);
  const toY = (idx: number[]) => tf.tensor2d(idx.map((i) => ds.y[i]), [idx.length, OUTPUT_COUNT]);
  const xs = toX(trainIdx);
  const ys = toY(trainIdx);
  const xVal = toX(valIdx);
  const yVal = toY(valIdx);

  const model = tf.sequential({
    layers: [
      tf.layers.dense({
        inputShape: [FEATURE_COUNT], units: 48, activation: 'relu',
        kernelInitializer: tf.initializers.glorotUniform({ seed: 1 }),
      }),
      tf.layers.dense({
        units: 24, activation: 'relu',
        kernelInitializer: tf.initializers.glorotUniform({ seed: 2 }),
      }),
      tf.layers.dense({
        units: OUTPUT_COUNT, activation: 'sigmoid',
        kernelInitializer: tf.initializers.glorotUniform({ seed: 3 }),
      }),
    ],
  });
  model.compile({ optimizer: tf.train.adam(0.003), loss: 'meanSquaredError' });
  model.summary();

  const hist = await model.fit(xs, ys, {
    epochs: EPOCHS,
    batchSize: 256,
    validationData: [xVal, yVal],
    shuffle: false,
    verbose: 0,
    callbacks: {
      onEpochEnd: (epoch, logs) =>
        console.log(`  epoch ${epoch + 1}/${EPOCHS}  loss ${logs?.loss?.toFixed(5)}  val_loss ${logs?.val_loss?.toFixed(5)}`),
    },
  });

  // Plain, honest check on the held-out split of the GENERATED data (not real-world data).
  const pred = model.predict(xVal) as tf.Tensor;
  const p = pred.dataSync();
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < valIdx.length; i++) {
    const truth = ds.y[valIdx[i]][0] >= 0.5;
    const said = p[i * OUTPUT_COUNT] >= AI_WARN_RISK;
    if (said && truth) tp++; else if (said) fp++; else if (truth) fn++; else tn++;
  }
  console.log(`\nHeld-out check on simulated data (risk >= ${AI_WARN_RISK} counts as a warning):`);
  console.log(`  true warnings ${tp}, false warnings ${fp}, missed breaches ${fn}, correct "no breach" ${tn}`);
  console.log('  This only describes the generated simulation data. It says nothing about real plants.');

  await saveModel(tf, model, {
    trainedAt: new Date().toISOString(),
    trainingSamples: trainIdx.length,
    epochs: EPOCHS,
    featureVersion: FEATURE_VERSION,
    seed: SEED,
  });
  console.log(`\nSaved model to ${MODEL_FILE}`);
  const last = hist.history.val_loss?.[hist.history.val_loss.length - 1];
  console.log(`Final validation loss: ${typeof last === 'number' ? last.toFixed(5) : last}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
