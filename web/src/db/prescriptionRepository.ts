import type { MedicationDB } from './database';
import type { Prescription } from './types';
import { addDays } from '../domain/dates';
import { quantityDiff, validatePrescription, type PrescriptionErrors } from '../domain/prescription';

export type SavePrescriptionResult = { ok: true; id: number } | { ok: false; errors: PrescriptionErrors };

export async function listPrescriptions(db: MedicationDB): Promise<Prescription[]> {
  const all = await db.prescriptions.toArray();
  return all.sort((a, b) => b.receivedDate.localeCompare(a.receivedDate) || b.id! - a.id!);
}

/** Applies a change in received quantities to medicine stock and slot packets. */
async function applyQuantities(db: MedicationDB, before: Prescription | undefined, after: Prescription | undefined) {
  const pairs = <T,>(list: T[] | undefined, f: (x: T) => readonly [number, number]) => (list ?? []).map(f);
  const items = quantityDiff(
    pairs(before?.items, (i) => [i.medicineId, i.quantity]),
    pairs(after?.items, (i) => [i.medicineId, i.quantity]),
  );
  for (const [medicineId, delta] of items) {
    const m = await db.medicines.get(medicineId);
    if (!m) continue;
    // Receiving medicine turns stock tracking on; removing a prescription never turns it off.
    await db.medicines.update(medicineId, {
      stockAmount: m.stockAmount + delta,
      ...(delta > 0 ? { trackStock: true } : {}),
    });
  }
  const packets = quantityDiff(
    pairs(before?.packets, (p) => [p.slotId, p.count]),
    pairs(after?.packets, (p) => [p.slotId, p.count]),
  );
  for (const [slotId, delta] of packets) {
    const slot = await db.slots.get(slotId);
    if (!slot) continue;
    await db.slots.update(slotId, { packetStock: (slot.packetStock ?? 0) + delta });
  }
}

/**
 * Saves a prescription and updates stock by the difference from its previous
 * version. With `applyPeriod`, the active schedules of its medicines are limited
 * to the prescription's days, starting on the received date.
 */
export async function savePrescription(
  db: MedicationDB,
  prescription: Omit<Prescription, 'id'> & { id?: number },
  options: { applyPeriod?: boolean } = {},
): Promise<SavePrescriptionResult> {
  const errors = validatePrescription(prescription);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return db.transaction('rw', db.prescriptions, db.medicines, db.slots, db.schedules, async () => {
    const clean = {
      ...prescription,
      hospital: prescription.hospital?.trim() || undefined,
      pharmacy: prescription.pharmacy?.trim() || undefined,
      note: prescription.note?.trim() || undefined,
    };
    const before = clean.id !== undefined ? await db.prescriptions.get(clean.id) : undefined;
    const id = (await db.prescriptions.put(clean as Prescription)) as number;
    await applyQuantities(db, before, { ...clean, id } as Prescription);

    if (options.applyPeriod && clean.days) {
      const periodEnd = addDays(clean.receivedDate, clean.days - 1);
      for (const item of clean.items) {
        await db.schedules
          .where('medicineId')
          .equals(item.medicineId)
          .filter((s) => s.active)
          .modify({ periodStart: clean.receivedDate, periodEnd, sourcePrescriptionId: id });
      }
    }
    return { ok: true, id } as const;
  });
}

/** Deletes a prescription and takes its quantities back out of stock. */
export async function deletePrescription(db: MedicationDB, id: number): Promise<void> {
  await db.transaction('rw', db.prescriptions, db.medicines, db.slots, db.photos, async () => {
    const before = await db.prescriptions.get(id);
    if (!before) return;
    await applyQuantities(db, before, undefined);
    await db.photos.bulkDelete(before.photoIds);
    await db.prescriptions.delete(id);
  });
}
