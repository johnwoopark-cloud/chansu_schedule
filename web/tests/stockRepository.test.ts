import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MedicationDB } from '../src/db/database';
import {
  addExtraDose,
  clearDoses,
  recordDoses,
  refillMedicine,
  restoreEvents,
  undoRefill,
  updateEvent,
} from '../src/db/doseRepository';
import { deletePrescription, savePrescription } from '../src/db/prescriptionRepository';
import type { Medicine, Schedule } from '../src/db/types';
import { newMedicine } from '../src/domain/medicine';
import { newTimeSchedule } from '../src/domain/schedule';

let db: MedicationDB;
let counter = 0;
const DAY = '2026-10-22';
let medicine: Medicine;
let morning: Schedule;
let morning2: Schedule;
let other: Medicine;

const stock = async (id = medicine.id!) => (await db.medicines.get(id))!.stockAmount;
const packets = async (slotId = 1) => (await db.slots.get(slotId))!.packetStock;

beforeEach(async () => {
  db = new MedicationDB(`stock-test-${counter++}`);
  await db.open();
  const id = (await db.medicines.add({ ...newMedicine(0), name: 'A', trackStock: true, stockAmount: 30 } as Medicine)) as number;
  medicine = (await db.medicines.get(id))!;
  const otherId = (await db.medicines.add({ ...newMedicine(1), name: 'B', trackStock: true, stockAmount: 10 } as Medicine)) as number;
  other = (await db.medicines.get(otherId))!;
  morning = (await db.schedules.get((await db.schedules.add({ ...newTimeSchedule(id, 1, '정'), doseQty: 2 } as Schedule)) as number))!;
  morning2 = (await db.schedules.get((await db.schedules.add(newTimeSchedule(otherId, 1, '정') as Schedule)) as number))!;
  await db.slots.update(1, { packetStock: 5 });
});

afterEach(async () => {
  await db.delete();
});

const take = (s: Schedule, m: Medicine, status: 'TAKEN' | 'SKIPPED' = 'TAKEN', date = DAY) =>
  recordDoses(db, date, [{ schedule: s, medicine: m, time: '08:00' }], status, 1, '03:00');

describe('stock follows dose records', () => {
  it('deducts on take, restores on clear, and records before/after', async () => {
    const [id] = await take(morning, medicine);
    expect(await stock()).toBe(28);
    expect(await db.doseEvents.get(id)).toMatchObject({ stockDeducted: 2, stockBefore: 30, stockAfter: 28 });
    await clearDoses(db, [id]);
    expect(await stock()).toBe(30);
  });

  it('adjusts when status or amount changes, and undo restores', async () => {
    const [id] = await take(morning, medicine);
    const original = (await db.doseEvents.get(id))!;
    await updateEvent(db, id, { status: 'SKIPPED' });
    expect(await stock()).toBe(30);
    await updateEvent(db, id, { status: 'TAKEN', doseQty: 3 });
    expect(await stock()).toBe(27);
    await restoreEvents(db, [original]);
    expect(await stock()).toBe(28);
    await take(morning, medicine, 'SKIPPED');
    expect(await stock()).toBe(30);
  });

  it('re-checking the same dose never double-deducts', async () => {
    await take(morning, medicine);
    await take(morning, medicine);
    expect(await stock()).toBe(28);
  });

  it('restoring a cleared record deducts again', async () => {
    const [id] = await take(morning, medicine);
    const original = (await db.doseEvents.get(id))!;
    await clearDoses(db, [id]);
    await restoreEvents(db, [original]);
    expect(await stock()).toBe(28);
  });

  it('ignores untracked medicines and mismatched units', async () => {
    await db.medicines.update(medicine.id!, { trackStock: false });
    await take(morning, { ...medicine, trackStock: false });
    expect(await stock()).toBe(30);
    await db.medicines.update(medicine.id!, { trackStock: true, stockUnit: 'mL' });
    await addExtraDose(db, { medicine, date: DAY, processedAt: 1, doseQty: 1, doseUnit: '정' });
    expect(await stock()).toBe(30);
  });

  it('extra doses deduct and their deletion restores', async () => {
    const id = await addExtraDose(db, { medicine, date: DAY, processedAt: 1, doseQty: 1, doseUnit: '정' });
    expect(await stock()).toBe(29);
    await clearDoses(db, [id]);
    expect(await stock()).toBe(30);
  });
});

describe('packets', () => {
  it('uses one packet per slot per day, returned when nothing taken remains', async () => {
    const [a] = await take(morning, medicine);
    expect(await packets()).toBe(4);
    const [b] = await take(morning2, other);
    expect(await packets()).toBe(4);
    await clearDoses(db, [a]);
    expect(await packets()).toBe(4);
    await updateEvent(db, b, { status: 'SKIPPED' });
    expect(await packets()).toBe(5);
    await take(morning, medicine, 'TAKEN', '2026-10-23');
    expect(await packets()).toBe(4);
  });

  it('leaves untracked slots alone', async () => {
    await db.slots.update(1, { packetStock: undefined });
    await take(morning, medicine);
    expect(await packets()).toBeUndefined();
  });
});

describe('refills', () => {
  it('adds stock, turns tracking on, and can be undone', async () => {
    await db.medicines.update(medicine.id!, { trackStock: false });
    const id = await refillMedicine(db, medicine.id!, 30, DAY, 1);
    expect(await db.medicines.get(medicine.id!)).toMatchObject({ stockAmount: 60, trackStock: true });
    expect(await db.doseEvents.get(id)).toMatchObject({ kind: 'REFILL', stockBefore: 30, stockAfter: 60 });
    await undoRefill(db, id);
    expect(await stock()).toBe(30);
    expect(await db.doseEvents.count()).toBe(0);
  });
});

describe('prescriptions', () => {
  it('adds stock and packets, applies edits as differences, and reverses on delete', async () => {
    const saved = await savePrescription(db, {
      receivedDate: DAY,
      days: 14,
      items: [
        { medicineId: medicine.id!, quantity: 28 },
        { medicineId: other.id!, quantity: 14 },
      ],
      packets: [{ slotId: 1, count: 14 }],
      photoIds: [],
      hospital: '  내과  ',
    });
    expect(saved.ok).toBe(true);
    const id = saved.ok ? saved.id : -1;
    expect([await stock(), await stock(other.id!), await packets()]).toEqual([58, 24, 19]);
    expect((await db.prescriptions.get(id))!.hospital).toBe('내과');

    const existing = (await db.prescriptions.get(id))!;
    await savePrescription(db, { ...existing, items: [{ medicineId: medicine.id!, quantity: 30 }], packets: [] });
    expect([await stock(), await stock(other.id!), await packets()]).toEqual([60, 10, 5]);

    await deletePrescription(db, id);
    expect([await stock(), await stock(other.id!), await packets()]).toEqual([30, 10, 5]);
    expect(await db.prescriptions.count()).toBe(0);
  });

  it('starts tracking packets for a slot that had none', async () => {
    await db.slots.update(2, { packetStock: undefined });
    await savePrescription(db, { receivedDate: DAY, items: [], packets: [{ slotId: 2, count: 7 }], photoIds: [] });
    expect(await packets(2)).toBe(7);
  });

  it('optionally limits schedules to the prescription period', async () => {
    const saved = await savePrescription(
      db,
      { receivedDate: DAY, days: 7, items: [{ medicineId: medicine.id!, quantity: 14 }], packets: [], photoIds: [] },
      { applyPeriod: true },
    );
    const s = (await db.schedules.get(morning.id!))!;
    expect(s).toMatchObject({ periodStart: DAY, periodEnd: '2026-10-28', sourcePrescriptionId: saved.ok ? saved.id : -1 });
    expect((await db.schedules.get(morning2.id!))!.periodEnd).toBeUndefined();
  });

  it('rejects invalid input without touching stock', async () => {
    const r = await savePrescription(db, { receivedDate: DAY, items: [], packets: [], photoIds: [] });
    expect(r.ok).toBe(false);
    expect(await stock()).toBe(30);
  });
});

describe('v3 upgrade', () => {
  it('turns tracking on for medicines that already had stock entered', async () => {
    const name = `upgrade3-${counter++}`;
    const v2 = new Dexie(name);
    v2.version(2).stores({ medicines: '++id, name, active, sortOrder, *tagIds' });
    await v2.open();
    // Medicines saved before v3 have no trackStock field.
    const legacy = (patch: Partial<Medicine>) => {
      const { trackStock: _absent, ...rest } = { ...newMedicine(0), ...patch };
      return rest;
    };
    await v2.table('medicines').bulkAdd([legacy({ name: 'with stock', stockAmount: 5 }), legacy({ name: 'none' })]);
    v2.close();
    const upgraded = new MedicationDB(name);
    await upgraded.open();
    expect((await upgraded.medicines.toArray()).map((m) => [m.name, m.trackStock])).toEqual([
      ['with stock', true],
      ['none', false],
    ]);
    await upgraded.delete();
  });
});
