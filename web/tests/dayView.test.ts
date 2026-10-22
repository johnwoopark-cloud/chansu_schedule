import { describe, expect, it } from 'vitest';
import type { DoseEvent, Medicine, Schedule, Slot } from '../src/db/types';
import { buildDayPlan } from '../src/domain/dayPlan';
import { buildDayView, filterDayView, timingFor } from '../src/domain/dayView';
import { newMedicine } from '../src/domain/medicine';
import { newTimeSchedule } from '../src/domain/schedule';
import {
  addDays,
  logicalDate,
  minutesIntoDay,
  timestampFor,
  toTimeOfDay,
} from '../src/domain/dates';

const DAY = '2026-10-22';
const slots: Slot[] = [
  { id: 1, label: '아침', time: '08:00', order: 0 },
  { id: 2, label: '저녁', time: '18:30', order: 1 },
];
const med = (id: number, patch: Partial<Medicine> = {}): Medicine => ({ ...newMedicine(id), id, name: `약${id}`, ...patch });
const sched = (id: number, medicineId: number, slotId: number): Schedule => ({
  id,
  ...newTimeSchedule(medicineId, slotId, '정'),
});
const event = (id: number, patch: Partial<DoseEvent>): DoseEvent => ({
  id,
  medicineId: 1,
  kind: 'SCHEDULED',
  date: DAY,
  status: 'TAKEN',
  snapshot: { medicineName: '약1', doseQty: 1, doseUnit: '정', tags: [] },
  symptomIds: [],
  ...patch,
});

const medicines = [med(1, { tagIds: [7] }), med(2)];
const schedules = [sched(11, 1, 1), sched(12, 2, 1), sched(13, 1, 2)];
const plan = buildDayPlan(DAY, slots, medicines, schedules);

describe('dates', () => {
  it('assigns the early hours to the previous day only before the cutoff', () => {
    expect(logicalDate(new Date(2026, 9, 23, 1, 30), '03:00')).toBe(DAY);
    expect(logicalDate(new Date(2026, 9, 23, 3, 0), '03:00')).toBe('2026-10-23');
    expect(logicalDate(new Date(2026, 9, 23, 0, 10), '00:00')).toBe('2026-10-23');
  });

  it('measures minutes into a logical day past midnight', () => {
    expect(minutesIntoDay(new Date(2026, 9, 22, 8, 30), DAY)).toBe(510);
    expect(minutesIntoDay(new Date(2026, 9, 23, 1, 0), DAY)).toBe(25 * 60);
  });

  it('builds timestamps that respect the cutoff', () => {
    expect(timestampFor(DAY, '22:15', '03:00')).toBe(new Date(2026, 9, 22, 22, 15).getTime());
    expect(timestampFor(DAY, '01:15', '03:00')).toBe(new Date(2026, 9, 23, 1, 15).getTime());
    expect(timestampFor(DAY, '01:15', '00:00')).toBe(new Date(2026, 9, 22, 1, 15).getTime());
    expect(toTimeOfDay(new Date(2026, 9, 22, 7, 5).getTime())).toBe('07:05');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('buildDayView', () => {
  it('marks pending, taken and skipped rows and counts them', () => {
    const view = buildDayView(
      plan,
      [event(1, { scheduleId: 11 }), event(2, { scheduleId: 12, medicineId: 2, status: 'SKIPPED' })],
      { kind: 'today', minutesIntoDay: 9 * 60 },
    );
    const [morning, evening] = view.groups;
    expect(morning.rows.map((r) => r.state)).toEqual(['taken', 'skipped']);
    expect([morning.taken, morning.skipped, morning.pending, morning.overdue]).toEqual([1, 1, 0, false]);
    expect([evening.pending, evening.overdue]).toEqual([1, false]);
    expect(view.totals).toEqual({ taken: 1, skipped: 1, pending: 1 });
  });

  it('flags overdue groups once their time has passed, and everything pending on past days', () => {
    expect(buildDayView(plan, [], { kind: 'today', minutesIntoDay: 8 * 60 }).groups[0].overdue).toBe(false);
    expect(buildDayView(plan, [], { kind: 'today', minutesIntoDay: 8 * 60 + 1 }).groups[0].overdue).toBe(true);
    expect(buildDayView(plan, [], { kind: 'past' }).groups.every((g) => g.overdue)).toBe(true);
    expect(buildDayView(plan, [], { kind: 'future' }).groups.some((g) => g.overdue)).toBe(false);
  });

  it('lists extra doses and records whose schedule left the plan', () => {
    const view = buildDayView(
      plan,
      [
        event(1, { kind: 'EXTRA', processedAt: 2 }),
        event(2, { scheduleId: 999, processedAt: 1 }),
        event(3, { kind: 'REFILL' }),
      ],
      { kind: 'past' },
    );
    expect(view.others.map((e) => e.id)).toEqual([2, 1]);
  });

  it('chooses timing from the date', () => {
    expect(timingFor('2026-10-21', DAY, 5)).toEqual({ kind: 'past' });
    expect(timingFor(DAY, DAY, 5)).toEqual({ kind: 'today', minutesIntoDay: 5 });
    expect(timingFor('2026-10-23', DAY, 5)).toEqual({ kind: 'future' });
  });
});

describe('filterDayView', () => {
  const view = buildDayView(plan, [event(1, { scheduleId: 11 })], { kind: 'today', minutesIntoDay: 0 });

  it('filters by state and drops empty groups', () => {
    expect(filterDayView(view.groups, 'pending', null).map((g) => g.rows.length)).toEqual([1, 1]);
    expect(filterDayView(view.groups, 'done', null).map((g) => [g.key, g.rows.length])).toEqual([['slot-1', 1]]);
    expect(filterDayView(view.groups, 'all', null)).toHaveLength(2);
  });

  it('filters by tag', () => {
    expect(filterDayView(view.groups, 'all', 7).flatMap((g) => g.rows.map((r) => r.schedule.id))).toEqual([11, 13]);
  });
});
