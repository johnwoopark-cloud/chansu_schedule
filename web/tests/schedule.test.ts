import { describe, expect, it } from 'vitest';
import type { Schedule, Slot } from '../src/db/types';
import { describeSchedule, describeWeekdays, newTimeSchedule, occursOn, validateSchedule } from '../src/domain/schedule';

const base = (patch: Partial<Schedule> = {}): Schedule => ({ id: 1, ...newTimeSchedule(1, 1, '정'), ...patch });
// 2026-10-19 is a Monday.
const MON = '2026-10-19';
const SAT = '2026-10-24';
const SUN = '2026-10-25';

describe('occursOn', () => {
  it('runs every day by default', () => {
    expect([MON, SAT, SUN].every((d) => occursOn(base(), d))).toBe(true);
  });

  it('treats an all-false weekday list as every day', () => {
    expect(occursOn(base({ weekdays: Array(7).fill(false) }), SUN)).toBe(true);
  });

  it('respects weekdays', () => {
    const weekdaysOnly = base({ weekdays: [false, true, true, true, true, true, false] });
    expect(occursOn(weekdaysOnly, MON)).toBe(true);
    expect(occursOn(weekdaysOnly, SAT)).toBe(false);
    expect(occursOn(weekdaysOnly, SUN)).toBe(false);
  });

  it('respects the period, inclusive', () => {
    const s = base({ periodStart: '2026-10-20', periodEnd: '2026-10-24' });
    expect(occursOn(s, MON)).toBe(false);
    expect(occursOn(s, '2026-10-20')).toBe(true);
    expect(occursOn(s, SAT)).toBe(true);
    expect(occursOn(s, SUN)).toBe(false);
  });

  it('respects days of month', () => {
    const firstAndFifteenth = base({ monthDays: (1 << 0) | (1 << 14) });
    expect(occursOn(firstAndFifteenth, '2026-11-01')).toBe(true);
    expect(occursOn(firstAndFifteenth, '2026-11-15')).toBe(true);
    expect(occursOn(firstAndFifteenth, '2026-11-02')).toBe(false);
  });

  it('respects an active/pause cycle (21 on, 7 off)', () => {
    const s = base({ cycle: { startDate: '2026-10-01', activeDays: 21, pauseDays: 7 } });
    expect(occursOn(s, '2026-09-30')).toBe(false);
    expect(occursOn(s, '2026-10-01')).toBe(true);
    expect(occursOn(s, '2026-10-21')).toBe(true);
    expect(occursOn(s, '2026-10-22')).toBe(false);
    expect(occursOn(s, '2026-10-28')).toBe(false);
    expect(occursOn(s, '2026-10-29')).toBe(true);
  });

  it('counts cycle days correctly across a DST change', () => {
    // Uses whatever local zone the test runs in; rounding keeps whole days.
    const s = base({ cycle: { startDate: '2026-03-01', activeDays: 1, pauseDays: 1 } });
    expect(occursOn(s, '2026-04-30')).toBe(true); // 60 days later, even
    expect(occursOn(s, '2026-05-01')).toBe(false);
  });
});

describe('validateSchedule', () => {
  it('requires a slot or a valid time', () => {
    expect(validateSchedule(base({ slotId: undefined, timeOfDay: undefined })).when).toBeDefined();
    expect(validateSchedule(base({ slotId: undefined, timeOfDay: '25:00' })).when).toBeDefined();
    expect(validateSchedule(base({ slotId: undefined, timeOfDay: '07:15' })).when).toBeUndefined();
  });

  it('requires a positive dose and an ordered period', () => {
    expect(validateSchedule(base({ doseQty: 0 })).doseQty).toBeDefined();
    expect(validateSchedule(base({ doseQty: NaN })).doseQty).toBeDefined();
    expect(validateSchedule(base({ periodStart: '2026-10-10', periodEnd: '2026-10-01' })).period).toBeDefined();
    expect(validateSchedule(base())).toEqual({});
  });
});

describe('describe', () => {
  const slots = new Map<number, Slot>([[1, { id: 1, label: '아침', time: '08:00', order: 0 }]]);

  it('names weekday patterns', () => {
    expect(describeWeekdays(Array(7).fill(true))).toBe('매일');
    expect(describeWeekdays([false, true, true, true, true, true, false])).toBe('평일');
    expect(describeWeekdays([true, false, false, false, false, false, true])).toBe('주말');
    expect(describeWeekdays([true, true, false, true, false, false, false])).toBe('월·수·일');
  });

  it('summarises a schedule', () => {
    expect(describeSchedule(base(), { slots })).toBe('아침 · 매일');
    expect(describeSchedule(base({ slotId: undefined, timeOfDay: '15:00' }), { slots })).toBe('오후 3:00 · 매일');
    expect(describeSchedule(base({ periodStart: '2026-10-01', periodEnd: '2026-10-31' }), { slots })).toBe(
      '아침 · 매일 · 26.10.1~26.10.31',
    );
    expect(describeSchedule(base({ slotId: 99 }), { slots })).toBe('(삭제된 시기) · 매일');
  });
});
