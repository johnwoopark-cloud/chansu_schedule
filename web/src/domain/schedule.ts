import type { ISODate, Schedule, Slot } from '../db/types';
import { formatKoreanTime, parseISODate } from './dates';
import { isValidTime } from './slots';

/** Display order Monday-first; values are Date.getDay() indexes. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export const EVERY_DAY = (): boolean[] => Array(7).fill(true);

export function newTimeSchedule(medicineId: number, slotId: number | undefined, doseUnit: string): Omit<Schedule, 'id'> {
  return {
    medicineId,
    type: 'TIME',
    slotId,
    timeOfDay: slotId === undefined ? '09:00' : undefined,
    doseQty: 1,
    doseUnit,
    variableAmount: false,
    autoTaken: false,
    instructions: '',
    active: true,
    weekdays: EVERY_DAY(),
    monthDays: 0,
  };
}

const MS_PER_DAY = 86_400_000;

function daysBetween(from: ISODate, to: ISODate): number {
  // Both dates are local midnight; round to absorb DST shifts.
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / MS_PER_DAY);
}

/**
 * Whether a TIME schedule has a dose on `date`, considering weekdays, days of
 * month, period and active/pause cycle. Ignores `active`; callers filter that.
 */
export function occursOn(s: Schedule, date: ISODate): boolean {
  if (s.periodStart && date < s.periodStart) return false;
  if (s.periodEnd && date > s.periodEnd) return false;

  const d = parseISODate(date);
  if (s.weekdays.some(Boolean) && !s.weekdays[d.getDay()]) return false;
  if (s.monthDays !== 0 && !(s.monthDays & (1 << (d.getDate() - 1)))) return false;

  if (s.cycle && s.cycle.pauseDays > 0) {
    const offset = daysBetween(s.cycle.startDate, date);
    if (offset < 0) return false;
    const length = s.cycle.activeDays + s.cycle.pauseDays;
    if (offset % length >= s.cycle.activeDays) return false;
  }
  return true;
}

/** The time of day a TIME schedule uses: its slot's time, or its own. */
export function scheduleTime(s: Schedule, slots: ReadonlyMap<number, Slot>): string | undefined {
  if (s.slotId !== undefined) return slots.get(s.slotId)?.time;
  return s.timeOfDay;
}

export type ScheduleErrors = Partial<Record<'when' | 'doseQty' | 'period' | 'weekdays', string>>;

export function validateSchedule(s: Omit<Schedule, 'id'>): ScheduleErrors {
  const errors: ScheduleErrors = {};
  if (s.slotId === undefined && !(s.timeOfDay && isValidTime(s.timeOfDay))) {
    errors.when = '복용 시기나 시각을 정하세요.';
  }
  if (!s.variableAmount && (Number.isNaN(s.doseQty) || !(s.doseQty > 0))) {
    errors.doseQty = '1회 복용량을 0보다 큰 숫자로 입력하세요.';
  }
  if (s.periodStart && s.periodEnd && s.periodEnd < s.periodStart) {
    errors.period = '종료일이 시작일보다 빠릅니다.';
  }
  if (s.weekdays.length !== 7) errors.weekdays = '요일 설정이 올바르지 않습니다.';
  return errors;
}

function formatShortDate(date: ISODate): string {
  const d = parseISODate(date);
  return `${d.getFullYear() % 100}.${d.getMonth() + 1}.${d.getDate()}`;
}

/** "매일", "월·수·금", "주말" … */
export function describeWeekdays(weekdays: readonly boolean[]): string {
  const on = WEEKDAY_ORDER.filter((i) => weekdays[i]);
  if (on.length === 0 || on.length === 7) return '매일';
  if (on.length === 5 && on.every((i) => i >= 1 && i <= 5)) return '평일';
  if (on.length === 2 && weekdays[0] && weekdays[6]) return '주말';
  return on.map((i) => WEEKDAY_LABELS[i]).join('·');
}

/** One-line summary: "아침 · 매일 · 26.10.1~26.10.31". */
export function describeSchedule(s: Schedule, slots: ReadonlyMap<number, Slot>): string {
  const parts: string[] = [];
  if (s.slotId !== undefined) parts.push(slots.get(s.slotId)?.label ?? '(삭제된 시기)');
  else if (s.timeOfDay) parts.push(formatKoreanTime(s.timeOfDay));
  parts.push(describeWeekdays(s.weekdays));
  if (s.periodStart || s.periodEnd) {
    parts.push(`${s.periodStart ? formatShortDate(s.periodStart) : ''}~${s.periodEnd ? formatShortDate(s.periodEnd) : ''}`);
  }
  return parts.join(' · ');
}
