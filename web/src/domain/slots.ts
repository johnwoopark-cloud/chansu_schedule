import type { Slot, TimeOfDay } from '../db/types';

export const DEFAULT_SLOTS: readonly Omit<Slot, 'id'>[] = [
  { label: '아침', time: '08:00', order: 0 },
  { label: '점심', time: '12:30', order: 1 },
  { label: '저녁', time: '18:30', order: 2 },
  { label: '취침 전', time: '22:00', order: 3 },
];

export const MAX_LABEL_LENGTH = 20;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): value is TimeOfDay {
  return TIME_RE.test(value);
}

export function timeToMinutes(time: TimeOfDay): number {
  const match = TIME_RE.exec(time);
  if (!match) throw new Error(`Invalid time: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Slots in display order: by `order`, then by time for ties. */
export function sortSlots<T extends Slot>(slots: readonly T[]): T[] {
  return [...slots].sort((a, b) => a.order - b.order || timeToMinutes(a.time) - timeToMinutes(b.time));
}

export type SlotError = 'label-empty' | 'label-too-long' | 'label-duplicate' | 'time-invalid';

/** Validates a slot draft against the other existing slots. Returns the first problem, or null. */
export function validateSlot(draft: Pick<Slot, 'label' | 'time'>, others: readonly Slot[]): SlotError | null {
  const label = draft.label.trim();
  if (!label) return 'label-empty';
  if (label.length > MAX_LABEL_LENGTH) return 'label-too-long';
  if (others.some((s) => s.label.trim() === label)) return 'label-duplicate';
  if (!isValidTime(draft.time)) return 'time-invalid';
  return null;
}

export const SLOT_ERROR_MESSAGES: Record<SlotError, string> = {
  'label-empty': '이름을 입력하세요.',
  'label-too-long': `이름은 ${MAX_LABEL_LENGTH}자 이내로 입력하세요.`,
  'label-duplicate': '같은 이름의 복용 시기가 이미 있습니다.',
  'time-invalid': '시각을 올바르게 입력하세요.',
};

/**
 * Moves the slot with `id` one step up or down in display order and returns
 * every slot whose `order` changed, renumbered 0..n-1.
 */
export function moveSlot(slots: readonly Slot[], id: number, direction: -1 | 1): Slot[] {
  const sorted = sortSlots(slots);
  const index = sorted.findIndex((s) => s.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= sorted.length) return [];
  [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
  return sorted.flatMap((s, order) => (s.order === order ? [] : [{ ...s, order }]));
}

export function nextOrder(slots: readonly Slot[]): number {
  return slots.reduce((max, s) => Math.max(max, s.order), -1) + 1;
}

/**
 * Index (in `sorted`) of the first slot whose time is at or after `nowMinutes`,
 * or -1 when every slot for today has passed.
 */
export function upcomingSlotIndex(sorted: readonly Slot[], nowMinutes: number): number {
  return sorted.findIndex((s) => timeToMinutes(s.time) >= nowMinutes);
}
