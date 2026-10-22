import type { MedicationDB } from './database';
import { DEFAULT_SETTINGS } from './database';
import type { DoseEvent, DoseStatus, ISODate, Medicine, Schedule, Settings, Symptom } from './types';
import { timestampFor } from '../domain/dates';
import { stockDeduction } from '../domain/stock';

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
 * Keeps the medicine's stock in step with one record changing from `before`
 * to `after` (either may be absent). Mutates `after` to store what it now
 * deducts. Must run inside a transaction that includes `medicines`.
 */
async function syncStock(db: MedicationDB, before: DoseEvent | undefined, after: DoseEvent | undefined): Promise<void> {
  const medicineId = after?.medicineId ?? before?.medicineId;
  if (medicineId === undefined) return;
  const medicine = await db.medicines.get(medicineId);
  const previous = before?.stockDeducted ?? 0;
  const next = after ? stockDeduction(after, medicine) : 0;
  if (after) {
    if (next) after.stockDeducted = next;
    else delete after.stockDeducted;
  }
  const delta = next - previous;
  if (!medicine || delta === 0) return;
  const stockAfter = medicine.stockAmount - delta;
  await db.medicines.update(medicineId, { stockAmount: stockAfter });
  if (after && next > 0) {
    after.stockBefore = medicine.stockAmount;
    after.stockAfter = stockAfter;
  }
}

type PacketKey = string;
const packetKey = (date: ISODate, slotId: number): PacketKey => `${date}|${slotId}`;

async function takenInSlot(db: MedicationDB, date: ISODate, slotId: number): Promise<boolean> {
  const events = await db.doseEvents.where('[date+slotId]').equals([date, slotId]).toArray();
  return events.some((e) => e.kind === 'SCHEDULED' && e.status === 'TAKEN');
}

/**
 * Runs `write` and then adjusts packet stock: a slot uses one packet on a day
 * as soon as any of its doses is taken, and gets it back when none are.
 */
async function withPacketTracking<T>(
  db: MedicationDB,
  touched: readonly { date: ISODate; slotId?: number }[],
  write: () => Promise<T>,
): Promise<T> {
  const keys = new Map<PacketKey, { date: ISODate; slotId: number }>();
  for (const t of touched) if (t.slotId !== undefined) keys.set(packetKey(t.date, t.slotId), { date: t.date, slotId: t.slotId });
  const before = new Map<PacketKey, boolean>();
  for (const [key, { date, slotId }] of keys) before.set(key, await takenInSlot(db, date, slotId));

  const result = await write();

  for (const [key, { date, slotId }] of keys) {
    const now = await takenInSlot(db, date, slotId);
    if (now === before.get(key)) continue;
    const slot = await db.slots.get(slotId);
    if (slot?.packetStock === undefined) continue;
    await db.slots.update(slotId, { packetStock: slot.packetStock + (now ? -1 : 1) });
  }
  return result;
}

const WRITE_TABLES = (db: MedicationDB) => [db.doseEvents, db.medicines, db.slots, db.tags];

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
  return db.transaction('rw', WRITE_TABLES(db), async () => {
    const existing = await db.doseEvents.where('date').equals(date).toArray();
    const touched = doses.map((d) => ({ date, slotId: d.schedule.slotId }));
    return withPacketTracking(db, touched, async () => {
      const ids: number[] = [];
      for (const { schedule, medicine, time } of doses) {
        const prior = existing.find((e) => e.kind === 'SCHEDULED' && e.scheduleId === schedule.id);
        const after: DoseEvent = prior
          ? { ...prior, status, processedAt }
          : ({
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
            } as DoseEvent);
        await syncStock(db, prior, after);
        ids.push((await db.doseEvents.put(after)) as number);
      }
      return ids;
    });
  });
}

/** Removes records, returning their doses to "not checked" and their stock to the medicine. */
export async function clearDoses(db: MedicationDB, ids: readonly number[]): Promise<void> {
  await db.transaction('rw', WRITE_TABLES(db), async () => {
    const events = (await db.doseEvents.bulkGet([...ids])).filter((e): e is DoseEvent => !!e);
    await withPacketTracking(db, events, async () => {
      for (const e of events) {
        await syncStock(db, e, undefined);
        await db.doseEvents.delete(e.id!);
      }
    });
  });
}

/** Restores events exactly as they were (undo of an edit or a clear), re-applying their stock effect. */
export async function restoreEvents(db: MedicationDB, events: readonly DoseEvent[]): Promise<void> {
  await db.transaction('rw', WRITE_TABLES(db), async () => {
    await withPacketTracking(db, events, async () => {
      for (const original of events) {
        const current = await db.doseEvents.get(original.id!);
        const restored = { ...original };
        await syncStock(db, current, restored);
        await db.doseEvents.put(restored);
      }
    });
  });
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
  return db.transaction('rw', WRITE_TABLES(db), async () => {
    const event = {
      medicineId: dose.medicine.id!,
      kind: 'EXTRA',
      date: dose.date,
      processedAt: dose.processedAt,
      status: 'TAKEN',
      snapshot: await snapshotOf(db, dose.medicine, dose.doseQty, dose.doseUnit),
      ...(dose.note?.trim() ? { note: dose.note.trim() } : {}),
      symptomIds: [],
    } as DoseEvent;
    await syncStock(db, undefined, event);
    return (await db.doseEvents.add(event)) as number;
  });
}

export type EventPatch = Partial<Pick<DoseEvent, 'status' | 'processedAt' | 'note' | 'symptomIds'>> & {
  doseQty?: number;
};

export async function updateEvent(db: MedicationDB, id: number, patch: EventPatch): Promise<void> {
  await db.transaction('rw', WRITE_TABLES(db), async () => {
    const event = await db.doseEvents.get(id);
    if (!event) return;
    await withPacketTracking(db, [event], async () => {
      const { doseQty, ...rest } = patch;
      const next: DoseEvent = { ...event, ...rest };
      if (doseQty !== undefined) next.snapshot = { ...event.snapshot, doseQty };
      if (next.note !== undefined && !next.note.trim()) delete next.note;
      await syncStock(db, event, next);
      await db.doseEvents.put(next);
    });
  });
}

/**
 * Adds a refill to a medicine's stock and logs it as a REFILL record. Turns on
 * stock tracking. Returns the record id (for undo).
 */
export async function refillMedicine(
  db: MedicationDB,
  medicineId: number,
  quantity: number,
  date: ISODate,
  processedAt: number,
): Promise<number> {
  return db.transaction('rw', db.medicines, db.doseEvents, db.tags, async () => {
    const medicine = await db.medicines.get(medicineId);
    if (!medicine) throw new Error(`Medicine ${medicineId} not found`);
    const stockAfter = medicine.stockAmount + quantity;
    await db.medicines.update(medicineId, { stockAmount: stockAfter, trackStock: true });
    return (await db.doseEvents.add({
      medicineId,
      kind: 'REFILL',
      date,
      processedAt,
      status: 'TAKEN',
      snapshot: await snapshotOf(db, medicine, quantity, medicine.stockUnit),
      stockBefore: medicine.stockAmount,
      stockAfter,
      symptomIds: [],
    } as DoseEvent)) as number;
  });
}

/** Reverses a refill created by refillMedicine. */
export async function undoRefill(db: MedicationDB, eventId: number): Promise<void> {
  await db.transaction('rw', db.medicines, db.doseEvents, async () => {
    const event = await db.doseEvents.get(eventId);
    if (!event || event.kind !== 'REFILL') return;
    const medicine = await db.medicines.get(event.medicineId);
    if (medicine) await db.medicines.update(medicine.id!, { stockAmount: medicine.stockAmount - event.snapshot.doseQty });
    await db.doseEvents.delete(eventId);
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
