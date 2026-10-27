// Headless test of the corrective-action feature.
//   npm run rehearse:actions
// Runs each incident three ways: no action, act at the first recommendation, act 15 steps later.
// 'Act' means an ONLINE fix. The underlying issue stays open until a technician repairs it.
import { SimulationService } from '../service';
import type { ScenarioId, ZoneId } from '../../../shared/types';

async function run(scenario: ScenarioId, zone: ZoneId | undefined, delay: number | null, label: string) {
  const svc = new SimulationService();
  await svc.init();
  for (let i = 0; i < 20; i++) svc.tick();
  svc.setScenario(scenario, zone);
  let firstRecAt: number | null = null;
  let acted = false;
  for (let i = 0; i < 200; i++) {
    svc.tick();
    const snap = svc.snapshot();
    if (firstRecAt === null && snap.recommendations.length) firstRecAt = snap.step;
    if (delay !== null && !acted && firstRecAt !== null && snap.step >= firstRecAt + delay) {
      // take the first recommended action, exactly as an operator would click it
      const rec = snap.recommendations.find((r) => r.actionId !== 'dispatch-technician') ?? snap.recommendations[0];
      svc.applyAction(rec.actionId, rec.zoneId, rec.faultId);
      acted = true;
    }
  }
  const o = svc.snapshot().outcome;
  console.log(`${scenario.padEnd(20)} ${label.padEnd(22)} first suggestion @${firstRecAt ?? '-'}  -> ${o.status}: ${o.headline}. ${o.detail}`);
}

async function main() {
  for (const [sc, zone] of [
    ['cooling-failure', undefined], ['machine-overheating', undefined], ['fire', 'storage'],
  ] as [ScenarioId, ZoneId | undefined][]) {
    await run(sc, zone, null, 'no action');
    await run(sc, zone, 0, 'act immediately');
    await run(sc, zone, 15, 'act 15 steps later');
    console.log('');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
