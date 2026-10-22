import { describe, expect, it } from 'vitest';
import {
  formatStrength,
  isExpired,
  isLowStock,
  medicineTitle,
  newMedicine,
  parseNumber,
  parseNumberList,
  validateMedicine,
} from '../src/domain/medicine';
import { fromDraft, toDraft } from '../src/domain/medicineDraft';

describe('number parsing', () => {
  it('accepts dot or comma decimals and rejects junk', () => {
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber(' 2.5 ')).toBe(2.5);
    expect(parseNumber('2,5')).toBe(2.5);
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('-1')).toBeNaN();
  });

  it('parses lists of positive numbers', () => {
    expect(parseNumberList('30, 60 90')).toEqual([30, 60, 90]);
    expect(parseNumberList('')).toEqual([]);
    expect(parseNumberList('30, 0')).toBeNull();
    expect(parseNumberList('30, x')).toBeNull();
  });
});

describe('validateMedicine', () => {
  const valid = { ...newMedicine(0), name: '타이레놀' };

  it('accepts a minimal medicine', () => {
    expect(validateMedicine(valid)).toEqual({});
  });

  it('flags missing name, unit-less strength, bad numbers and dates', () => {
    expect(validateMedicine({ ...valid, name: ' ' }).name).toBeDefined();
    expect(validateMedicine({ ...valid, strength: 500 }).strength).toBeDefined();
    expect(validateMedicine({ ...valid, strength: 500, strengthUnit: 'mg' }).strength).toBeUndefined();
    expect(validateMedicine({ ...valid, stockAmount: NaN }).stockAmount).toBeDefined();
    expect(
      validateMedicine({ ...valid, productionDate: '2026-05-01', expirationDate: '2026-04-01' }).expirationDate,
    ).toBeDefined();
  });
});

describe('display helpers', () => {
  it('formats titles and flags', () => {
    expect(formatStrength({ strength: 2.5, strengthUnit: 'mg' })).toBe('2.5mg');
    expect(medicineTitle({ name: '아스피린', strength: 100, strengthUnit: 'mg' })).toBe('아스피린 100mg');
    expect(medicineTitle({ name: '비타민' })).toBe('비타민');
    expect(isExpired({ expirationDate: '2026-10-21' }, '2026-10-22')).toBe(true);
    expect(isExpired({ expirationDate: '2026-10-22' }, '2026-10-22')).toBe(false);
    expect(isLowStock({ trackStock: true, stockAmount: 5, stockThreshold: 5 })).toBe(true);
    expect(isLowStock({ trackStock: false, stockAmount: 5, stockThreshold: 5 })).toBe(false);
    expect(isLowStock({ trackStock: true, stockAmount: 0, stockThreshold: 0 })).toBe(false);
  });
});

describe('medicine draft', () => {
  it('round-trips a full medicine', () => {
    const full = {
      ...newMedicine(3),
      id: 7,
      name: '메트포르민',
      strength: 500,
      strengthUnit: 'mg',
      stockAmount: 42,
      stockThreshold: 10,
      refillSizes: [30, 90],
      productionDate: '2026-01-01',
      expirationDate: '2027-01-01',
      halfLifeHours: 6.2,
      timeToPeakHours: 2.5,
      tagIds: [1, 2],
    };
    const { medicine, errors } = fromDraft(toDraft(full));
    expect(errors).toEqual({});
    expect(medicine).toEqual(full);
  });

  it('drops empty optional fields and reports bad refill sizes', () => {
    const draft = { ...toDraft({ ...newMedicine(0), name: '약' }), strength: '', refillSizes: '30, -' };
    const { medicine, errors } = fromDraft(draft);
    expect(medicine.strength).toBeUndefined();
    expect(medicine.strengthUnit).toBeUndefined();
    expect(medicine.expirationDate).toBeUndefined();
    expect(errors.refillSizes).toBeDefined();
  });
});
