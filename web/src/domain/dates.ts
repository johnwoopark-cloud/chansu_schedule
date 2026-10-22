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
