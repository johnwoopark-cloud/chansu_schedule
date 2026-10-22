import type { ISODate } from '../db/types';
import { addDays, parseISODate, toISODate } from './dates';

/** The 6×7 Monday-first grid of dates shown for the month containing `anyDay`. */
export function monthGrid(anyDay: ISODate): { month: ISODate; days: ISODate[] } {
  const d = parseISODate(anyDay);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const back = (first.getDay() + 6) % 7; // days since Monday
  const start = addDays(toISODate(first), -back);
  return { month: toISODate(first), days: Array.from({ length: 42 }, (_, i) => addDays(start, i)) };
}

export function shiftMonth(month: ISODate, delta: number): ISODate {
  const d = parseISODate(month);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + delta, 1));
}

export function sameMonth(a: ISODate, b: ISODate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}
