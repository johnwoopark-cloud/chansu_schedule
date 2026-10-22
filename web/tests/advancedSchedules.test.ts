import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MedicationDB } from '../src/db/database';
import { loadDayContext, loadOccurrences } from '../src/db/dayContext';
import { recordDoses, updateSettings } from '../src/db/doseRepository';
import { deleteSchedule, saveSchedule } from '../src/db/medicineRepository';
import type { Medicine, Schedule } from '../src/db/types';
import { monthGrid, shiftMonth } from '../src/domain/calendar';
import { newMedicine } from '../src/domain/medicine';
import { describeMinutes, describeSchedule, monthDaysList, newTimeSchedule, validateSchedule } from '../src/domain/schedule';
import { averageDailyUsage, forecastStock } from '../src/domain/stock';
import { runAutoTaken } from '../src/lib/autoTaken';
import { at, med, sched, SLOTS } from './helpers';

const continuous = (patch: Partial<Schedule> = {}) =>
  sched(1, 1, {
    type: 'CONTINUOUS_INTERVAL',
    slotId: undefined,
    interval: { minutes: 360, startAt: at(2026, 10, 22, 6), fromProcessed: false },
    ...patch,
  });

describe('validateSchedule for advanced types', () => {
  it('checks intervals, windows, links and cycles', () => {
    expect(validateSchedule(continuous())).toEqual({});
    expect(validateSchedule(continuous({ interval: { minutes: 10, startAt: 0, fromProcessed: false } })).interval).toBeDefined();
    expect(validateSchedule(continuous({ interval: { minutes: 60, startAt: NaN, fromProcessed: false } })).when).toBeDefined();
    const windowed = sched(1, 1, {
      type: 'WINDOWED_INTERVAL',
      window: { start: '21:00', end: '21:00' },
      interval: { minutes: 60, startAt: 0, fromProcessed: false },
    });
    expect(validateSchedule(windowed).window).toBeDefined();
    expect(validateSchedule({ ...windowed, window: { start: '21:00', end: '09:00' } })).toEqual({}); // overnight
    expect(validateSchedule(sched(1, 1, { type: 'LINKED' })).linked).toBeDefined();
    expect(validateSchedule(sched(1, 1, { type: 'LINKED', linked: { parentScheduleId: 2, delayMinutes: 2000 } })).linked).toBeDefined();
    expect(validateSchedule(sched(1, 1, { cycle: { startDate: '2026-10-01', activeDays: 21, pauseDays: 0 } })).cycle).toBeDefined();
    expect(validateSchedule(sched(1, 1, { cycle: { startDate: '2026-10-01', activeDays: 21, pauseDays: 7 } }))).toEqual({});
  });

  it('allows a variable amount without a fixed dose', () => {
    expect(validateSchedule(sched(1, 1, { variableAmount: true, doseQty: NaN }))).toEqual({});
  });
});

describe('describeSchedule for advanced types', () => {
  const slots = new Map(SLOTS.map((s) => [s.id!, s]));
  it('summarises each type', () => {
    expect(describeMinutes(90)).toBe('1시간 30분');
    expect(describeMinutes(1500)).toBe('1일 1시간');
    expect(monthDaysList((1 << 0) | (1 << 14))).toEqual([1, 15]);
    expect(describeSchedule(continuous(), { slots })).toBe('6시간마다 · 26.10.22 오전 6:00부터');
    expect(describeSchedule(continuous({ interval: { minutes: 480, startAt: 0, fromProcessed: true } }), { slots })).toBe(
      '8시간마다 · 체크한 시각 기준',
    );
    const windowed = sched(1, 1, {
      type: 'WINDOWED_INTERVAL',
      window: { start: '09:00', end: '21:00' },
      interval: { minutes: 240, startAt: 0, fromProcessed: false },
    });
    expect(describeSchedule(windowed, { slots })).toBe('오전 9:00~오후 9:00 4시간마다 · 매일');
    const parent = sched(5, 7);
    const linked = sched(1, 1, { type: 'LINKED', linked: { parentScheduleId: 5, delayMinutes: 30 } });
    expect(
      describeSchedule(linked, { slots, schedules: new Map([[5, parent]]), medicines: new Map([[7, { name: '아스피린' }]]) }),
    ).toBe('아스피린 복용 30분 후');
    expect(describeSchedule(sched(1, 1, { monthDays: 1 }), { slots })).toBe('아침 · 매월 1일');
    expect(describeSchedule(sched(1, 1, { cycle: { startDate: '2026-10-01', activeDays: 21, pauseDays: 7 } }), { slots })).toBe(
      '아침 · 매일 · 21일 복용 7일 휴약',
    );
  });
});

describe('stock with interval schedules', () => {
  it('counts every planned dose per day', () => {
    const m = med(1, { trackStock: true, stockAmount: 10, stockUnit: '정' });
    const s = continuous({ interval: { minutes: 480, startAt: at(2026, 10, 1, 6), fromProcessed: false } }); // 3/day
    expect(averageDailyUsage(m, [s], '2026-10-22')).toBe(3);
    expect(forecastStock(m, [s], '2026-10-22', 3)).toMatchObject({ daysCovered: 3, runOutDate: '2026-10-25' });
  });
});

describe('calendar grid', () => {
  it('builds a Monday-first 6-week grid', () => {
    const { month, days } = monthGrid('2026-10-22');
    expect(month).toBe('2026-10-01');
    expect(days[0]).toBe('2026-09-28'); // Monday
    expect(days).toHaveLength(42);
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
  });
});

let db: MedicationDB;
let counter = 0;
let medA: Medicine;
let medB: Medicine;

beforeEach(async () => {
  db = new MedicationDB(`adv-${counter++}`);
  await db.open();
  medA = (await db.medicines.get((await db.medicines.add({ ...newMedicine(0), name: 'A', trackStock: true, stockAmount: 20 } as Medicine)) as number))!;
  medB = (await db.medicines.get((await db.medicines.add({ ...newMedicine(1), name: 'B' } as Medicine)) as number))!;
});

afterEach(async () => {
  await db.delete();
});

async function save(s: Omit<Schedule, 'id'> & { id?: number }) {
  const r = await saveSchedule(db, s);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.id;
}

describe('linked schedules in the database', () => {
  it('refuses links to itself or its followers, and deleting a followed schedule', async () => {
    const parent = await save(newTimeSchedule(medA.id!, 1, '정'));
    const child = await save({ ...newTimeSchedule(medB.id!, undefined, '정'), type: 'LINKED', linked: { parentScheduleId: parent, delayMinutes: 30 } });
    const childRecord = (await db.schedules.get(child))!;
    expect(childRecord.slotId).toBeUndefined();
    expect(childRecord.timeOfDay).toBeUndefined();

    const self = await saveSchedule(db, { ...childRecord, linked: { parentScheduleId: child, delayMinutes: 5 } });
    expect(self.ok).toBe(false);
    const parentRecord = (await db.schedules.get(parent))!;
    const loop = await saveSchedule(db, { ...parentRecord, type: 'LINKED', linked: { parentScheduleId: child, delayMinutes: 5 } });
    expect(loop.ok).toBe(false);

    expect(await deleteSchedule(db, parent)).toEqual({ ok: false, reason: 'has-linked' });
    expect(await deleteSchedule(db, child)).toEqual({ ok: true });
    expect(await deleteSchedule(db, parent)).toEqual({ ok: true });
  });

  it('records a linked dose against its parent record and shows it after the parent is taken', async () => {
    const parent = await save(newTimeSchedule(medA.id!, 1, '정'));
    await save({ ...newTimeSchedule(medB.id!, undefined, '정'), type: 'LINKED', linked: { parentScheduleId: parent, delayMinutes: 30 } });
    const now = new Date(2026, 9, 22, 12);
    let ctx = await loadDayContext(db, now);
    let { occurrences } = await loadOccurrences(db, ctx, '2026-10-22');
    expect(occurrences.map((o) => !!o.waiting)).toEqual([false, true]);

    const [parentEvent] = await recordDoses(db, '2026-10-22', [{ occurrence: occurrences[0] }], 'TAKEN', at(2026, 10, 22, 9));
    ctx = await loadDayContext(db, now);
    ({ occurrences } = await loadOccurrences(db, ctx, '2026-10-22'));
    const linked = occurrences.find((o) => o.schedule.type === 'LINKED')!;
    expect(linked).toMatchObject({ at: at(2026, 10, 22, 9, 30), linkedEventId: parentEvent });
    const [childEvent] = await recordDoses(db, '2026-10-22', [{ occurrence: linked }], 'TAKEN', at(2026, 10, 22, 9, 31));
    expect((await db.doseEvents.get(childEvent))!.linkedEventId).toBe(parentEvent);
  });
});

describe('interval doses in the database', () => {
  it('keeps one record per planned time and deducts stock for each', async () => {
    await save({ ...continuous(), id: undefined, medicineId: medA.id! });
    const ctx = await loadDayContext(db, new Date(2026, 9, 22, 23));
    const { occurrences } = await loadOccurrences(db, ctx, '2026-10-22');
    // 06, 12, 18 and 00:00 — the default 03:00 cutoff keeps midnight in the same logical day.
    expect(occurrences).toHaveLength(4);
    await recordDoses(db, '2026-10-22', [{ occurrence: occurrences[0] }, { occurrence: occurrences[1] }], 'TAKEN', 1);
    await recordDoses(db, '2026-10-22', [{ occurrence: occurrences[1] }], 'SKIPPED', 2);
    const events = await db.doseEvents.toArray();
    expect(events.map((e) => [e.scheduledAt, e.status])).toEqual([
      [occurrences[0].at, 'TAKEN'],
      [occurrences[1].at, 'SKIPPED'],
    ]);
    expect((await db.medicines.get(medA.id!))!.stockAmount).toBe(19);
  });

  it('stores the amount entered for variable-amount doses', async () => {
    await save({ ...newTimeSchedule(medA.id!, 1, '정'), variableAmount: true });
    const ctx = await loadDayContext(db, new Date(2026, 9, 22, 9));
    const { occurrences } = await loadOccurrences(db, ctx, '2026-10-22');
    const [id] = await recordDoses(db, '2026-10-22', [{ occurrence: occurrences[0], doseQty: 2.5 }], 'TAKEN', 1);
    expect((await db.doseEvents.get(id))!.snapshot.doseQty).toBe(2.5);
    expect((await db.medicines.get(medA.id!))!.stockAmount).toBe(17.5);
  });
});

describe('auto-taken schedules', () => {
  it('records due doses once, from the last run, marked as automatic', async () => {
    await save({ ...newTimeSchedule(medA.id!, 1, '정'), autoTaken: true }); // 08:00
    await save({ ...newTimeSchedule(medA.id!, 2, '정'), autoTaken: true }); // 점심 12:30 (default slots)
    await save(newTimeSchedule(medB.id!, 1, '정')); // not auto

    // First run at 07:00 only sets the starting point.
    expect(await runAutoTaken(db, new Date(2026, 9, 22, 7))).toBe(0);
    expect(await runAutoTaken(db, new Date(2026, 9, 22, 9))).toBe(1);
    expect(await runAutoTaken(db, new Date(2026, 9, 22, 9, 30))).toBe(0);
    // App closed until the next evening: catches up on 22 12:30, 23 08:00 and 23 12:30.
    expect(await runAutoTaken(db, new Date(2026, 9, 23, 19))).toBe(3);
    const events = await db.doseEvents.toArray();
    expect(events.every((e) => e.auto && e.status === 'TAKEN' && e.medicineId === medA.id)).toBe(true);
    expect(events.map((e) => e.processedAt)).toEqual([
      at(2026, 10, 22, 8),
      at(2026, 10, 22, 12, 30),
      at(2026, 10, 23, 8),
      at(2026, 10, 23, 12, 30),
    ]);
    expect((await db.medicines.get(medA.id!))!.stockAmount).toBe(16);
  });

  it('never overwrites a dose the user already recorded', async () => {
    const id = await save({ ...newTimeSchedule(medA.id!, 1, '정'), autoTaken: true });
    await updateSettings(db, { lastAutoTakenAt: at(2026, 10, 22, 0) });
    const ctx = await loadDayContext(db, new Date(2026, 9, 22, 7));
    const { occurrences } = await loadOccurrences(db, ctx, '2026-10-22');
    await recordDoses(db, '2026-10-22', [{ occurrence: occurrences.find((o) => o.schedule.id === id)! }], 'SKIPPED', at(2026, 10, 22, 7));
    expect(await runAutoTaken(db, new Date(2026, 9, 22, 9))).toBe(0);
    expect((await db.doseEvents.toArray()).map((e) => e.status)).toEqual(['SKIPPED']);
  });
});
