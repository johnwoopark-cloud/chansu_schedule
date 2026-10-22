import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_SYMPTOMS, MedicationDB } from '../src/db/database';
import {
  addExtraDose,
  addSymptom,
  clearDoses,
  deleteSymptom,
  getSettings,
  listEventsForDate,
  listSymptoms,
  recordDoses,
  restoreEvents,
  updateEvent,
  updateSettings,
} from '../src/db/doseRepository';
import { ensureTag } from '../src/db/medicineRepository';
import type { Medicine, Schedule } from '../src/db/types';
import { newMedicine } from '../src/domain/medicine';
import { newTimeSchedule } from '../src/domain/schedule';

let db: MedicationDB;
let counter = 0;
const DAY = '2026-10-22';
let medicine: Medicine;
let schedule: Schedule;

beforeEach(async () => {
  db = new MedicationDB(`dose-test-${counter++}`);
  await db.open();
  const tagId = await ensureTag(db, '혈압');
  const medId = (await db.medicines.add({
    ...newMedicine(0),
    name: '아모잘탄',
    strength: 5,
    strengthUnit: 'mg',
    tagIds: [tagId],
  } as Medicine)) as number;
  medicine = (await db.medicines.get(medId))!;
  const schedId = (await db.schedules.add(newTimeSchedule(medId, 1, '정') as Schedule)) as number;
  schedule = (await db.schedules.get(schedId))!;
});

afterEach(async () => {
  await db.delete();
});

describe('recordDoses', () => {
  it('creates a scheduled record with a snapshot, then updates it in place', async () => {
    const t1 = new Date(2026, 9, 22, 8, 5).getTime();
    const [id] = await recordDoses(db, DAY, [{ schedule, medicine, time: '08:00' }], 'TAKEN', t1, '03:00');
    const created = (await db.doseEvents.get(id))!;
    expect(created).toMatchObject({
      kind: 'SCHEDULED',
      scheduleId: schedule.id,
      slotId: 1,
      date: DAY,
      status: 'TAKEN',
      processedAt: t1,
      scheduledAt: new Date(2026, 9, 22, 8, 0).getTime(),
      snapshot: { medicineName: '아모잘탄', strength: 5, strengthUnit: 'mg', doseQty: 1, doseUnit: '정', tags: ['혈압'] },
    });

    const [again] = await recordDoses(db, DAY, [{ schedule, medicine, time: '08:00' }], 'SKIPPED', t1 + 1, '03:00');
    expect(again).toBe(id);
    expect(await db.doseEvents.count()).toBe(1);
    expect((await db.doseEvents.get(id))!.status).toBe('SKIPPED');
  });

  it('keeps separate records per date', async () => {
    await recordDoses(db, DAY, [{ schedule, medicine, time: '08:00' }], 'TAKEN', 1, '03:00');
    await recordDoses(db, '2026-10-23', [{ schedule, medicine, time: '08:00' }], 'TAKEN', 2, '03:00');
    expect((await listEventsForDate(db, DAY)).length).toBe(1);
    expect(await db.doseEvents.count()).toBe(2);
  });

  it('clears and restores records', async () => {
    const ids = await recordDoses(db, DAY, [{ schedule, medicine, time: '08:00' }], 'TAKEN', 1, '03:00');
    const before = await db.doseEvents.bulkGet(ids);
    await clearDoses(db, ids);
    expect(await db.doseEvents.count()).toBe(0);
    await restoreEvents(db, before.filter((e) => e !== undefined));
    expect((await db.doseEvents.get(ids[0]))!.status).toBe('TAKEN');
  });
});

describe('extra doses and edits', () => {
  it('adds an extra dose and edits it', async () => {
    const id = await addExtraDose(db, { medicine, date: DAY, processedAt: 5, doseQty: 0.5, doseUnit: '정', note: '  두통  ' });
    expect(await db.doseEvents.get(id)).toMatchObject({ kind: 'EXTRA', status: 'TAKEN', note: '두통', snapshot: { doseQty: 0.5 } });
    await updateEvent(db, id, { doseQty: 1, note: ' ', symptomIds: [1] });
    const edited = (await db.doseEvents.get(id))!;
    expect(edited.snapshot.doseQty).toBe(1);
    expect(edited.note).toBeUndefined();
    expect(edited.symptomIds).toEqual([1]);
  });
});

describe('symptoms', () => {
  it('seeds defaults on a new database', async () => {
    expect((await listSymptoms(db)).map((s) => s.name)).toEqual(DEFAULT_SYMPTOMS);
  });

  it('adds with validation and deletes from records', async () => {
    expect(await addSymptom(db, ' ')).toEqual({ ok: false, error: 'empty' });
    expect(await addSymptom(db, '두통')).toEqual({ ok: false, error: 'duplicate' });
    const added = await addSymptom(db, '손떨림');
    expect(added.ok).toBe(true);
    const id = added.ok ? added.id : -1;
    const eventId = await addExtraDose(db, { medicine, date: DAY, processedAt: 1, doseQty: 1, doseUnit: '정' });
    await updateEvent(db, eventId, { symptomIds: [1, id] });
    await deleteSymptom(db, id);
    expect((await db.doseEvents.get(eventId))!.symptomIds).toEqual([1]);
    expect((await listSymptoms(db)).some((s) => s.name === '손떨림')).toBe(false);
  });

  it('seeds symptoms when upgrading a v1 database', async () => {
    const name = `upgrade-${counter++}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ symptoms: '++id, &name', settings: '&key' });
    await v1.open();
    v1.close();
    const upgraded = new MedicationDB(name);
    await upgraded.open();
    expect(await upgraded.symptoms.count()).toBe(DEFAULT_SYMPTOMS.length);
    await upgraded.delete();
  });
});

describe('settings', () => {
  it('reads defaults and merges updates', async () => {
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    await updateSettings(db, { lateNightCutoff: '02:00' });
    expect((await getSettings(db)).lateNightCutoff).toBe('02:00');
    expect((await getSettings(db)).analysisRange).toBe(DEFAULT_SETTINGS.analysisRange);
  });
});
