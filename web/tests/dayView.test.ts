import { describe, expect, it } from 'vitest';
import { buildDayPlan } from '../src/domain/dayPlan';
import { buildDayView, filterDayView, timingFor } from '../src/domain/dayView';
import { addDays, logicalDate, minutesIntoDay, timestampFor, toTimeOfDay, logicalDayRange } from '../src/domain/dates';
import { at, DAY, event, med, occ, sched, SLOTS } from './helpers';

const medicines = [med(1, { tagIds: [7] }), med(2)];
const schedules = [sched(11, 1), sched(12, 2), sched(13, 1, { slotId: 2 })];
const plan = buildDayPlan(occ({ medicines, schedules }), SLOTS);
const today = (h: number, m = 0) => ({ kind: 'today' as const, now: at(2026, 10, 22, h, m) });

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

  it('builds timestamps and day ranges that respect the cutoff', () => {
    expect(timestampFor(DAY, '22:15', '03:00')).toBe(at(2026, 10, 22, 22, 15));
    expect(timestampFor(DAY, '01:15', '03:00')).toBe(at(2026, 10, 23, 1, 15));
    expect(timestampFor(DAY, '01:15', '00:00')).toBe(at(2026, 10, 22, 1, 15));
    expect(logicalDayRange(DAY, '03:00')).toEqual([at(2026, 10, 22, 3), at(2026, 10, 23, 3)]);
    expect(toTimeOfDay(at(2026, 10, 22, 7, 5))).toBe('07:05');
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
      today(9),
    );
    const [morning, evening] = view.groups;
    expect(morning.rows.map((r) => r.state)).toEqual(['taken', 'skipped']);
    expect([morning.taken, morning.skipped, morning.pending, morning.overdue]).toEqual([1, 1, 0, false]);
    expect([evening.pending, evening.overdue]).toEqual([1, false]);
    expect(view.totals).toEqual({ taken: 1, skipped: 1, pending: 1 });
  });

  it('flags overdue groups once their time has passed, and everything pending on past days', () => {
    expect(buildDayView(plan, [], today(8)).groups[0].overdue).toBe(false);
    expect(buildDayView(plan, [], today(8, 1)).groups[0].overdue).toBe(true);
    expect(buildDayView(plan, [], { kind: 'past' }).groups.every((g) => g.overdue)).toBe(true);
    expect(buildDayView(plan, [], { kind: 'future' }).groups.some((g) => g.overdue)).toBe(false);
  });

  it('lists extra doses and records whose schedule left the plan', () => {
    const view = buildDayView(
      plan,
      [event(1, { kind: 'EXTRA', processedAt: 2 }), event(2, { scheduleId: 999, processedAt: 1 }), event(3, { kind: 'REFILL' })],
      { kind: 'past' },
    );
    expect(view.others.map((e) => e.id)).toEqual([2, 1]);
  });

  it('keeps waiting linked doses out of counts and never overdue', () => {
    const linked = sched(20, 2, { type: 'LINKED', slotId: undefined, linked: { parentScheduleId: 11, delayMinutes: 30 } });
    const view = buildDayView(buildDayPlan(occ({ medicines, schedules: [schedules[0], linked] }), SLOTS), [], today(12));
    const waitingGroup = view.groups.find((g) => g.rows.some((r) => r.state === 'waiting'))!;
    expect(waitingGroup.pending).toBe(0);
    expect(waitingGroup.overdue).toBe(false);
  });

  it('chooses timing from the date', () => {
    expect(timingFor('2026-10-21', DAY, 5)).toEqual({ kind: 'past' });
    expect(timingFor(DAY, DAY, 5)).toEqual({ kind: 'today', now: 5 });
    expect(timingFor('2026-10-23', DAY, 5)).toEqual({ kind: 'future' });
  });
});

describe('filterDayView', () => {
  const view = buildDayView(plan, [event(1, { scheduleId: 11 })], today(0));

  it('filters by state and drops empty groups', () => {
    expect(filterDayView(view.groups, 'pending', null).map((g) => g.rows.length)).toEqual([1, 1]);
    expect(filterDayView(view.groups, 'done', null).map((g) => [g.key, g.rows.length])).toEqual([['slot-1', 1]]);
    expect(filterDayView(view.groups, 'all', null)).toHaveLength(2);
  });

  it('filters by tag', () => {
    expect(filterDayView(view.groups, 'all', 7).flatMap((g) => g.rows.map((r) => r.occurrence.schedule.id))).toEqual([11, 13]);
  });
});
