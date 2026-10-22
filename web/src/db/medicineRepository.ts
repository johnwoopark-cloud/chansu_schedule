import type { MedicationDB } from './database';
import type { Medicine, Schedule, Tag } from './types';
import { validateMedicine, type MedicineErrors } from '../domain/medicine';
import { linkedDescendants, validateSchedule, type ScheduleErrors } from '../domain/schedule';

export type SaveResult<E> = { ok: true; id: number } | { ok: false; errors: E };

export async function nextMedicineSortOrder(db: MedicationDB): Promise<number> {
  const last = await db.medicines.orderBy('sortOrder').last();
  return (last?.sortOrder ?? -1) + 1;
}

export async function listMedicines(db: MedicationDB): Promise<Medicine[]> {
  const all = await db.medicines.toArray();
  return all.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'));
}

export async function saveMedicine(
  db: MedicationDB,
  medicine: Omit<Medicine, 'id'> & { id?: number },
): Promise<SaveResult<MedicineErrors>> {
  const errors = validateMedicine(medicine);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const clean = { ...medicine, name: medicine.name.trim(), notes: medicine.notes.trim() };
  if (clean.id !== undefined) {
    await db.medicines.put(clean as Medicine);
    return { ok: true, id: clean.id };
  }
  const { id: _omit, ...rest } = clean;
  const id = await db.medicines.add(rest as Medicine);
  return { ok: true, id: id as number };
}

export type DeleteMedicineResult = { ok: true } | { ok: false; reason: 'has-history' };

/** Deletes a medicine and its schedules. Refused once dose history exists; stop the medicine instead. */
export async function deleteMedicine(db: MedicationDB, id: number): Promise<DeleteMedicineResult> {
  return db.transaction('rw', db.medicines, db.schedules, db.doseEvents, async () => {
    if ((await db.doseEvents.where('medicineId').equals(id).count()) > 0) {
      return { ok: false, reason: 'has-history' } as const;
    }
    await db.schedules.where('medicineId').equals(id).delete();
    await db.medicines.delete(id);
    return { ok: true } as const;
  });
}

/** Stops (active=false) or resumes a medicine. Schedules keep their own state. */
export async function setMedicineActive(db: MedicationDB, id: number, active: boolean): Promise<void> {
  await db.medicines.update(id, { active });
}

/** Pauses or resumes every schedule of a medicine at once. */
export async function setAllSchedulesActive(db: MedicationDB, medicineId: number, active: boolean): Promise<void> {
  await db.schedules.where('medicineId').equals(medicineId).modify({ active });
}

export async function listSchedules(db: MedicationDB, medicineId: number): Promise<Schedule[]> {
  return db.schedules.where('medicineId').equals(medicineId).sortBy('id');
}

export async function saveSchedule(
  db: MedicationDB,
  schedule: Omit<Schedule, 'id'> & { id?: number },
): Promise<SaveResult<ScheduleErrors>> {
  const errors = validateSchedule(schedule);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return db.transaction('rw', db.schedules, async () => {
    if (schedule.type === 'LINKED' && schedule.linked) {
      const parentId = schedule.linked.parentScheduleId;
      const parent = await db.schedules.get(parentId);
      const loops =
        schedule.id !== undefined &&
        (parentId === schedule.id || linkedDescendants(schedule.id, await db.schedules.toArray()).has(parentId));
      if (!parent) return { ok: false, errors: { linked: '앞 일정을 찾을 수 없습니다.' } } as const;
      if (loops) return { ok: false, errors: { linked: '자기 자신이나 뒤따르는 일정에는 연결할 수 없습니다.' } } as const;
    }
    const clean: Omit<Schedule, 'id'> & { id?: number } = { ...schedule, instructions: schedule.instructions.trim() };
    // Keep only the fields the schedule type uses.
    if (clean.type !== 'TIME' || clean.slotId !== undefined) delete clean.timeOfDay;
    if (clean.type !== 'TIME') delete clean.slotId;
    if (clean.type !== 'CONTINUOUS_INTERVAL' && clean.type !== 'WINDOWED_INTERVAL') delete clean.interval;
    if (clean.type !== 'WINDOWED_INTERVAL') delete clean.window;
    if (clean.type !== 'LINKED') delete clean.linked;
    if (clean.id !== undefined) {
      await db.schedules.put(clean as Schedule);
      return { ok: true, id: clean.id } as const;
    }
    const { id: _omit, ...rest } = clean;
    return { ok: true, id: (await db.schedules.add(rest as Schedule)) as number } as const;
  });
}

export type DeleteScheduleResult = { ok: true } | { ok: false; reason: 'has-linked' };

/** Deletes a schedule unless another schedule follows it. */
export async function deleteSchedule(db: MedicationDB, id: number): Promise<DeleteScheduleResult> {
  return db.transaction('rw', db.schedules, async () => {
    if (linkedDescendants(id, await db.schedules.toArray()).size > 0) return { ok: false, reason: 'has-linked' } as const;
    await db.schedules.delete(id);
    return { ok: true } as const;
  });
}

export async function listTags(db: MedicationDB): Promise<Tag[]> {
  const tags = await db.tags.toArray();
  return tags.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** Returns the id of the tag with this name, creating it if needed. */
export async function ensureTag(db: MedicationDB, name: string): Promise<number> {
  const trimmed = name.trim();
  return db.transaction('rw', db.tags, async () => {
    const existing = await db.tags.where('name').equals(trimmed).first();
    if (existing) return existing.id!;
    return (await db.tags.add({ name: trimmed })) as number;
  });
}

/** Deletes tags no medicine uses any more. */
export async function pruneUnusedTags(db: MedicationDB): Promise<void> {
  await db.transaction('rw', db.tags, db.medicines, async () => {
    const used = new Set((await db.medicines.toArray()).flatMap((m) => m.tagIds));
    const unused = (await db.tags.toArray()).filter((t) => !used.has(t.id!)).map((t) => t.id!);
    await db.tags.bulkDelete(unused);
  });
}
