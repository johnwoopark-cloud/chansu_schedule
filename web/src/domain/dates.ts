import type { ISODate } from '../db/types';

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date of `date` as "YYYY-MM-DD". */
export function toISODate(date: Date): ISODate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(value: ISODate): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "10월 22일 (목)" */
export function formatKoreanDate(value: ISODate): string {
  const date = parseISODate(value);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS_KO[date.getDay()]})`;
}

/** "오전 8:00" / "오후 6:30" */
export function formatKoreanTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? '오전' : '오후';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${hour12}:${pad(m)}`;
}

export function addDays(value: ISODate, days: number): ISODate {
  const d = parseISODate(value);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** "HH:MM" of a timestamp in local time. */
export function toTimeOfDay(timestamp: number): string {
  const d = new Date(timestamp);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Late-night cutoff "00:00" means the feature is off. */
export function cutoffMinutes(cutoff: string): number {
  return minutesOf(cutoff);
}

/**
 * The record date for a moment in time. Before the late-night cutoff
 * (e.g. 01:30 with cutoff 03:00) a dose still belongs to the previous day.
 */
export function logicalDate(now: Date, cutoff: string): ISODate {
  const today = toISODate(now);
  return now.getHours() * 60 + now.getMinutes() < cutoffMinutes(cutoff) ? addDays(today, -1) : today;
}

/** Minutes since the start of `date`'s logical day; can exceed 1440 after midnight. */
export function minutesIntoDay(now: Date, date: ISODate): number {
  return Math.floor((now.getTime() - parseISODate(date).getTime()) / 60_000);
}

/**
 * Timestamp for "time on the record date". Times before the cutoff belong to
 * the early hours of the following calendar day.
 */
export function timestampFor(date: ISODate, time: string, cutoff: string): number {
  const minutes = minutesOf(time);
  const day = minutes < cutoffMinutes(cutoff) ? addDays(date, 1) : date;
  const d = parseISODate(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

/** [start, end) timestamps of a logical day: from the cutoff on `date` to the cutoff on the next day. */
export function logicalDayRange(date: ISODate, cutoff: string): [number, number] {
  const start = parseISODate(date);
  start.setMinutes(cutoffMinutes(cutoff));
  const end = parseISODate(addDays(date, 1));
  end.setMinutes(cutoffMinutes(cutoff));
  return [start.getTime(), end.getTime()];
}

/** "HH:MM" for a number of minutes since midnight. */
export function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}
