import { describe, expect, it } from 'vitest';
import { matchesOccurrence, plannedCount } from '../src/domain/occurrences';
import { at, DAY, event, med, occ, sched } from './helpers';

const times = (list: { at: number }[]) =>
  list.map((o) => {
    const d = new Date(o.at);
    return `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

describe('TIME', () => {
  it('uses the slot time, or its own time', () => {
    const list = occ({
      medicines: [med(1)],
      schedules: [sched(1, 1), sched(2, 1, { slotId: undefined, timeOfDay: '13:15' })],
    });
    expect(times(list)).toEqual(['22 08:00', '22 13:15']);
    expect(list[0].slotId).toBe(1);
  });

  it('skips inactive schedules, stopped medicines, missing slots and off days', () => {
    const list = occ({
      medicines: [med(1), med(2, { active: false })],
      schedules: [
        sched(1, 1, { active: false }),
        sched(2, 2),
        sched(3, 1, { slotId: 99 }),
        sched(4, 1, { weekdays: [true, false, false, false, false, false, true] }),
      ],
    });
    expect(list).toEqual([]);
  });

  it('places times before the cutoff after midnight', () => {
    const list = occ({ medicines: [med(1)], schedules: [sched(1, 1, { slotId: undefined, timeOfDay: '01:00' })], cutoff: '03:00' });
    expect(times(list)).toEqual(['23 01:00']);
  });

  it('applies weekend mode only on chosen days and only to earlier times', () => {
    const weekendShift = { weekdays: [true, false, false, false, false, false, true], time: '10:00' };
    const schedules = [sched(1, 1), sched(2, 1, { slotId: 2 })];
    expect(times(occ({ medicines: [med(1)], schedules, weekendShift }))).toEqual(['22 08:00', '22 18:30']);
    const sat = occ({ date: '2026-10-24', medicines: [med(1)], schedules, weekendShift });
    expect(times(sat)).toEqual(['24 10:00', '24 18:30']);
    expect(sat[0].shifted).toBe(true);
  });
});

describe('WINDOWED_INTERVAL', () => {
  const s = sched(1, 1, {
    type: 'WINDOWED_INTERVAL',
    slotId: undefined,
    window: { start: '09:00', end: '21:00' },
    interval: { minutes: 240, startAt: 0, fromProcessed: false },
  });

  it('repeats inside the daily window, including the end', () => {
    expect(times(occ({ medicines: [med(1)], schedules: [s] }))).toEqual(['22 09:00', '22 13:00', '22 17:00', '22 21:00']);
    expect(plannedCount(s, DAY, new Map([[1, s]]))).toBe(4);
  });

  it('respects weekdays', () => {
    const weekdaysOnly = { ...s, weekdays: [false, true, true, true, true, true, false] };
    expect(occ({ date: '2026-10-25', medicines: [med(1)], schedules: [weekdaysOnly] })).toEqual([]);
  });
});

describe('CONTINUOUS_INTERVAL (fixed)', () => {
  const s = sched(1, 1, {
    type: 'CONTINUOUS_INTERVAL',
    slotId: undefined,
    interval: { minutes: 8 * 60, startAt: at(2026, 10, 21, 6, 0), fromProcessed: false },
  });

  it('continues across days from the start time', () => {
    expect(times(occ({ medicines: [med(1)], schedules: [s] }))).toEqual(['22 06:00', '22 14:00', '22 22:00']);
    expect(plannedCount(s, DAY, new Map())).toBe(3);
  });

  it('starts on the start day and not before', () => {
    expect(times(occ({ date: '2026-10-21', medicines: [med(1)], schedules: [s] }))).toEqual(['21 06:00', '21 14:00', '21 22:00']);
    expect(occ({ date: '2026-10-20', medicines: [med(1)], schedules: [s] })).toEqual([]);
  });

  it('handles intervals that do not divide a day', () => {
    const odd = { ...s, interval: { ...s.interval!, minutes: 10 * 60 } };
    // 21 06:00, 16:00, 22 02:00, 12:00, 22:00
    expect(times(occ({ medicines: [med(1)], schedules: [odd] }))).toEqual(['22 02:00', '22 12:00', '22 22:00']);
  });

  it('respects the period', () => {
    expect(occ({ medicines: [med(1)], schedules: [{ ...s, periodEnd: '2026-10-21' }] })).toEqual([]);
  });
});

describe('CONTINUOUS_INTERVAL (from last check)', () => {
  const s = sched(1, 1, {
    type: 'CONTINUOUS_INTERVAL',
    slotId: undefined,
    interval: { minutes: 6 * 60, startAt: at(2026, 10, 22, 7, 0), fromProcessed: true },
  });

  it('starts at the start time when nothing has been checked', () => {
    expect(times(occ({ medicines: [med(1)], schedules: [s] }))).toEqual(['22 07:00', '22 13:00', '22 19:00']);
  });

  it('projects from the last check and keeps past records in place', () => {
    const e = event(5, { scheduleId: 1, scheduledAt: at(2026, 10, 22, 7, 0), processedAt: at(2026, 10, 22, 8, 30) });
    const list = occ({ medicines: [med(1)], schedules: [s], events: [e], lastProcessed: new Map([[1, e.processedAt!]]) });
    expect(times(list)).toEqual(['22 07:00', '22 14:30', '22 20:30']);
    expect(matchesOccurrence(e, list[0])).toBe(true);
    expect(matchesOccurrence(e, list[1])).toBe(false);
  });

  it('shows an overdue dose from an earlier day today, and only records on past days', () => {
    const last = at(2026, 10, 20, 22, 0);
    const today = occ({ medicines: [med(1)], schedules: [s], lastProcessed: new Map([[1, last]]) });
    expect(times(today)[0]).toBe('21 04:00');
    expect(occ({ date: '2026-10-21', today: DAY, medicines: [med(1)], schedules: [s], lastProcessed: new Map([[1, last]]) })).toEqual([]);
  });

  it('projects future days from the last check', () => {
    const last = at(2026, 10, 22, 21, 0);
    const tomorrow = occ({ date: '2026-10-23', medicines: [med(1)], schedules: [s], lastProcessed: new Map([[1, last]]) });
    expect(times(tomorrow)).toEqual(['23 03:00', '23 09:00', '23 15:00', '23 21:00']);
  });
});

describe('LINKED', () => {
  const parent = sched(1, 1);
  const child = sched(2, 2, { type: 'LINKED', slotId: undefined, linked: { parentScheduleId: 1, delayMinutes: 30 } });
  const grandchild = sched(3, 2, { type: 'LINKED', slotId: undefined, linked: { parentScheduleId: 2, delayMinutes: 60 } });
  const medicines = [med(1), med(2)];

  it('waits for the parent, with an estimated time', () => {
    const list = occ({ medicines, schedules: [parent, child, grandchild] });
    expect(list.map((o) => [o.schedule.id, !!o.waiting])).toEqual([
      [1, false],
      [2, true],
      [3, true],
    ]);
    expect(times(list)).toEqual(['22 08:00', '22 08:30', '22 09:30']);
  });

  it('follows the actual time the parent was taken, down the chain', () => {
    const p = event(10, { scheduleId: 1, processedAt: at(2026, 10, 22, 9, 0) });
    const c = event(11, { scheduleId: 2, medicineId: 2, linkedEventId: 10, processedAt: at(2026, 10, 22, 9, 40) });
    const list = occ({ medicines, schedules: [parent, child, grandchild], events: [p, c] });
    expect(times(list)).toEqual(['22 08:00', '22 09:30', '22 10:40']);
    expect(list[1].linkedEventId).toBe(10);
    expect(list[2].linkedEventId).toBe(11);
    expect(matchesOccurrence(c, list[1])).toBe(true);
  });

  it('disappears when the parent was skipped', () => {
    const p = event(10, { scheduleId: 1, status: 'SKIPPED', processedAt: at(2026, 10, 22, 9, 0) });
    expect(occ({ medicines, schedules: [parent, child], events: [p] }).map((o) => o.schedule.id)).toEqual([1]);
  });

  it('follows every dose of an interval parent', () => {
    const windowed = sched(1, 1, {
      type: 'WINDOWED_INTERVAL',
      slotId: undefined,
      window: { start: '08:00', end: '20:00' },
      interval: { minutes: 720, startAt: 0, fromProcessed: false },
    });
    const list = occ({ medicines, schedules: [windowed, child] });
    expect(list.filter((o) => o.schedule.id === 2)).toHaveLength(2);
    expect(plannedCount(child, DAY, new Map([[1, windowed], [2, child]]))).toBe(2);
  });

  it('survives a cycle without looping', () => {
    const a = sched(1, 1, { type: 'LINKED', slotId: undefined, linked: { parentScheduleId: 2, delayMinutes: 5 } });
    const b = sched(2, 1, { type: 'LINKED', slotId: undefined, linked: { parentScheduleId: 1, delayMinutes: 5 } });
    expect(occ({ medicines, schedules: [a, b] })).toEqual([]);
    expect(plannedCount(a, DAY, new Map([[1, a], [2, b]]))).toBe(0);
  });
});

describe('matchesOccurrence', () => {
  it('matches TIME records regardless of time, others by time', () => {
    const [timeOcc] = occ({ medicines: [med(1)], schedules: [sched(1, 1)] });
    expect(matchesOccurrence(event(1, { scheduleId: 1, scheduledAt: 123 }), timeOcc)).toBe(true);
    expect(matchesOccurrence(event(1, { scheduleId: 2 }), timeOcc)).toBe(false);
    expect(matchesOccurrence(event(1, { scheduleId: 1, kind: 'EXTRA' }), timeOcc)).toBe(false);
  });
});
