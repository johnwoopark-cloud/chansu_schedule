import { describe, expect, it } from 'vitest';
import { buildDayPlan } from '../src/domain/dayPlan';
import { med, occ, sched, SLOTS } from './helpers';

describe('buildDayPlan', () => {
  it('groups slot doses by slot and other doses by time, ordered by time', () => {
    const occurrences = occ({
      medicines: [med(1), med(2)],
      schedules: [
        sched(1, 1),
        sched(2, 2, { slotId: 2 }),
        sched(3, 2, { slotId: undefined, timeOfDay: '13:00' }),
        sched(4, 1, { slotId: undefined, timeOfDay: '06:00' }),
        sched(5, 2),
      ],
    });
    const plan = buildDayPlan(occurrences, SLOTS);
    expect(plan.map((g) => [g.slot?.label ?? g.time, g.occurrences.length])).toEqual([
      ['06:00', 1],
      ['아침', 2],
      ['13:00', 1],
      ['저녁', 1],
    ]);
  });

  it('sorts doses by medicine order then name', () => {
    const plan = buildDayPlan(
      occ({
        medicines: [med(1, { name: '다', sortOrder: 0 }), med(2, { name: '가', sortOrder: 1 }), med(3, { name: '나', sortOrder: 1 })],
        schedules: [sched(1, 2), sched(2, 3), sched(3, 1)],
      }),
      SLOTS,
    );
    expect(plan[0].occurrences.map((o) => o.medicine.name)).toEqual(['다', '가', '나']);
  });

  it('marks weekend-shifted slot groups with the shifted time', () => {
    const plan = buildDayPlan(
      occ({
        date: '2026-10-24',
        medicines: [med(1)],
        schedules: [sched(1, 1)],
        weekendShift: { weekdays: [true, false, false, false, false, false, true], time: '10:00' },
      }),
      SLOTS,
    );
    expect(plan[0]).toMatchObject({ time: '10:00', shifted: true });
  });
});
