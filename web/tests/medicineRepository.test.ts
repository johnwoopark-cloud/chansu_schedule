import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MedicationDB } from '../src/db/database';
import {
  deleteMedicine,
  ensureTag,
  listMedicines,
  listSchedules,
  nextMedicineSortOrder,
  pruneUnusedTags,
  saveMedicine,
  saveSchedule,
  setAllSchedulesActive,
} from '../src/db/medicineRepository';
import { newMedicine } from '../src/domain/medicine';
import { newTimeSchedule } from '../src/domain/schedule';

let db: MedicationDB;
let counter = 0;

beforeEach(async () => {
  db = new MedicationDB(`med-test-${counter++}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

async function addMedicine(name: string) {
  const result = await saveMedicine(db, { ...newMedicine(await nextMedicineSortOrder(db)), name });
  if (!result.ok) throw new Error('save failed');
  return result.id;
}

describe('medicines', () => {
  it('saves, trims, orders and updates', async () => {
    const a = await addMedicine('  나  ');
    const b = await addMedicine('가');
    expect((await listMedicines(db)).map((m) => [m.name, m.sortOrder])).toEqual([
      ['나', 0],
      ['가', 1],
    ]);
    const existing = (await db.medicines.get(b))!;
    expect((await saveMedicine(db, { ...existing, name: '가2' })).ok).toBe(true);
    expect((await db.medicines.get(b))!.name).toBe('가2');
    expect(a).not.toBe(b);
  });

  it('rejects invalid medicines', async () => {
    const result = await saveMedicine(db, newMedicine(0));
    expect(result).toEqual({ ok: false, errors: { name: '약 이름을 입력하세요.' } });
    expect(await db.medicines.count()).toBe(0);
  });

  it('deletes with schedules, but not once history exists', async () => {
    const id = await addMedicine('가');
    await saveSchedule(db, newTimeSchedule(id, 1, '정'));
    expect(await deleteMedicine(db, id)).toEqual({ ok: true });
    expect(await db.schedules.count()).toBe(0);

    const kept = await addMedicine('나');
    await db.doseEvents.add({
      medicineId: kept,
      kind: 'SCHEDULED',
      date: '2026-10-22',
      status: 'TAKEN',
      snapshot: { medicineName: '나', doseQty: 1, doseUnit: '정', tags: [] },
      symptomIds: [],
    });
    expect(await deleteMedicine(db, kept)).toEqual({ ok: false, reason: 'has-history' });
    expect(await db.medicines.get(kept)).toBeDefined();
  });
});

describe('schedules', () => {
  it('drops timeOfDay when a slot is used and validates', async () => {
    const id = await addMedicine('가');
    const saved = await saveSchedule(db, { ...newTimeSchedule(id, 1, '정'), timeOfDay: '09:00', instructions: ' 식후 ' });
    expect(saved.ok).toBe(true);
    const [s] = await listSchedules(db, id);
    expect(s.timeOfDay).toBeUndefined();
    expect(s.instructions).toBe('식후');

    const bad = await saveSchedule(db, { ...newTimeSchedule(id, undefined, '정'), timeOfDay: '' });
    expect(bad.ok).toBe(false);
  });

  it('pauses and resumes all schedules of a medicine', async () => {
    const id = await addMedicine('가');
    const other = await addMedicine('나');
    await saveSchedule(db, newTimeSchedule(id, 1, '정'));
    await saveSchedule(db, newTimeSchedule(id, 2, '정'));
    await saveSchedule(db, newTimeSchedule(other, 1, '정'));
    await setAllSchedulesActive(db, id, false);
    expect((await listSchedules(db, id)).map((s) => s.active)).toEqual([false, false]);
    expect((await listSchedules(db, other))[0].active).toBe(true);
  });
});

describe('tags', () => {
  it('reuses tags by name and prunes unused ones', async () => {
    const t1 = await ensureTag(db, '혈압');
    expect(await ensureTag(db, ' 혈압 ')).toBe(t1);
    const t2 = await ensureTag(db, '영양제');
    const id = await addMedicine('가');
    const m = (await db.medicines.get(id))!;
    await saveMedicine(db, { ...m, tagIds: [t1] });
    await pruneUnusedTags(db);
    expect((await db.tags.toArray()).map((t) => t.id)).toEqual([t1]);
    expect(t2).not.toBe(t1);
  });
});
