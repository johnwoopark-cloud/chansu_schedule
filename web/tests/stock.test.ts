import { describe, expect, it } from 'vitest';
import type { DoseEvent, Medicine, Schedule, Slot } from '../src/db/types';
import { newMedicine } from '../src/domain/medicine';
import { newTimeSchedule } from '../src/domain/schedule';
import {
  averageDailyUsage,
  forecastPackets,
  forecastStock,
  stockDeduction,
  stockWarnings,
  unitsMatch,
} from '../src/domain/stock';
import { quantityDiff, suggestedQuantity, validatePrescription } from '../src/domain/prescription';

const TODAY = '2026-10-22'; // Thursday
const med = (patch: Partial<Medicine> = {}): Medicine => ({
  ...newMedicine(0),
  id: 1,
  name: '약',
  trackStock: true,
  stockAmount: 10,
  stockUnit: '정',
  ...patch,
});
const sched = (id: number, patch: Partial<Schedule> = {}): Schedule => ({ id, ...newTimeSchedule(1, 1, '정'), ...patch });
const ev = (patch: Partial<DoseEvent> = {}): DoseEvent => ({
  medicineId: 1,
  kind: 'SCHEDULED',
  date: TODAY,
  status: 'TAKEN',
  snapshot: { medicineName: '약', doseQty: 2, doseUnit: '정', tags: [] },
  symptomIds: [],
  ...patch,
});

describe('stockDeduction', () => {
  it('deducts taken scheduled and extra doses in the stock unit', () => {
    expect(stockDeduction(ev(), med())).toBe(2);
    expect(stockDeduction(ev({ kind: 'EXTRA' }), med())).toBe(2);
  });

  it('deducts nothing when skipped, untracked, unit differs, or for refills', () => {
    expect(stockDeduction(ev({ status: 'SKIPPED' }), med())).toBe(0);
    expect(stockDeduction(ev(), med({ trackStock: false }))).toBe(0);
    expect(stockDeduction(ev(), med({ stockUnit: 'mL' }))).toBe(0);
    expect(stockDeduction(ev({ kind: 'REFILL' }), med())).toBe(0);
    expect(stockDeduction(ev(), undefined)).toBe(0);
  });

  it('treats an empty stock unit as matching anything', () => {
    expect(unitsMatch('정', '')).toBe(true);
    expect(unitsMatch(' 정', '정 ')).toBe(true);
  });
});

describe('forecastStock', () => {
  const twiceDaily = [sched(1), sched(2, { slotId: 2 })];

  it('counts days covered and the run-out date', () => {
    // 10 tablets, 2 per day, nothing taken yet today → covers today..+4, runs out on day 5.
    const f = forecastStock(med(), twiceDaily, TODAY, new Set());
    expect(f).toEqual({ daysCovered: 5, runOutDate: '2026-10-27', noUsage: false });
  });

  it('only counts today’s doses that are still unchecked', () => {
    const f = forecastStock(med({ stockAmount: 9 }), twiceDaily, TODAY, new Set([1]));
    // Today needs 1 more (9 → 8), then 2/day for 4 days.
    expect(f.daysCovered).toBe(5);
  });

  it('follows weekdays and inactive schedules', () => {
    const weekdays = [sched(1, { weekdays: [false, true, true, true, true, true, false] }), sched(2, { active: false })];
    // Thu, Fri use 1 each; Sat/Sun none; Mon uses the 3rd → with 2 tablets runs out Monday.
    const f = forecastStock(med({ stockAmount: 2 }), weekdays, TODAY, new Set());
    expect(f.runOutDate).toBe('2026-10-26');
    expect(f.daysCovered).toBe(4);
  });

  it('reports no usage when nothing is scheduled', () => {
    expect(forecastStock(med(), [], TODAY, new Set())).toMatchObject({ runOutDate: null, noUsage: true });
  });

  it('runs out today when stock is already short', () => {
    expect(forecastStock(med({ stockAmount: 0 }), twiceDaily, TODAY, new Set())).toMatchObject({
      daysCovered: 0,
      runOutDate: TODAY,
    });
  });
});

describe('forecastPackets', () => {
  const slot: Slot = { id: 1, label: '아침', time: '08:00', order: 0, packetStock: 3 };
  it('uses one packet per day the slot has doses', () => {
    expect(forecastPackets(slot, [med()], [sched(1)], TODAY, false)).toMatchObject({ daysCovered: 3, runOutDate: '2026-10-25' });
    expect(forecastPackets(slot, [med()], [sched(1)], TODAY, true)).toMatchObject({ daysCovered: 4, runOutDate: '2026-10-26' });
  });
  it('is null when packets are not tracked', () => {
    expect(forecastPackets({ ...slot, packetStock: undefined }, [med()], [sched(1)], TODAY, false)).toBeNull();
  });
});

describe('stockWarnings', () => {
  it('orders expired, low stock, packets, threshold, expiring', () => {
    const meds = [
      med({ id: 1, name: 'A', expirationDate: '2026-11-10' }),
      med({ id: 2, name: 'B', stockAmount: 3, stockThreshold: 5 }),
      med({ id: 3, name: 'C' }),
      med({ id: 4, name: 'D', expirationDate: '2026-10-01' }),
      med({ id: 5, name: 'E', trackStock: false }),
    ];
    const forecasts = new Map([
      [1, { daysCovered: 100, runOutDate: null, noUsage: false }],
      [2, { daysCovered: 100, runOutDate: null, noUsage: false }],
      [3, { daysCovered: 2, runOutDate: '2026-10-24', noUsage: false }],
      [4, { daysCovered: 100, runOutDate: null, noUsage: false }],
      [5, { daysCovered: 0, runOutDate: TODAY, noUsage: false }],
    ]);
    const slot: Slot = { id: 1, label: '아침', time: '08:00', order: 0, packetStock: 1 };
    const w = stockWarnings(meds, forecasts, [{ slot, packets: 1, daysCovered: 1, runOutDate: '2026-10-23' }], TODAY, 7);
    expect(w.map((x) => x.kind)).toEqual(['expired', 'low-stock', 'packets', 'below-threshold', 'expiring']);
    expect(w.find((x) => x.kind === 'expiring')).toMatchObject({ days: 19 });
  });
});

describe('prescription helpers', () => {
  it('suggests quantities from planned usage', () => {
    const schedules = [sched(1), sched(2, { doseQty: 0.5 })];
    expect(averageDailyUsage(med(), schedules, TODAY)).toBe(1.5);
    expect(suggestedQuantity(med(), schedules, 30, TODAY)).toBe(45);
    expect(suggestedQuantity(med(), [sched(1, { doseQty: 1 / 3 })], 30, TODAY)).toBe(10);
  });

  it('validates', () => {
    const base = { receivedDate: TODAY, items: [{ medicineId: 1, quantity: 30 }], packets: [], photoIds: [] };
    expect(validatePrescription(base)).toEqual({});
    expect(validatePrescription({ ...base, receivedDate: '' }).receivedDate).toBeDefined();
    expect(validatePrescription({ ...base, days: 0 }).days).toBeDefined();
    expect(validatePrescription({ ...base, days: 2.5 }).days).toBeDefined();
    expect(validatePrescription({ ...base, items: [] }).items).toBeDefined();
    expect(validatePrescription({ ...base, items: [{ medicineId: 1, quantity: 0 }] }).items).toBeDefined();
    expect(
      validatePrescription({ ...base, items: [{ medicineId: 1, quantity: 1 }, { medicineId: 1, quantity: 2 }] }).items,
    ).toBeDefined();
    expect(validatePrescription({ ...base, items: [], packets: [{ slotId: 1, count: 14 }] })).toEqual({});
    expect(validatePrescription({ ...base, packets: [{ slotId: 1, count: 0 }] }).packets).toBeDefined();
  });

  it('diffs quantities', () => {
    expect([...quantityDiff([[1, 30], [2, 10]], [[1, 60], [3, 5]])]).toEqual([
      [1, 30],
      [2, -10],
      [3, 5],
    ]);
    expect(quantityDiff([[1, 30]], [[1, 30]]).size).toBe(0);
  });
});
