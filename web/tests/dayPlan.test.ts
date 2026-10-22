import { describe, expect, it } from 'vitest';
import type { Medicine, Schedule, Slot } from '../src/db/types';
import { buildDayPlan } from '../src/domain/dayPlan';
import { newMedicine } from '../src/domain/medicine';
import { newTimeSchedule } from '../src/domain/schedule';

const slots: Slot[] = [
  { id: 1, label: '아침', time: '08:00', order: 0 },
  { id: 2, label: '저녁', time: '18:30', order: 1 },
];
const med = (id: number, name: string, patch: Partial<Medicine> = {}): Medicine => ({
  ...newMedicine(id),
  id,
  name,
  ...patch,
});
const sched = (id: number, medicineId: number, patch: Partial<Schedule> = {}): Schedule => ({
  id,
  ...newTimeSchedule(medicineId, 1, '정'),
  ...patch,
});
const DAY = '2026-10-22';

describe('buildDayPlan', () => {
  it('groups by slot and places custom times by clock time', () => {
    const plan = buildDayPlan(
      DAY,
      slots,
      [med(1, '가'), med(2, '나')],
      [
        sched(1, 1),
        sched(2, 2, { slotId: 2 }),
        sched(3, 2, { slotId: undefined, timeOfDay: '13:00' }),
        sched(4, 1, { slotId: undefined, timeOfDay: '23:00' }),
        sched(5, 1, { slotId: undefined, timeOfDay: '06:00' }),
      ],
    );
    expect(plan.map((g) => g.key)).toEqual(['time-06:00', 'slot-1', 'time-13:00', 'slot-2', 'time-23:00']);
    expect(plan[1].doses.map((d) => d.medicine.name)).toEqual(['가']);
  });

  it('keeps empty slot groups and skips inactive schedules, stopped medicines and off days', () => {
    const plan = buildDayPlan(
      DAY,
      slots,
      [med(1, '가'), med(2, '나', { active: false })],
      [
        sched(1, 1, { active: false }),
        sched(2, 2),
        sched(3, 1, { periodEnd: '2026-10-21' }),
        sched(4, 99),
      ],
    );
    expect(plan.map((g) => [g.key, g.doses.length])).toEqual([
      ['slot-1', 0],
      ['slot-2', 0],
    ]);
  });

  it('keeps configured slot order even when it is not chronological', () => {
    const reordered: Slot[] = [
      { id: 2, label: '저녁', time: '18:30', order: 0 },
      { id: 1, label: '아침', time: '08:00', order: 1 },
    ];
    const plan = buildDayPlan(DAY, reordered, [med(1, '가')], [sched(1, 1, { slotId: undefined, timeOfDay: '12:00' })]);
    expect(plan.map((g) => g.key)).toEqual(['time-12:00', 'slot-2', 'slot-1']);
  });

  it('sorts doses by medicine order then name', () => {
    const plan = buildDayPlan(
      DAY,
      slots,
      [med(1, '다', { sortOrder: 0 }), med(2, '가', { sortOrder: 1 }), med(3, '나', { sortOrder: 1 })],
      [sched(1, 2), sched(2, 3), sched(3, 1)],
    );
    expect(plan[0].doses.map((d) => d.medicine.name)).toEqual(['다', '가', '나']);
  });
});
