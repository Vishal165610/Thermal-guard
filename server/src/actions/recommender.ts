import type {
  FaultInfo, Recommendation, ZoneForecast, ZoneId, ZoneStatus,
} from '../../../shared/types';
import { ZONES } from '../../../shared/zones';

/**
 * Rule-based suggestions. Plain "if this, then that", written by us. It is NOT machine learning.
 *
 *  - A live problem  -> suggest the online fix first.
 *  - A contained one -> suggest sending a technician, because the online fix is only temporary.
 *  - A hot zone with no known cause -> suggest extra ventilation while someone inspects.
 */
export function recommend(
  statuses: Record<ZoneId, ZoneStatus>,
  forecasts: Record<ZoneId, ZoneForecast>,
  faults: FaultInfo[],
): Recommendation[] {
  const out: Recommendation[] = [];
  const add = (r: Recommendation) => {
    if (!out.some((x) => x.actionId === r.actionId && x.zoneId === r.zoneId)) out.push(r);
  };

  for (const f of faults) {
    if (f.state === 'fixed') continue;
    const status = statuses[f.zoneId];
    const urgency: Recommendation['urgency'] = status === 'CRITICAL' || status === 'WARNING' ? 'now' : 'soon';
    // Suggest the online fix once the zone is actually in trouble (rule status or a forecast warning).
    const inTrouble = status !== 'NORMAL' || forecasts[f.zoneId].warning;

    if (f.state === 'failing' && inTrouble) {
      if (f.kind === 'cooling-pump') add({ actionId: 'restart-cooling', zoneId: f.zoneId, faultId: f.id, urgency, reason: f.summary });
      if (f.kind === 'machine-bearing') {
        add({ actionId: 'reduce-load', zoneId: f.zoneId, faultId: f.id, urgency, reason: f.summary });
        if (status === 'CRITICAL') {
          add({ actionId: 'shutdown-machine', zoneId: f.zoneId, faultId: f.id, urgency: 'now', reason: 'The limit is already crossed and the machine is still overloaded.' });
        }
      }
      if (f.kind === 'fire') add({ actionId: 'sprinklers', zoneId: f.zoneId, faultId: f.id, urgency: 'now', reason: f.summary });
    } else if (f.state === 'contained' && f.canDispatch) {
      add({
        actionId: 'dispatch-technician', zoneId: f.zoneId, faultId: f.id, urgency: 'soon',
        reason: `The online fix is only temporary. ${f.summary}`,
      });
    }
  }

  // Hot zone, but nothing in the fault list explains it.
  for (const zone of ZONES) {
    const hot = statuses[zone.id] === 'CRITICAL' || statuses[zone.id] === 'WARNING' || forecasts[zone.id].warning;
    if (hot && !out.some((r) => r.zoneId === zone.id)) {
      add({ actionId: 'ventilate', zoneId: zone.id, urgency: 'now', reason: 'No single cause found. Extra airflow can help while you inspect.' });
    }
  }
  out.sort((a, b) => (a.urgency === b.urgency ? 0 : a.urgency === 'now' ? -1 : 1));
  return out.slice(0, 3);
}
