import type { DoseEvent, ISODate, Medicine, Schedule, Settings, Slot } from '../db/types';
import { addDays, cutoffMinutes, logicalDayRange, parseISODate, timestampFor } from './dates';
import { occursOn } from './schedule';
import { timeToMinutes } from './slots';

/** One planned dose of one schedule on one logical day. */
export interface Occurrence {
  key: string;
  schedule: Schedule;
  medicine: Medicine;
  /** Planned timestamp (estimated for waiting linked doses). */
  at: number;
  /** Slot this dose belongs to (TIME schedules using a slot). */
  slotId?: number;
  /** LINKED: the parent record this dose follows. */
  linkedEventId?: number;
  /** LINKED dose whose parent hasn't been taken yet; can't be checked. */
  waiting?: { parentMedicine: Medicine; delayMinutes: number };
  /** Moved later by weekend mode. */
  shifted?: boolean;
}

export interface OccurrenceInput {
  date: ISODate;
  /** The current logical day; projections of check-time-based intervals start here. */
  today: ISODate;
  cutoff: string;
  slots: readonly Slot[];
  medicines: readonly Medicine[];
  schedules: readonly Schedule[];
  /** Records whose date is `date`. */
  events: readonly DoseEvent[];
  /** For check-time-based intervals: latest processedAt per schedule, across all dates. */
  lastProcessed: ReadonlyMap<number, number>;
  weekendShift?: Settings['weekendShift'];
}

const MINUTE = 60_000;

/** Whether a record belongs to an occurrence. */
export function matchesOccurrence(e: DoseEvent, o: Occurrence): boolean {
  if (o.waiting || e.kind !== 'SCHEDULED' || e.scheduleId !== o.schedule.id) return false;
  if (o.schedule.type === 'TIME') return true; // one per day, so a changed slot time keeps its record
  if (o.linkedEventId !== undefined) return e.linkedEventId === o.linkedEventId;
  return e.scheduledAt === o.at;
}

function inPeriod(s: Schedule, date: ISODate): boolean {
  return !(s.periodStart && date < s.periodStart) && !(s.periodEnd && date > s.periodEnd);
}

/**
 * Minutes from midnight of a daily window's dose times, stepping by the
 * interval. A window whose end is not after its start runs past midnight, so
 * later entries can exceed 1440.
 */
export function windowTimes(s: Schedule): number[] {
  const bounds = windowBounds(s);
  if (!bounds || !s.interval || s.interval.minutes <= 0) return [];
  const times: number[] = [];
  for (let m = bounds[0]; m <= bounds[1]; m += s.interval.minutes) times.push(m);
  return times;
}

function windowBounds(s: Schedule): [number, number] | null {
  if (!s.window) return null;
  const start = timeToMinutes(s.window.start);
  let end = timeToMinutes(s.window.end);
  if (end <= start) end += 1440;
  return [start, end];
}

/** Timestamp `minutes` after midnight of `date` (DST-safe). */
function atMinutes(date: ISODate, minutes: number): number {
  const d = parseISODate(date);
  d.setHours(0, minutes, 0, 0);
  return d.getTime();
}

/** Grid points anchor + k·step (k ≥ 1 when `after`, else k ≥ 0) inside [from, to). */
function grid(anchor: number, step: number, from: number, to: number, after: boolean): number[] {
  if (step <= 0) return [];
  const first = after ? 1 : 0;
  let k = Math.max(first, Math.ceil((from - anchor) / step));
  const out: number[] = [];
  for (let t = anchor + k * step; t < to; t = anchor + ++k * step) out.push(t);
  return out;
}

/**
 * All planned doses for a day, from active schedules of active medicines.
 * Linked doses follow their parent's records; check-time-based intervals
 * follow the last check.
 */
export function generateOccurrences(input: OccurrenceInput): Occurrence[] {
  const { date, today, cutoff, events } = input;
  const medicines = new Map(input.medicines.filter((m) => m.active).map((m) => [m.id!, m]));
  const slots = new Map(input.slots.map((s) => [s.id!, s]));
  const schedules = new Map(input.schedules.map((s) => [s.id!, s]));
  const [dayStart, dayEnd] = logicalDayRange(date, cutoff);
  const weekday = parseISODate(date).getDay();
  const memo = new Map<number, Occurrence[]>();

  const forSchedule = (s: Schedule, visiting: Set<number>): Occurrence[] => {
    if (memo.has(s.id!)) return memo.get(s.id!)!;
    const medicine = medicines.get(s.medicineId);
    if (!s.active || !medicine || visiting.has(s.id!)) return [];
    visiting.add(s.id!);
    const out: Occurrence[] = [];
    const base = { schedule: s, medicine };

    switch (s.type) {
      case 'TIME': {
        if (!occursOn(s, date)) break;
        const slot = s.slotId !== undefined ? slots.get(s.slotId) : undefined;
        const time = slot?.time ?? s.timeOfDay;
        if (!time || (s.slotId !== undefined && !slot)) break;
        let at = timestampFor(date, time, cutoff);
        let shifted = false;
        const shift = input.weekendShift;
        if (shift?.weekdays[weekday]) {
          // Only times in [from, time) move; e.g. a 01:00 dose stays put when from is 04:00.
          const minutes = timeToMinutes(time);
          if (minutes >= timeToMinutes(shift.from ?? '00:00') && minutes < timeToMinutes(shift.time)) {
            at = timestampFor(date, shift.time, cutoff);
            shifted = true;
          }
        }
        out.push({ ...base, key: `t${s.id}`, at, ...(slot ? { slotId: slot.id } : {}), ...(shifted ? { shifted } : {}) });
        break;
      }
      case 'WINDOWED_INTERVAL': {
        const bounds = windowBounds(s);
        if (!occursOn(s, date) || !bounds || !s.interval) break;
        // Like a clock time, a window starting before the cutoff belongs to the next calendar day.
        const windowDate = bounds[0] < cutoffMinutes(cutoff) ? addDays(date, 1) : date;
        const windowStart = atMinutes(windowDate, bounds[0]);
        const windowEnd = atMinutes(windowDate, bounds[1]);
        const step = s.interval.minutes * MINUTE;
        if (!s.interval.fromProcessed) {
          for (const m of windowTimes(s)) {
            const at = atMinutes(windowDate, m);
            out.push({ ...base, key: `w${s.id}@${at}`, at });
          }
          break;
        }
        // From the check time: the window opens at its start; each dose follows the
        // previous check by the interval while it still fits in the window.
        const mine = events
          .filter((e) => e.kind === 'SCHEDULED' && e.scheduleId === s.id && e.scheduledAt !== undefined)
          .sort((a, b) => a.scheduledAt! - b.scheduledAt!);
        for (const e of mine) out.push({ ...base, key: `w${s.id}@${e.scheduledAt}`, at: e.scheduledAt! });
        const lastCheck = mine.reduce<number | undefined>((t, e) => Math.max(t ?? -Infinity, e.processedAt ?? -Infinity), undefined);
        let next = lastCheck !== undefined && Number.isFinite(lastCheck) ? lastCheck + step : windowStart;
        for (; next <= windowEnd; next += step) {
          if (!out.some((o) => o.at === next)) out.push({ ...base, key: `w${s.id}@${next}`, at: next });
        }
        break;
      }
      case 'CONTINUOUS_INTERVAL': {
        if (!s.interval || !inPeriod(s, date)) break;
        const step = s.interval.minutes * MINUTE;
        if (!s.interval.fromProcessed) {
          for (const at of grid(s.interval.startAt, step, Math.max(dayStart, s.interval.startAt), dayEnd, false)) {
            out.push({ ...base, key: `c${s.id}@${at}`, at });
          }
          break;
        }
        // Check-time based: past records stay where they were; upcoming doses
        // are projected from the latest check (or the start time).
        for (const e of events) {
          if (e.kind === 'SCHEDULED' && e.scheduleId === s.id && e.scheduledAt !== undefined) {
            out.push({ ...base, key: `c${s.id}@${e.scheduledAt}`, at: e.scheduledAt });
          }
        }
        if (date < today) break;
        const last = input.lastProcessed.get(s.id!);
        const next = last !== undefined ? last + step : s.interval.startAt;
        const projected =
          date === today
            ? [next, ...grid(next, step, Math.max(dayStart, next), dayEnd, true)].filter((t) => t < dayEnd)
            : grid(next, step, dayStart, dayEnd, false);
        for (const at of projected) {
          if (!out.some((o) => o.at === at)) out.push({ ...base, key: `c${s.id}@${at}`, at });
        }
        break;
      }
      case 'LINKED': {
        const parent = s.linked && schedules.get(s.linked.parentScheduleId);
        if (!parent || !s.linked) break;
        const delay = s.linked.delayMinutes * MINUTE;
        for (const p of forSchedule(parent, visiting)) {
          const parentEvent = events.find((e) => matchesOccurrence(e, p));
          if (parentEvent?.status === 'TAKEN' && parentEvent.processedAt !== undefined) {
            out.push({
              ...base,
              key: `l${s.id}<${parentEvent.id}`,
              at: parentEvent.processedAt + delay,
              linkedEventId: parentEvent.id,
            });
          } else if (!parentEvent) {
            // Parent not taken yet (or itself still waiting): show an estimated, uncheckable dose.
            out.push({
              ...base,
              key: `l${s.id}?${p.key}`,
              at: p.at + delay,
              waiting: { parentMedicine: p.medicine, delayMinutes: s.linked.delayMinutes },
            });
          }
        }
        break;
      }
    }

    visiting.delete(s.id!);
    memo.set(s.id!, out);
    return out;
  };

  return input.schedules.flatMap((s) => forSchedule(s, new Set())).sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

/**
 * How many doses a schedule plans on a day, without times or records. Used for
 * stock forecasts and prescription suggestions. Linked schedules count their
 * parent's doses (assuming the parent is taken).
 */
export function plannedCount(
  s: Schedule,
  date: ISODate,
  schedules: ReadonlyMap<number, Schedule>,
  visiting: Set<number> = new Set(),
): number {
  if (!s.active || visiting.has(s.id!)) return 0;
  switch (s.type) {
    case 'TIME':
      return occursOn(s, date) ? 1 : 0;
    case 'WINDOWED_INTERVAL':
      return occursOn(s, date) ? windowTimes(s).length : 0;
    case 'CONTINUOUS_INTERVAL': {
      if (!s.interval || !inPeriod(s, date)) return 0;
      const [from, to] = logicalDayRange(date, '00:00');
      return grid(s.interval.startAt, s.interval.minutes * MINUTE, Math.max(from, s.interval.startAt), to, false).length;
    }
    case 'LINKED': {
      const parent = s.linked && schedules.get(s.linked.parentScheduleId);
      if (!parent) return 0;
      visiting.add(s.id!);
      const n = plannedCount(parent, date, schedules, visiting);
      visiting.delete(s.id!);
      return n;
    }
  }
}
