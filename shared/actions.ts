import type { ActionId, ZoneId } from './types';

export interface ActionDef {
  id: ActionId;
  label: string;
  /** 'online' = done from the dashboard right now. 'on-site' = a person has to go there. */
  mode: 'online' | 'on-site';
  /** What it does in the simulation. */
  what: string;
  /** The honest cost of doing it. Every fix has one. */
  tradeoff: string;
  /** Zones where it makes sense. 'any' means the selected zone. */
  zones: ZoneId[] | 'any';
}

export const ACTIONS: ActionDef[] = [
  {
    id: 'restart-cooling', label: 'Restart cooling remotely', mode: 'online',
    what: 'Restarts the cooling unit from here. It runs at reduced power (about 70%).',
    tradeoff: 'Temporary: full power needs a technician to repair the pump.',
    zones: ['cooling'],
  },
  {
    id: 'reduce-load', label: 'Reduce machine load', mode: 'online',
    what: 'Runs the overheating machine at a lower load.',
    tradeoff: 'Production slows down, and the bearing still needs repair.',
    zones: ['production'],
  },
  {
    id: 'shutdown-machine', label: 'Shut down machine', mode: 'online',
    what: 'Stops the overheating machine so it cools quickly.',
    tradeoff: 'That machine stops producing until it is repaired.',
    zones: ['production'],
  },
  {
    id: 'sprinklers', label: 'Activate sprinklers', mode: 'online',
    what: 'Suppresses the fire in this zone.',
    tradeoff: 'Water can damage stock and equipment. The area still needs inspection.',
    zones: 'any',
  },
  {
    id: 'ventilate', label: 'Boost ventilation', mode: 'online',
    what: 'Extra airflow carries heat out of the zone.',
    tradeoff: 'Uses more energy, and is slower than a direct fix.',
    zones: 'any',
  },
  {
    id: 'dispatch-technician', label: 'Send technician', mode: 'on-site',
    what: 'A technician travels to the zone and repairs the root cause for good.',
    tradeoff: 'Takes time to arrive and repair. Work cannot start while the problem is still active or the limit is crossed.',
    zones: 'any',
  },
];

export const getAction = (id: ActionId): ActionDef => ACTIONS.find((a) => a.id === id)!;

export function actionAppliesTo(def: ActionDef, zone: ZoneId): boolean {
  return def.zones === 'any' || def.zones.includes(zone);
}
