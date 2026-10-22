import type { ISODate, Medicine, Schedule, Slot } from '../db/types';
import { timeToMinutes } from './slots';
import { occursOn } from './schedule';

export interface PlannedDose {
  schedule: Schedule;
  medicine: Medicine;
}

/** A card on the Today page: a dose slot, or a custom clock time not tied to a slot. */
export interface PlanGroup {
  key: string;
  slot?: Slot;
  time: string;
  doses: PlannedDose[];
}

/**
 * Builds the dose plan for `date`: one group per slot (in slot order, kept
 * even when empty) plus one group per distinct custom time, placed by clock time.
 * `slots` must already be in display order.
 * Only TIME schedules of active medicines are included here.
 */
export function buildDayPlan(
  date: ISODate,
  slots: readonly Slot[],
  medicines: readonly Medicine[],
  schedules: readonly Schedule[],
): PlanGroup[] {
  const medicineById = new Map(medicines.filter((m) => m.active).map((m) => [m.id!, m]));
  const groups = new Map<string, PlanGroup>();
  for (const slot of slots) {
    groups.set(`slot-${slot.id}`, { key: `slot-${slot.id}`, slot, time: slot.time, doses: [] });
  }

  for (const schedule of schedules) {
    if (!schedule.active || schedule.type !== 'TIME') continue;
    const medicine = medicineById.get(schedule.medicineId);
    if (!medicine || !occursOn(schedule, date)) continue;

    let group: PlanGroup | undefined;
    if (schedule.slotId !== undefined) {
      group = groups.get(`slot-${schedule.slotId}`);
    } else if (schedule.timeOfDay) {
      const key = `time-${schedule.timeOfDay}`;
      group = groups.get(key);
      if (!group) {
        group = { key, time: schedule.timeOfDay, doses: [] };
        groups.set(key, group);
      }
    }
    group?.doses.push({ schedule, medicine });
  }

  const sortDoses = (g: PlanGroup) =>
    g.doses.sort(
      (a, b) => a.medicine.sortOrder - b.medicine.sortOrder || a.medicine.name.localeCompare(b.medicine.name, 'ko'),
    );
  const slotGroups = slots.map((s) => groups.get(`slot-${s.id}`)!);
  const customGroups = [...groups.values()]
    .filter((g) => !g.slot)
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  // Slots keep their configured order; each custom time goes before the first slot that comes later in the day.
  const result: PlanGroup[] = [];
  let next = 0;
  for (const slotGroup of slotGroups) {
    while (next < customGroups.length && timeToMinutes(customGroups[next].time) < timeToMinutes(slotGroup.time)) {
      result.push(customGroups[next++]);
    }
    result.push(slotGroup);
  }
  result.push(...customGroups.slice(next));
  result.forEach(sortDoses);
  return result;
}
