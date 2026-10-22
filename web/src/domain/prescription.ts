import type { ISODate, Medicine, Prescription, Schedule } from '../db/types';
import { averageDailyUsage } from './stock';

export type PrescriptionErrors = Partial<Record<'receivedDate' | 'days' | 'items' | 'packets', string>>;

export function validatePrescription(p: Omit<Prescription, 'id'>): PrescriptionErrors {
  const errors: PrescriptionErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.receivedDate)) errors.receivedDate = '받은 날짜를 입력하세요.';
  if (p.days !== undefined && (!Number.isInteger(p.days) || p.days <= 0 || p.days > 365)) {
    errors.days = '처방 일수는 1~365 사이의 정수로 입력하세요.';
  }
  if (p.items.length === 0 && p.packets.length === 0) errors.items = '받은 약을 하나 이상 고르세요.';
  if (p.items.some((i) => !(i.quantity > 0) || Number.isNaN(i.quantity))) errors.items = '수량을 0보다 큰 숫자로 입력하세요.';
  if (new Set(p.items.map((i) => i.medicineId)).size !== p.items.length) errors.items = '같은 약이 두 번 들어 있습니다.';
  if (p.packets.some((x) => !Number.isInteger(x.count) || x.count <= 0)) errors.packets = '봉지 수는 1 이상의 정수로 입력하세요.';
  return errors;
}

/** Suggested quantity for `days` of a medicine: planned daily usage × days, rounded up. */
export function suggestedQuantity(medicine: Medicine, schedules: readonly Schedule[], days: number, from: ISODate): number {
  return Math.ceil(averageDailyUsage(medicine, schedules, from) * days - 1e-9);
}

/** Per-key differences between two [key, amount] lists (after − before); zero entries omitted. */
export function quantityDiff(
  before: readonly (readonly [number, number])[],
  after: readonly (readonly [number, number])[],
): Map<number, number> {
  const diff = new Map<number, number>();
  for (const [k, v] of before) diff.set(k, (diff.get(k) ?? 0) - v);
  for (const [k, v] of after) diff.set(k, (diff.get(k) ?? 0) + v);
  for (const [k, v] of diff) if (Math.abs(v) < 1e-9) diff.delete(k);
  return diff;
}
