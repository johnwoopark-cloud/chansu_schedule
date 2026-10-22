import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MedicationDB } from '../src/db/database';
import { addSlot, deleteSlot, listSlots, moveSlotInDb, updateSlot } from '../src/db/slotRepository';

let db: MedicationDB;
let counter = 0;

beforeEach(async () => {
  db = new MedicationDB(`test-${counter++}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('first run', () => {
  it('seeds the four default slots and settings', async () => {
    expect((await listSlots(db)).map((s) => [s.label, s.time])).toEqual([
      ['아침', '08:00'],
      ['점심', '12:30'],
      ['저녁', '18:30'],
      ['취침 전', '22:00'],
    ]);
    expect(await db.settings.get('app')).toEqual(DEFAULT_SETTINGS);
  });
});

describe('slot repository', () => {
  it('adds a slot at the end with a trimmed label', async () => {
    expect(await addSlot(db, { label: ' 오후 간식 ', time: '15:00' })).toEqual({ ok: true });
    const last = (await listSlots(db)).at(-1)!;
    expect(last).toMatchObject({ label: '오후 간식', time: '15:00', order: 4 });
  });

  it('rejects duplicates on add and update', async () => {
    expect(await addSlot(db, { label: '아침', time: '07:00' })).toEqual({ ok: false, error: 'label-duplicate' });
    const [morning, lunch] = await listSlots(db);
    expect(await updateSlot(db, lunch.id!, { label: '아침', time: '12:00' })).toEqual({
      ok: false,
      error: 'label-duplicate',
    });
    // Keeping its own label is fine.
    expect(await updateSlot(db, morning.id!, { label: '아침', time: '07:30' })).toEqual({ ok: true });
    expect((await db.slots.get(morning.id!))!.time).toBe('07:30');
  });

  it('refuses to delete a slot that a schedule uses', async () => {
    const [morning, lunch] = await listSlots(db);
    await db.schedules.add({
      medicineId: 1,
      type: 'TIME',
      slotId: morning.id,
      doseQty: 1,
      doseUnit: '정',
      variableAmount: false,
      autoTaken: false,
      instructions: '',
      active: true,
      weekdays: Array(7).fill(true),
      monthDays: 0,
    });
    expect(await deleteSlot(db, morning.id!)).toEqual({ ok: false, error: 'in-use' });
    expect(await deleteSlot(db, lunch.id!)).toEqual({ ok: true });
    expect((await listSlots(db)).map((s) => s.label)).toEqual(['아침', '저녁', '취침 전']);
  });

  it('reorders slots', async () => {
    const [, , dinner] = await listSlots(db);
    await moveSlotInDb(db, dinner.id!, -1);
    expect((await listSlots(db)).map((s) => s.label)).toEqual(['아침', '저녁', '점심', '취침 전']);
  });
});
