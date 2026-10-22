import type { MedicationDB } from '../db/database';
import { loadDayContext, occurrencesOn } from '../db/dayContext';
import { listEventsForDate, recordDoses, updateSettings } from '../db/doseRepository';
import { addDays, logicalDate, logicalDayRange } from '../domain/dates';
import { matchesOccurrence } from '../domain/occurrences';

const MAX_CATCH_UP_DAYS = 31;
let running: Promise<number> | null = null;

/**
 * Records "auto taken" doses whose time has come since the last run. Runs when
 * the app is open (there is no background execution), catching up on missed
 * days up to a month. Returns how many records were written.
 */
export function runAutoTaken(db: MedicationDB, now: Date = new Date()): Promise<number> {
  running ??= (async () => {
    try {
      const ctx = await loadDayContext(db, now);
      const cutoff = ctx.settings.lateNightCutoff;
      const nowTs = now.getTime();
      if (!ctx.schedules.some((s) => s.autoTaken && s.active)) {
        await updateSettings(db, { lastAutoTakenAt: nowTs });
        return 0;
      }
      const since = ctx.settings.lastAutoTakenAt ?? logicalDayRange(ctx.today, cutoff)[0];
      let date = logicalDate(new Date(since), cutoff);
      const earliest = addDays(ctx.today, -MAX_CATCH_UP_DAYS);
      if (date < earliest) date = earliest;

      let written = 0;
      for (; date <= ctx.today; date = addDays(date, 1)) {
        const events = await listEventsForDate(db, date);
        const due = occurrencesOn(ctx, date, events).filter(
          (o) =>
            o.schedule.autoTaken &&
            !o.waiting &&
            o.at > since &&
            o.at <= nowTs &&
            !events.some((e) => matchesOccurrence(e, o)),
        );
        for (const o of due) {
          await recordDoses(db, date, [{ occurrence: o }], 'TAKEN', o.at, { auto: true });
          written++;
        }
      }
      await updateSettings(db, { lastAutoTakenAt: nowTs });
      return written;
    } finally {
      running = null;
    }
  })();
  return running;
}
