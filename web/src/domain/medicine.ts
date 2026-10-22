import type { Medicine } from '../db/types';

export const STRENGTH_UNITS = ['mg', 'mcg', 'g', 'mL', 'mg/mL', 'IU', '%'] as const;
export const DOSE_UNITS = ['정', '캡슐', '포', 'mL', '방울', '회', '개'] as const;
export const STOCK_UNITS = ['정', '캡슐', '포', 'mL', '개'] as const;

export const MEDICINE_ICONS = ['tablet', 'capsule', 'liquid', 'drop', 'sachet', 'injection'] as const;
export type MedicineIcon = (typeof MEDICINE_ICONS)[number];

export const MEDICINE_ICON_LABELS: Record<MedicineIcon, string> = {
  tablet: '알약',
  capsule: '캡슐',
  liquid: '물약',
  drop: '안약·점적',
  sachet: '가루약·포',
  injection: '주사',
};

export const MEDICINE_COLORS = [
  '#d64545',
  '#e07b39',
  '#d9a400',
  '#3f9b5a',
  '#2f86b8',
  '#5b5fc7',
  '#a24bb0',
  '#7a7f87',
] as const;

export const MAX_NAME_LENGTH = 50;

export function newMedicine(sortOrder: number): Omit<Medicine, 'id'> {
  return {
    name: '',
    notes: '',
    color: MEDICINE_COLORS[4],
    useColor: false,
    icon: 'tablet',
    sortOrder,
    active: true,
    stockAmount: 0,
    stockUnit: '정',
    refillSizes: [],
    stockThreshold: 0,
    cannotBeSkipped: false,
    tagIds: [],
  };
}

/** Parses a user-typed number ("1,5" or "1.5"). Empty → undefined, garbage → NaN. */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return undefined;
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : NaN;
}

/** Parses "30, 60 90" into [30, 60, 90]. Returns null if any entry is not a positive number. */
export function parseNumberList(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const values = parts.map((p) => parseNumber(p));
  if (values.some((v) => v === undefined || Number.isNaN(v) || v <= 0)) return null;
  return values as number[];
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

/** "10mg", "2.5 mL" style; empty when no strength. */
export function formatStrength(m: Pick<Medicine, 'strength' | 'strengthUnit'>): string {
  if (m.strength === undefined) return '';
  return `${formatNumber(m.strength)}${m.strengthUnit ?? ''}`;
}

export function formatDose(qty: number, unit: string): string {
  return `${formatNumber(qty)}${unit}`;
}

export type MedicineField =
  | 'name'
  | 'strength'
  | 'stockAmount'
  | 'stockThreshold'
  | 'refillSizes'
  | 'expirationDate'
  | 'halfLifeHours'
  | 'timeToPeakHours';

export type MedicineErrors = Partial<Record<MedicineField, string>>;

export function validateMedicine(m: Omit<Medicine, 'id'>): MedicineErrors {
  const errors: MedicineErrors = {};
  const name = m.name.trim();
  if (!name) errors.name = '약 이름을 입력하세요.';
  else if (name.length > MAX_NAME_LENGTH) errors.name = `${MAX_NAME_LENGTH}자 이내로 입력하세요.`;

  const badNumber = (v: number | undefined) => v !== undefined && (Number.isNaN(v) || v < 0);
  if (badNumber(m.strength)) errors.strength = '0 이상의 숫자를 입력하세요.';
  else if (m.strength !== undefined && !m.strengthUnit) errors.strength = '함량 단위를 고르세요.';
  if (badNumber(m.stockAmount)) errors.stockAmount = '0 이상의 숫자를 입력하세요.';
  if (badNumber(m.stockThreshold)) errors.stockThreshold = '0 이상의 숫자를 입력하세요.';
  if (badNumber(m.halfLifeHours)) errors.halfLifeHours = '0 이상의 숫자를 입력하세요.';
  if (badNumber(m.timeToPeakHours)) errors.timeToPeakHours = '0 이상의 숫자를 입력하세요.';
  if (m.productionDate && m.expirationDate && m.expirationDate < m.productionDate) {
    errors.expirationDate = '유효기간이 제조일보다 빠릅니다.';
  }
  return errors;
}

/** Medicine as shown in lists: "타이레놀 500mg". */
export function medicineTitle(m: Pick<Medicine, 'name' | 'strength' | 'strengthUnit'>): string {
  const strength = formatStrength(m);
  return strength ? `${m.name} ${strength}` : m.name;
}

export function isExpired(m: Pick<Medicine, 'expirationDate'>, today: string): boolean {
  return !!m.expirationDate && m.expirationDate < today;
}

export function isLowStock(m: Pick<Medicine, 'stockAmount' | 'stockThreshold'>): boolean {
  return m.stockThreshold > 0 && m.stockAmount <= m.stockThreshold;
}
