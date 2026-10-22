import type { Slot } from '../db/types';
import { toTimeOfDay } from './dates';
import type { Occurrence } from './occurrences';

/** A card on the Today page: a dose slot, or a clock time not tied to a slot. */
export interface PlanGroup {
  key: string;
  slot?: Slot;
  /** Earliest planned timestamp in the group; drives ordering and "overdue". */
  at: number;
  /** "HH:MM" shown on the card. */
  time: string;
  /** Weekend mode moved this group later. */
  shifted: boolean;
  occurrences: Occurrence[];
}

/**
 * Groups a day's occurrences into cards: slot doses by slot, everything else
 * by exact time. Cards are ordered by time.
 */
export function buildDayPlan(occurrences: readonly Occurrence[], slots: readonly Slot[]): PlanGroup[] {
  const slotById = new Map(slots.map((s) => [s.id!, s]));
  const groups = new Map<string, PlanGroup>();
  for (const o of occurrences) {
    const slot = o.slotId !== undefined ? slotById.get(o.slotId) : undefined;
    const key = slot ? `slot-${slot.id}` : `at-${o.at}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, slot, at: o.at, time: toTimeOfDay(o.at), shifted: false, occurrences: [] };
      groups.set(key, group);
    }
    group.occurrences.push(o);
    group.shifted ||= !!o.shifted;
    if (o.at < group.at) {
      group.at = o.at;
      group.time = toTimeOfDay(o.at);
    }
  }
  const order = (o: Occurrence) => o.medicine.sortOrder;
  for (const g of groups.values()) {
    g.occurrences.sort(
      (a, b) => order(a) - order(b) || a.medicine.name.localeCompare(b.medicine.name, 'ko') || a.at - b.at,
    );
  }
  return [...groups.values()].sort((a, b) => a.at - b.at || (a.slot ? -1 : b.slot ? 1 : 0));
}
