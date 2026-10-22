import type { Medicine } from '../db/types';
import { formatNumber, parseNumber, parseNumberList, validateMedicine, type MedicineErrors } from './medicine';

/** Form state for the medicine editor: numbers stay as typed text until saved. */
export interface MedicineDraft {
  id?: number;
  name: string;
  strength: string;
  strengthUnit: string;
  notes: string;
  icon: string;
  color: string;
  useColor: boolean;
  stockAmount: string;
  stockUnit: string;
  stockThreshold: string;
  refillSizes: string;
  productionDate: string;
  expirationDate: string;
  halfLifeHours: string;
  timeToPeakHours: string;
  cannotBeSkipped: boolean;
  tagIds: number[];
  active: boolean;
  sortOrder: number;
}

const num = (v: number | undefined) => (v === undefined ? '' : formatNumber(v));

export function toDraft(m: Omit<Medicine, 'id'> & { id?: number }): MedicineDraft {
  return {
    id: m.id,
    name: m.name,
    strength: num(m.strength),
    strengthUnit: m.strengthUnit ?? 'mg',
    notes: m.notes,
    icon: m.icon,
    color: m.color,
    useColor: m.useColor,
    stockAmount: m.stockAmount ? num(m.stockAmount) : '',
    stockUnit: m.stockUnit,
    stockThreshold: m.stockThreshold ? num(m.stockThreshold) : '',
    refillSizes: m.refillSizes.map(formatNumber).join(', '),
    productionDate: m.productionDate ?? '',
    expirationDate: m.expirationDate ?? '',
    halfLifeHours: num(m.halfLifeHours),
    timeToPeakHours: num(m.timeToPeakHours),
    cannotBeSkipped: m.cannotBeSkipped,
    tagIds: [...m.tagIds],
    active: m.active,
    sortOrder: m.sortOrder,
  };
}

export function fromDraft(d: MedicineDraft): { medicine: Omit<Medicine, 'id'> & { id?: number }; errors: MedicineErrors } {
  const strength = parseNumber(d.strength);
  const refillSizes = parseNumberList(d.refillSizes);
  const medicine: Omit<Medicine, 'id'> & { id?: number } = {
    ...(d.id !== undefined ? { id: d.id } : {}),
    name: d.name,
    notes: d.notes,
    icon: d.icon,
    color: d.color,
    useColor: d.useColor,
    sortOrder: d.sortOrder,
    active: d.active,
    stockAmount: parseNumber(d.stockAmount) ?? 0,
    stockUnit: d.stockUnit.trim(),
    refillSizes: refillSizes ?? [],
    stockThreshold: parseNumber(d.stockThreshold) ?? 0,
    cannotBeSkipped: d.cannotBeSkipped,
    tagIds: d.tagIds,
  };
  if (strength !== undefined) {
    medicine.strength = strength;
    medicine.strengthUnit = d.strengthUnit.trim() || undefined;
  }
  if (d.productionDate) medicine.productionDate = d.productionDate;
  if (d.expirationDate) medicine.expirationDate = d.expirationDate;
  const halfLife = parseNumber(d.halfLifeHours);
  if (halfLife !== undefined) medicine.halfLifeHours = halfLife;
  const peak = parseNumber(d.timeToPeakHours);
  if (peak !== undefined) medicine.timeToPeakHours = peak;

  const errors = validateMedicine(medicine);
  if (refillSizes === null) errors.refillSizes = '0보다 큰 숫자를 쉼표로 구분해 입력하세요.';
  return { medicine, errors };
}
