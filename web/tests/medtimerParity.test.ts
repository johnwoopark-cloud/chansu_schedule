// Cases ported from MedTimer's scheduler unit tests (github.com/Futsch1/medTimer, MIT):
// ReminderSchedulerWindowedIntervalUnitTest, ReminderSchedulerIntervalUnitTest,
// ReminderSchedulerWeekendModeTest. MedTimer asks "what is the next reminder";
// here the same expectations are checked against a day's planned doses.
import { describe, expect, it } from 'vitest';
import type { Schedule } from '../src/db/types';
import { at, event, med, occ, sched } from './helpers';

const D1 = '2026-10-22'; // Thursday, like MedTimer's 1970-01-01
const D2 = '2026-10-23';
const on = (day: 1 | 2 | 3, minutes: number) => at(2026, 10, 21 + day, 0, minutes);

const windowed = (patch: Partial<Schedule> = {}) =>
  sched(1, 1, {
    type: 'WINDOWED_INTERVAL',
    slotId: undefined,
    window: { start: '02:00', end: '11:40' },
    interval: { minutes: 480, startAt: 0, fromProcessed: false },
    ...patch,
  });

describe('MedTimer parity: windowed interval', () => {
  it('scheduleWindowedIntervalReminder: 8h within 02:00–11:40 → 02:00, 10:00', () => {
    expect(occ({ date: D1, today: D1, medicines: [med(1)], schedules: [windowed()] }).map((o) => o.at)).toEqual([on(1, 120), on(1, 600)]);
  });

  it('…from processed: checked at 02:01 → next 10:01; checked 10:01 → next day 02:00', () => {
    const s = windowed({ interval: { minutes: 480, startAt: 0, fromProcessed: true } });
    const first = event(1, { date: D2, scheduleId: 1, scheduledAt: on(2, 120), processedAt: on(2, 121) });
    const day2 = occ({ date: D2, today: D2, medicines: [med(1)], schedules: [s], events: [first] });
    expect(day2.map((o) => o.at)).toEqual([on(2, 120), on(2, 601)]);

    const second = event(2, { date: D2, scheduleId: 1, scheduledAt: on(2, 601), processedAt: on(2, 601) });
    const after = occ({ date: D2, today: D2, medicines: [med(1)], schedules: [s], events: [first, second] });
    expect(after.map((o) => o.at)).toEqual([on(2, 120), on(2, 601)]); // 18:01 is past 11:40
    expect(occ({ date: '2026-10-24', today: D2, medicines: [med(1)], schedules: [s] })[0].at).toBe(on(3, 120));
  });

  it('scheduleWindowedIntervalReminderNextDay: 10h within 16:40–03:20 → 16:40, then 02:40 next morning', () => {
    const s = windowed({ window: { start: '16:40', end: '03:20' }, interval: { minutes: 600, startAt: 0, fromProcessed: false } });
    expect(occ({ date: D1, today: D1, medicines: [med(1)], schedules: [s] }).map((o) => o.at)).toEqual([on(1, 1000), on(2, 160)]);
    expect(occ({ date: D2, today: D1, medicines: [med(1)], schedules: [s] }).map((o) => o.at)).toEqual([on(2, 1000), on(3, 160)]);
  });
});

describe('MedTimer parity: continuous interval', () => {
  const s = sched(1, 1, {
    type: 'CONTINUOUS_INTERVAL',
    slotId: undefined,
    interval: { minutes: 480, startAt: on(1, 120), fromProcessed: false },
  });

  it('scheduleIntervalReminder: 8h from day 1 02:00 → day 2 02:00, 10:00, 18:00', () => {
    expect(occ({ date: D2, today: D2, medicines: [med(1)], schedules: [s] }).map((o) => o.at)).toEqual([on(2, 120), on(2, 600), on(2, 1080)]);
  });

  it('…from processed: processed at day 2 02:01 → next 10:01', () => {
    const fromProcessed = { ...s, interval: { ...s.interval!, fromProcessed: true } };
    const e = event(1, { date: D2, scheduleId: 1, scheduledAt: on(2, 120), processedAt: on(2, 121) });
    const list = occ({ date: D2, today: D2, medicines: [med(1)], schedules: [fromProcessed], events: [e], lastProcessed: new Map([[1, on(2, 121)]]) });
    expect(list.map((o) => o.at).slice(0, 2)).toEqual([on(2, 120), on(2, 601)]);
  });
});

describe('MedTimer parity: weekend mode', () => {
  const weekend = [true, false, false, false, false, false, true];

  it('weekendMode: 00:16 on Thursday unchanged, on Saturday delayed to 10:00', () => {
    const s = sched(1, 1, { slotId: undefined, timeOfDay: '00:16' });
    const weekendShift = { weekdays: weekend, time: '10:00' };
    expect(occ({ date: D1, medicines: [med(1)], schedules: [s], weekendShift })[0].at).toBe(on(1, 16));
    expect(occ({ date: '2026-10-24', medicines: [med(1)], schedules: [s], weekendShift })[0].at).toBe(on(3, 600));
  });

  it('weekendModeTimeRange: from 04:00 to 12:00 — 01:00 stays, 08:00 moves to 12:00', () => {
    const weekendShift = { weekdays: weekend, time: '12:00', from: '04:00' };
    const list = occ({
      date: '2026-10-24',
      medicines: [med(1)],
      schedules: [sched(1, 1, { slotId: undefined, timeOfDay: '01:00' }), sched(2, 1, { slotId: undefined, timeOfDay: '08:00' })],
      weekendShift,
    });
    expect(list.map((o) => o.at)).toEqual([on(3, 60), on(3, 720)]);
  });
});
