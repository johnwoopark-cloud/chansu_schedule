import { describe, expect, it } from 'vitest';
import { formatKoreanDate, formatKoreanTime, parseISODate, toISODate } from '../src/domain/dates';

describe('dates', () => {
  it('round-trips local dates', () => {
    const d = new Date(2026, 0, 5, 23, 59);
    expect(toISODate(d)).toBe('2026-01-05');
    expect(toISODate(parseISODate('2026-12-31'))).toBe('2026-12-31');
  });

  it('formats in Korean', () => {
    expect(formatKoreanDate('2026-10-22')).toBe('10월 22일 (목)');
    expect(formatKoreanTime('00:05')).toBe('오전 12:05');
    expect(formatKoreanTime('08:00')).toBe('오전 8:00');
    expect(formatKoreanTime('12:30')).toBe('오후 12:30');
    expect(formatKoreanTime('22:00')).toBe('오후 10:00');
  });
});
