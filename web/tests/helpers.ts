import type { DoseEvent, Medicine, Schedule, Slot } from '../src/db/types';
import { generateOccurrences, type OccurrenceInput } from '../src/domain/occurrences';
import { newMedicine } from '../src/domain/medicine';
import { newTimeSchedule } from '../src/domain/schedule';

export const DAY = '2026-10-22'; // Thursday

export const SLOTS: Slot[] = [
  { id: 1, label: '아침', time: '08:00', order: 0 },
  { id: 2, label: '저녁', time: '18:30', order: 1 },
];

export const med = (id: number, patch: Partial<Medicine> = {}): Medicine => ({
  ...newMedicine(id),
  id,
  name: `약${id}`,
  ...patch,
});

export const sched = (id: number, medicineId: number, patch: Partial<Schedule> = {}): Schedule => ({
  id,
  ...newTimeSchedule(medicineId, 1, '정'),
  ...patch,
});

export const event = (id: number, patch: Partial<DoseEvent>): DoseEvent => ({
  id,
  medicineId: 1,
  kind: 'SCHEDULED',
  date: DAY,
  status: 'TAKEN',
  snapshot: { medicineName: '약1', doseQty: 1, doseUnit: '정', tags: [] },
  symptomIds: [],
  ...patch,
});

/** Local timestamp helper: at(2026,10,22, 8,0). */
export const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

export function occ(partial: Partial<OccurrenceInput> & Pick<OccurrenceInput, 'medicines' | 'schedules'>) {
  return generateOccurrences({
    date: DAY,
    today: DAY,
    cutoff: '00:00',
    slots: SLOTS,
    events: [],
    lastProcessed: new Map(),
    ...partial,
  });
}

/** A TIME occurrence for repository tests. */
export const timeOcc = (schedule: Schedule, medicine: Medicine, when = 0) => ({
  key: `t${schedule.id}`,
  schedule,
  medicine,
  at: when,
  ...(schedule.slotId !== undefined ? { slotId: schedule.slotId } : {}),
});
