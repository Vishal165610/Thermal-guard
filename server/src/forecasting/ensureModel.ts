// Runs automatically before `npm run dev`.
// If the trained model file is missing, train it now (about 1-2 minutes, once).
// Training failure never blocks the app: the dashboard falls back to a labelled trend estimate.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_FILE } from './modelIO';

if (fs.existsSync(MODEL_FILE)) {
  console.log('[model] Found the trained model. Nothing to do.');
} else {
  console.log('[model] No trained model found. Training one now (about 1-2 minutes, only the first time)...');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'train', '-w', 'server'], { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0 || !fs.existsSync(MODEL_FILE)) {
    console.log('[model] Training did not finish. Continuing; the dashboard will show trend estimates (not AI). Run "npm run train" to retry.');
  }
}
