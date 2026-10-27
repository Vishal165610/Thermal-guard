import type { Alert, ZoneId, ZoneStatus } from '../../../shared/types';
import { HYSTERESIS, RECOVERY_BAND, ZONES } from '../../../shared/zones';

const MAX_ALERTS = 40;

interface ZoneRuleState {
  status: ZoneStatus;
  alertId: string | null;
}

/**
 * Rule-based alert engine (no AI involved).
 *
 *   NORMAL     -> WARNING    when peak >= limit - margin
 *   NORMAL/WARNING -> CRITICAL when peak >= limit   (an actual breach)
 *   CRITICAL   -> RECOVERING when peak < limit - HYSTERESIS
 *   WARNING    -> RECOVERING when peak < warning - HYSTERESIS
 *   RECOVERING -> NORMAL     when peak < warning - HYSTERESIS - RECOVERY_BAND
 *   RECOVERING -> CRITICAL   if the limit is crossed again
 *
 * One alert object per incident per zone: it escalates (warning -> critical) instead of
 * creating duplicates, and is resolved when the zone is back to NORMAL.
 */
export class AlertEngine {
  private zones = new Map<ZoneId, ZoneRuleState>();
  private alerts: Alert[] = [];
  private counter = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.zones.clear();
    for (const z of ZONES) this.zones.set(z.id, { status: 'NORMAL', alertId: null });
    this.alerts = [];
    this.counter = 0;
  }

  getStatus(id: ZoneId): ZoneStatus {
    return this.zones.get(id)!.status;
  }

  getAlerts(): Alert[] {
    return this.alerts.map((a) => ({ ...a }));
  }

  acknowledge(alertId: string, step: number): void {
    const a = this.alerts.find((x) => x.id === alertId);
    if (a && !a.acknowledged) {
      a.acknowledged = true;
      a.acknowledgedStep = step;
    }
  }

  update(step: number, peaks: Record<ZoneId, number>): void {
    for (const zone of ZONES) {
      const peak = peaks[zone.id];
      const st = this.zones.get(zone.id)!;
      const warnT = zone.limit - zone.warningMargin;
      const alert = st.alertId ? this.alerts.find((a) => a.id === st.alertId) : undefined;
      const prev = st.status;
      let next: ZoneStatus = prev;

      switch (prev) {
        case 'NORMAL':
          if (peak >= zone.limit) next = 'CRITICAL';
          else if (peak >= warnT) next = 'WARNING';
          break;
        case 'WARNING':
          if (peak >= zone.limit) next = 'CRITICAL';
          else if (peak < warnT - HYSTERESIS) next = 'RECOVERING';
          break;
        case 'CRITICAL':
          if (peak < zone.limit - HYSTERESIS) next = 'RECOVERING';
          break;
        case 'RECOVERING':
          if (peak >= zone.limit) next = 'CRITICAL';
          else if (peak < warnT - HYSTERESIS - RECOVERY_BAND) next = 'NORMAL';
          break;
      }

      // Open a new alert only when a new incident starts.
      if (prev === 'NORMAL' && next !== 'NORMAL') {
        const id = `A${++this.counter}`;
        const critical = next === 'CRITICAL';
        const a: Alert = {
          id, zoneId: zone.id, zoneName: zone.name,
          severity: critical ? 'critical' : 'warning',
          state: 'active',
          openedStep: step,
          criticalStep: critical ? step : null,
          resolvedStep: null,
          peakTemp: peak,
          limit: zone.limit,
          acknowledged: false,
          acknowledgedStep: null,
          message: critical
            ? `${zone.name} crossed its ${zone.limit}°C limit`
            : `${zone.name} is above its warning level (${warnT}°C)`,
        };
        this.alerts.unshift(a);
        if (this.alerts.length > MAX_ALERTS) this.alerts.pop();
        st.alertId = id;
      } else if (alert) {
        alert.peakTemp = Math.max(alert.peakTemp, peak);
        if (next === 'CRITICAL' && alert.criticalStep === null) {
          alert.criticalStep = step;
          alert.severity = 'critical';
          alert.message = `${zone.name} crossed its ${zone.limit}°C limit`;
        }
        if (next === 'CRITICAL') alert.state = 'active';
        if (next === 'WARNING') alert.state = 'active';
        if (next === 'RECOVERING') alert.state = 'recovering';
        if (next === 'NORMAL') {
          alert.state = 'resolved';
          alert.resolvedStep = step;
          st.alertId = null;
        }
      }
      st.status = next;
    }
  }
}
