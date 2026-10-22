import type { MedicationDB } from './database';
import type { Slot } from './types';
import { moveSlot, nextOrder, sortSlots, validateSlot, type SlotError } from '../domain/slots';

export type SlotResult = { ok: true } | { ok: false; error: SlotError | 'in-use' };

export async function listSlots(db: MedicationDB): Promise<Slot[]> {
  return sortSlots(await db.slots.toArray());
}

export async function addSlot(db: MedicationDB, draft: Pick<Slot, 'label' | 'time'>): Promise<SlotResult> {
  return db.transaction('rw', db.slots, async () => {
    const all = await db.slots.toArray();
    const error = validateSlot(draft, all);
    if (error) return { ok: false, error };
    await db.slots.add({ label: draft.label.trim(), time: draft.time, order: nextOrder(all) });
    return { ok: true };
  });
}

/**
 * Updates a slot. `packetStock`: a number sets the packet count, null stops
 * tracking packets, undefined leaves it unchanged.
 */
export async function updateSlot(
  db: MedicationDB,
  id: number,
  draft: Pick<Slot, 'label' | 'time'> & { packetStock?: number | null },
): Promise<SlotResult> {
  return db.transaction('rw', db.slots, async () => {
    const others = (await db.slots.toArray()).filter((s) => s.id !== id);
    const error = validateSlot(draft, others);
    if (error) return { ok: false, error };
    const slot = await db.slots.get(id);
    if (!slot) return { ok: true };
    const next: Slot = { ...slot, label: draft.label.trim(), time: draft.time };
    if (draft.packetStock === null) delete next.packetStock;
    else if (draft.packetStock !== undefined) next.packetStock = draft.packetStock;
    await db.slots.put(next);
    return { ok: true };
  });
}

/** Deletes a slot unless a schedule still uses it. */
export async function deleteSlot(db: MedicationDB, id: number): Promise<SlotResult> {
  return db.transaction('rw', db.slots, db.schedules, async () => {
    const used = await db.schedules.where('slotId').equals(id).count();
    if (used > 0) return { ok: false, error: 'in-use' };
    await db.slots.delete(id);
    return { ok: true };
  });
}

export async function moveSlotInDb(db: MedicationDB, id: number, direction: -1 | 1): Promise<void> {
  await db.transaction('rw', db.slots, async () => {
    const changed = moveSlot(await db.slots.toArray(), id, direction);
    await db.slots.bulkPut(changed);
  });
}
