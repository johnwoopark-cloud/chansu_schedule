import { describe, expect, it } from 'vitest';
import type { Slot } from '../src/db/types';
import {
  isValidTime,
  moveSlot,
  nextOrder,
  sortSlots,
  timeToMinutes,
  upcomingSlotIndex,
  validateSlot,
} from '../src/domain/slots';

const slots: Slot[] = [
  { id: 1, label: '아침', time: '08:00', order: 0 },
  { id: 2, label: '점심', time: '12:30', order: 1 },
  { id: 3, label: '저녁', time: '18:30', order: 2 },
];

describe('time helpers', () => {
  it('accepts only HH:MM 24-hour times', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('8:00')).toBe(false);
    expect(isValidTime('08:60')).toBe(false);
  });

  it('converts to minutes since midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('18:30')).toBe(1110);
    expect(() => timeToMinutes('nope')).toThrow();
  });
});

describe('sortSlots', () => {
  it('orders by order, then by time', () => {
    const shuffled: Slot[] = [
      { id: 9, label: 'b', time: '10:00', order: 1 },
      { id: 8, label: 'a', time: '09:00', order: 1 },
      { id: 7, label: 'c', time: '23:00', order: 0 },
    ];
    expect(sortSlots(shuffled).map((s) => s.id)).toEqual([7, 8, 9]);
  });
});

describe('validateSlot', () => {
  it('rejects empty, too long, duplicate labels and bad times', () => {
    expect(validateSlot({ label: '  ', time: '09:00' }, slots)).toBe('label-empty');
    expect(validateSlot({ label: 'x'.repeat(21), time: '09:00' }, slots)).toBe('label-too-long');
    expect(validateSlot({ label: ' 아침 ', time: '09:00' }, slots)).toBe('label-duplicate');
    expect(validateSlot({ label: '간식', time: '9:00' }, slots)).toBe('time-invalid');
  });

  it('accepts a valid new slot', () => {
    expect(validateSlot({ label: '간식', time: '15:00' }, slots)).toBeNull();
  });
});

describe('moveSlot', () => {
  it('swaps with the neighbour and returns only changed rows', () => {
    const changed = moveSlot(slots, 2, -1);
    expect(changed).toEqual([
      { id: 2, label: '점심', time: '12:30', order: 0 },
      { id: 1, label: '아침', time: '08:00', order: 1 },
    ]);
  });

  it('does nothing at the edges or for unknown ids', () => {
    expect(moveSlot(slots, 1, -1)).toEqual([]);
    expect(moveSlot(slots, 3, 1)).toEqual([]);
    expect(moveSlot(slots, 42, 1)).toEqual([]);
  });

  it('renumbers gaps left by deleted slots', () => {
    const gappy: Slot[] = [
      { id: 1, label: 'a', time: '08:00', order: 0 },
      { id: 3, label: 'c', time: '18:00', order: 5 },
    ];
    expect(moveSlot(gappy, 3, -1)).toEqual([
      { id: 3, label: 'c', time: '18:00', order: 0 },
      { id: 1, label: 'a', time: '08:00', order: 1 },
    ]);
  });
});

describe('nextOrder / upcomingSlotIndex', () => {
  it('appends after the largest order', () => {
    expect(nextOrder(slots)).toBe(3);
    expect(nextOrder([])).toBe(0);
  });

  it('finds the next slot at or after now', () => {
    expect(upcomingSlotIndex(slots, 0)).toBe(0);
    expect(upcomingSlotIndex(slots, 8 * 60)).toBe(0);
    expect(upcomingSlotIndex(slots, 8 * 60 + 1)).toBe(1);
    expect(upcomingSlotIndex(slots, 23 * 60)).toBe(-1);
  });
});
