import type { ISODate, Schedule, Slot } from '../db/types';
import { daysBetween, formatKoreanTime, parseISODate, toISODate, toTimeOfDay } from './dates';
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

export type ScheduleErrors = Partial<
  Record<'when' | 'doseQty' | 'period' | 'weekdays' | 'interval' | 'window' | 'linked' | 'cycle' | 'monthDays', string>
>;

export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
export const MAX_LINK_DELAY_MINUTES = 24 * 60;

export function validateSchedule(s: Omit<Schedule, 'id'>): ScheduleErrors {
  const errors: ScheduleErrors = {};
  const badInterval = (minutes: number | undefined) =>
    minutes === undefined || !Number.isInteger(minutes) || minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES;

  switch (s.type) {
    case 'TIME':
      if (s.slotId === undefined && !(s.timeOfDay && isValidTime(s.timeOfDay))) errors.when = '복용 시기나 시각을 정하세요.';
      break;
    case 'CONTINUOUS_INTERVAL':
      if (badInterval(s.interval?.minutes)) errors.interval = '간격은 15분 ~ 7일 사이로 정하세요.';
      if (!s.interval || !Number.isFinite(s.interval.startAt)) errors.when = '시작 날짜와 시각을 정하세요.';
      break;
    case 'WINDOWED_INTERVAL':
      if (badInterval(s.interval?.minutes)) errors.interval = '간격은 15분 ~ 7일 사이로 정하세요.';
      if (!s.window || !isValidTime(s.window.start) || !isValidTime(s.window.end)) errors.window = '시작·끝 시각을 정하세요.';
      else if (s.window.end === s.window.start) errors.window = '시작과 끝 시각이 같습니다.';
      break;
    case 'LINKED':
      if (!s.linked) errors.linked = '어느 약 다음에 먹는지 고르세요.';
      else if (!Number.isInteger(s.linked.delayMinutes) || s.linked.delayMinutes < 0 || s.linked.delayMinutes > MAX_LINK_DELAY_MINUTES) {
        errors.linked = '시간 차이는 0분 ~ 24시간 사이로 정하세요.';
      }
      break;
  }
  if (!s.variableAmount && (Number.isNaN(s.doseQty) || !(s.doseQty > 0))) {
    errors.doseQty = '1회 복용량을 0보다 큰 숫자로 입력하세요.';
  }
  if (s.periodStart && s.periodEnd && s.periodEnd < s.periodStart) {
    errors.period = '종료일이 시작일보다 빠릅니다.';
  }
  if (s.weekdays.length !== 7) errors.weekdays = '요일 설정이 올바르지 않습니다.';
  if (s.monthDays < 0 || s.monthDays >= 2 ** 31) errors.monthDays = '날짜 설정이 올바르지 않습니다.';
  if (s.cycle) {
    const { activeDays, pauseDays, startDate } = s.cycle;
    if (!Number.isInteger(activeDays) || activeDays < 1 || !Number.isInteger(pauseDays) || pauseDays < 1 || activeDays + pauseDays > 366) {
      errors.cycle = '복용일과 휴약일은 1 이상의 정수로 입력하세요.';
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) errors.cycle = '주기 시작일을 정하세요.';
  }
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

/** Days of month set in a bitmask, 1-based. */
export function monthDaysList(mask: number): number[] {
  const days: number[] = [];
  for (let d = 1; d <= 31; d++) if (mask & (1 << (d - 1))) days.push(d);
  return days;
}

/** "6시간", "90분", "1일 12시간". */
export function describeMinutes(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d && `${d}일`, h && `${h}시간`, m && `${m}분`].filter(Boolean).join(' ') || '0분';
}

export interface DescribeContext {
  slots: ReadonlyMap<number, Slot>;
  schedules?: ReadonlyMap<number, Schedule>;
  medicines?: ReadonlyMap<number, { name: string }>;
}

/** One-line summary, e.g. "아침 · 매일 · 26.10.1~26.10.31" or "6시간마다 · 26.10.22 08:00부터". */
export function describeSchedule(s: Schedule, ctx: DescribeContext): string {
  const parts: string[] = [];
  switch (s.type) {
    case 'TIME':
      if (s.slotId !== undefined) parts.push(ctx.slots.get(s.slotId)?.label ?? '(삭제된 시기)');
      else if (s.timeOfDay) parts.push(formatKoreanTime(s.timeOfDay));
      break;
    case 'WINDOWED_INTERVAL':
      if (s.window && s.interval) {
        parts.push(`${formatKoreanTime(s.window.start)}~${formatKoreanTime(s.window.end)} ${describeMinutes(s.interval.minutes)}마다`);
      }
      break;
    case 'CONTINUOUS_INTERVAL':
      if (s.interval) {
        const start = new Date(s.interval.startAt);
        parts.push(`${describeMinutes(s.interval.minutes)}마다`);
        parts.push(
          s.interval.fromProcessed
            ? '체크한 시각 기준'
            : `${formatShortDate(toISODate(start))} ${formatKoreanTime(toTimeOfDay(s.interval.startAt))}부터`,
        );
      }
      break;
    case 'LINKED': {
      const parent = s.linked && ctx.schedules?.get(s.linked.parentScheduleId);
      const name = parent ? ctx.medicines?.get(parent.medicineId)?.name : undefined;
      parts.push(
        s.linked ? `${name ?? '(삭제된 일정)'} 복용 ${describeMinutes(s.linked.delayMinutes)} 후` : '(연결 없음)',
      );
      return parts.join(' · ');
    }
  }
  if (s.type !== 'CONTINUOUS_INTERVAL') {
    const days = monthDaysList(s.monthDays);
    parts.push(days.length ? `매월 ${days.join('·')}일` : describeWeekdays(s.weekdays));
    if (days.length && s.weekdays.some((on) => !on) && s.weekdays.some(Boolean)) parts.push(describeWeekdays(s.weekdays));
    if (s.cycle) parts.push(`${s.cycle.activeDays}일 복용 ${s.cycle.pauseDays}일 휴약`);
  }
  if (s.periodStart || s.periodEnd) {
    parts.push(`${s.periodStart ? formatShortDate(s.periodStart) : ''}~${s.periodEnd ? formatShortDate(s.periodEnd) : ''}`);
  }
  return parts.join(' · ');
}

/** Ids of schedules that (directly or through a chain) follow `id`. */
export function linkedDescendants(id: number, schedules: readonly Schedule[]): Set<number> {
  const out = new Set<number>();
  const visit = (parent: number) => {
    for (const s of schedules) {
      if (s.type === 'LINKED' && s.linked?.parentScheduleId === parent && !out.has(s.id!)) {
        out.add(s.id!);
        visit(s.id!);
      }
    }
  };
  visit(id);
  return out;
}
