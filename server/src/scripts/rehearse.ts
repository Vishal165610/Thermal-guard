// Headless demo rehearsal: runs the whole cooling-failure story without a browser.
//   npm run rehearse
// It prints what the dashboard would show, and the early-warning timeline exactly as computed.
import { SimulationService } from '../service';
import { getZone } from '../../../shared/zones';

async function main() {
  const svc = new SimulationService();
  await svc.init();
  console.log(`Forecaster: ${svc.forecaster.status.state}. ${svc.forecaster.status.message}\n`);

  const cool = getZone('cooling');
  const line = (label: string) => {
    const s = svc.snapshot();
    const z = s.zones.find((q) => q.id === 'cooling')!;
    const f = s.forecasts.find((q) => q.zoneId === 'cooling')!;
    const risk = f.riskScore === null ? 'n/a (trend est.)' : `${(f.riskScore * 100).toFixed(0)}%`;
    console.log(
      `${label.padEnd(26)} step ${String(s.step).padStart(3)}  cooling peak ${z.peakTemp.toFixed(1)}°C ` +
      `(limit ${cool.limit})  status ${z.status.padEnd(10)} risk ${risk.padEnd(16)} warn=${f.warning}`,
    );
  };

  for (let i = 0; i < 30; i++) svc.tick();
  line('normal operation');
  svc.setScenario('cooling-failure');
  console.log('>>> COOLING FAILURE started');
  for (let i = 1; i <= 110; i++) {
    svc.tick();
    if (i % 10 === 0) line(`failure +${i}`);
  }
  svc.setScenario('normal');
  console.log('>>> NORMAL OPERATION restored (cooling repaired)');
  for (let i = 1; i <= 80; i++) {
    svc.tick();
    if (i % 10 === 0) line(`recovery +${i}`);
  }

  const snap = svc.snapshot();
  console.log('\nEarly-warning timeline:');
  for (const e of snap.timeline) console.log(` [${e.zoneName}] ${e.verdict}: ${e.summary}`);
  console.log('\nRule-based alerts:');
  for (const a of snap.alerts) {
    console.log(` ${a.id} ${a.zoneName} ${a.severity} opened@${a.openedStep} critical@${a.criticalStep} resolved@${a.resolvedStep}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
