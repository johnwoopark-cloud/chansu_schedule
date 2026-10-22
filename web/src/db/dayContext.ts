import type { MedicationDB } from './database';
import { getSettings, lastProcessedTimes, listEventsForDate } from './doseRepository';
import { listMedicines } from './medicineRepository';
import { listSlots } from './slotRepository';
import type { DoseEvent, ISODate, Medicine, Schedule, Settings, Slot } from './types';
import { logicalDate } from '../domain/dates';
import { generateOccurrences, type Occurrence } from '../domain/occurrences';

/** Everything needed to work out a day's planned doses. */
export interface DayContext {
  settings: Settings;
  today: ISODate;
  slots: Slot[];
  medicines: Medicine[];
  schedules: Schedule[];
  lastProcessed: Map<number, number>;
}

export async function loadDayContext(db: MedicationDB, now: Date): Promise<DayContext> {
  const settings = await getSettings(db);
  const [slots, medicines, schedules] = await Promise.all([listSlots(db), listMedicines(db), db.schedules.toArray()]);
  return {
    settings,
    today: logicalDate(now, settings.lateNightCutoff),
    slots,
    medicines,
    schedules,
    lastProcessed: await lastProcessedTimes(db, schedules),
  };
}

export function occurrencesOn(ctx: DayContext, date: ISODate, events: readonly DoseEvent[]): Occurrence[] {
  return generateOccurrences({
    date,
    today: ctx.today,
    cutoff: ctx.settings.lateNightCutoff,
    slots: ctx.slots,
    medicines: ctx.medicines,
    schedules: ctx.schedules,
    events,
    lastProcessed: ctx.lastProcessed,
    weekendShift: ctx.settings.weekendShift,
  });
}

export async function loadOccurrences(db: MedicationDB, ctx: DayContext, date: ISODate) {
  const events = await listEventsForDate(db, date);
  return { events, occurrences: occurrencesOn(ctx, date, events) };
}
