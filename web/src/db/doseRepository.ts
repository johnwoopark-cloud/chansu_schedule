import type { MedicationDB } from './database';
import { DEFAULT_SETTINGS } from './database';
import type { DoseEvent, DoseStatus, ISODate, Medicine, Schedule, Settings, Symptom } from './types';
import { timestampFor } from '../domain/dates';

export async function getSettings(db: MedicationDB): Promise<Settings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
}

export async function updateSettings(db: MedicationDB, patch: Partial<Omit<Settings, 'key'>>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await getSettings(db);
    await db.settings.put({ ...current, ...patch, key: 'app' });
  });
}

export async function listEventsForDate(db: MedicationDB, date: ISODate): Promise<DoseEvent[]> {
  return db.doseEvents.where('date').equals(date).toArray();
}

async function snapshotOf(db: MedicationDB, medicine: Medicine, doseQty: number, doseUnit: string) {
  const tags = (await db.tags.bulkGet(medicine.tagIds)).flatMap((t) => (t ? [t.name] : []));
  return {
    medicineName: medicine.name,
    ...(medicine.strength !== undefined ? { strength: medicine.strength, strengthUnit: medicine.strengthUnit } : {}),
    doseQty,
    doseUnit,
    ...(medicine.useColor ? { color: medicine.color } : {}),
    tags,
  };
}

export interface ScheduledDose {
  schedule: Schedule;
  medicine: Medicine;
  /** Planned time of day ("08:00"), from the slot or the schedule. */
  time: string;
}

/**
 * Records taken/skipped for scheduled doses on `date`. Existing records for the
 * same schedule and date are updated in place, so re-checking never duplicates.
 * Returns the ids of the events written.
 */
export async function recordDoses(
  db: MedicationDB,
  date: ISODate,
  doses: readonly ScheduledDose[],
  status: DoseStatus,
  processedAt: number,
  cutoff: string,
): Promise<number[]> {
  return db.transaction('rw', db.doseEvents, db.tags, async () => {
    const existing = await db.doseEvents.where('date').equals(date).toArray();
    const ids: number[] = [];
    for (const { schedule, medicine, time } of doses) {
      const prior = existing.find((e) => e.kind === 'SCHEDULED' && e.scheduleId === schedule.id);
      if (prior) {
        await db.doseEvents.update(prior.id!, { status, processedAt });
        ids.push(prior.id!);
        continue;
      }
      const event: Omit<DoseEvent, 'id'> = {
        scheduleId: schedule.id,
        medicineId: medicine.id!,
        kind: 'SCHEDULED',
        date,
        ...(schedule.slotId !== undefined ? { slotId: schedule.slotId } : {}),
        scheduledAt: timestampFor(date, time, cutoff),
        processedAt,
        status,
        snapshot: await snapshotOf(db, medicine, schedule.doseQty, schedule.doseUnit),
        symptomIds: [],
      };
      ids.push((await db.doseEvents.add(event as DoseEvent)) as number);
    }
    return ids;
  });
}

/** Removes records, returning their doses to "not checked". Used for undo and "체크 취소". */
export async function clearDoses(db: MedicationDB, ids: readonly number[]): Promise<void> {
  await db.doseEvents.bulkDelete([...ids]);
}

/** Restores events exactly as they were (undo of an edit or a clear). */
export async function restoreEvents(db: MedicationDB, events: readonly DoseEvent[]): Promise<void> {
  await db.doseEvents.bulkPut([...events]);
}

export interface ExtraDose {
  medicine: Medicine;
  date: ISODate;
  processedAt: number;
  doseQty: number;
  doseUnit: string;
  note?: string;
}

export async function addExtraDose(db: MedicationDB, dose: ExtraDose): Promise<number> {
  return db.transaction('rw', db.doseEvents, db.tags, async () => {
    const event: Omit<DoseEvent, 'id'> = {
      medicineId: dose.medicine.id!,
      kind: 'EXTRA',
      date: dose.date,
      processedAt: dose.processedAt,
      status: 'TAKEN',
      snapshot: await snapshotOf(db, dose.medicine, dose.doseQty, dose.doseUnit),
      ...(dose.note?.trim() ? { note: dose.note.trim() } : {}),
      symptomIds: [],
    };
    return (await db.doseEvents.add(event as DoseEvent)) as number;
  });
}

export type EventPatch = Partial<Pick<DoseEvent, 'status' | 'processedAt' | 'note' | 'symptomIds'>> & {
  doseQty?: number;
};

export async function updateEvent(db: MedicationDB, id: number, patch: EventPatch): Promise<void> {
  await db.transaction('rw', db.doseEvents, async () => {
    const event = await db.doseEvents.get(id);
    if (!event) return;
    const { doseQty, ...rest } = patch;
    const next: DoseEvent = { ...event, ...rest };
    if (doseQty !== undefined) next.snapshot = { ...event.snapshot, doseQty };
    if (next.note !== undefined && !next.note.trim()) delete next.note;
    await db.doseEvents.put(next);
  });
}

export async function listSymptoms(db: MedicationDB): Promise<Symptom[]> {
  const all = await db.symptoms.toArray();
  return all.sort((a, b) => a.id! - b.id!);
}

export type SymptomResult = { ok: true; id: number } | { ok: false; error: 'empty' | 'duplicate' | 'too-long' };

export async function addSymptom(db: MedicationDB, name: string): Promise<SymptomResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'empty' };
  if (trimmed.length > 20) return { ok: false, error: 'too-long' };
  return db.transaction('rw', db.symptoms, async () => {
    if (await db.symptoms.where('name').equals(trimmed).count()) return { ok: false, error: 'duplicate' } as const;
    return { ok: true, id: (await db.symptoms.add({ name: trimmed })) as number } as const;
  });
}

/** Deletes a symptom tag and removes it from every record that used it. */
export async function deleteSymptom(db: MedicationDB, id: number): Promise<void> {
  await db.transaction('rw', db.symptoms, db.doseEvents, async () => {
    await db.symptoms.delete(id);
    await db.doseEvents
      .filter((e) => e.symptomIds.includes(id))
      .modify((e) => {
        e.symptomIds = e.symptomIds.filter((s) => s !== id);
      });
  });
}
