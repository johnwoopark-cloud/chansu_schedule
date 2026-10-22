import type { DoseEvent, ISODate, Medicine, Schedule, Slot } from '../db/types';
import { addDays, daysBetween } from './dates';
import { occursOn } from './schedule';
import { plannedCount, type Occurrence } from './occurrences';

export const DEFAULT_LOW_STOCK_DAYS = 7;
const HORIZON_DAYS = 366;

export function unitsMatch(doseUnit: string, stockUnit: string): boolean {
  return !stockUnit.trim() || doseUnit.trim() === stockUnit.trim();
}

/** How much a dose record should take out of its medicine's stock right now. */
export function stockDeduction(event: Pick<DoseEvent, 'kind' | 'status' | 'snapshot'>, medicine: Medicine | undefined): number {
  if (!medicine?.trackStock) return 0;
  if (event.status !== 'TAKEN' || (event.kind !== 'SCHEDULED' && event.kind !== 'EXTRA')) return 0;
  if (!unitsMatch(event.snapshot.doseUnit, medicine.stockUnit)) return 0;
  return event.snapshot.doseQty;
}

/** Planned stock usage of a medicine on one day, in its stock unit. */
export function plannedUsageOn(medicine: Medicine, schedules: readonly Schedule[], date: ISODate): number {
  const byId = new Map(schedules.map((s) => [s.id!, s]));
  return schedules
    .filter((s) => s.medicineId === medicine.id && unitsMatch(s.doseUnit, medicine.stockUnit))
    .reduce((sum, s) => sum + s.doseQty * plannedCount(s, date, byId), 0);
}

/** Average daily usage over the next week; used to suggest prescription quantities. */
export function averageDailyUsage(medicine: Medicine, schedules: readonly Schedule[], from: ISODate): number {
  let total = 0;
  for (let i = 0; i < 7; i++) total += plannedUsageOn(medicine, schedules, addDays(from, i));
  return total / 7;
}

export interface StockForecast {
  /** Whole days from today the stock still covers (today counts as day 1 if its remaining doses are covered). */
  daysCovered: number;
  /** First day whose planned doses can't be fully taken, or null if beyond the horizon / no usage. */
  runOutDate: ISODate | null;
  /** True when nothing is scheduled, so the stock never runs out on its own. */
  noUsage: boolean;
}

/**
 * Simulates planned usage forward from `today`. Doses already taken today have
 * been deducted from stock, so today only counts `todayRemaining` (the usage of
 * today's still-unchecked doses).
 */
export function forecastStock(
  medicine: Medicine,
  schedules: readonly Schedule[],
  today: ISODate,
  todayRemaining: number,
): StockForecast {
  let stock = medicine.stockAmount;
  let anyUsage = false;
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const date = addDays(today, i);
    const usage = i === 0 ? todayRemaining : plannedUsageOn(medicine, schedules, date);
    if (usage > 0) anyUsage = true;
    if (usage > stock + 1e-9) return { daysCovered: i, runOutDate: date, noUsage: false };
    stock -= usage;
  }
  return { daysCovered: HORIZON_DAYS, runOutDate: null, noUsage: !anyUsage };
}

/** Stock usage of today's unchecked doses for each medicine (waiting linked doses included). */
export function remainingUsageToday(rows: readonly { occurrence: Occurrence; state: string }[]): Map<number, number> {
  const usage = new Map<number, number>();
  for (const { occurrence: o, state } of rows) {
    if (state !== 'pending' && state !== 'waiting') continue;
    if (!unitsMatch(o.schedule.doseUnit, o.medicine.stockUnit)) continue;
    usage.set(o.medicine.id!, (usage.get(o.medicine.id!) ?? 0) + o.schedule.doseQty);
  }
  return usage;
}

export interface PacketForecast {
  slot: Slot;
  packets: number;
  daysCovered: number;
  runOutDate: ISODate | null;
}

/** Packets are one per slot per day on which the slot has any dose. */
export function forecastPackets(
  slot: Slot,
  medicines: readonly Medicine[],
  schedules: readonly Schedule[],
  today: ISODate,
  slotTakenToday: boolean,
): PacketForecast | null {
  if (slot.packetStock === undefined) return null;
  const active = new Set(medicines.filter((m) => m.active).map((m) => m.id));
  const used = schedules.filter((s) => s.slotId === slot.id && s.active && s.type === 'TIME' && active.has(s.medicineId));
  let packets = slot.packetStock;
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const date = addDays(today, i);
    if (i === 0 && slotTakenToday) continue;
    if (!used.some((s) => occursOn(s, date))) continue;
    if (packets < 1) return { slot, packets: slot.packetStock, daysCovered: i, runOutDate: date };
    packets -= 1;
  }
  return { slot, packets: slot.packetStock, daysCovered: HORIZON_DAYS, runOutDate: null };
}

export type StockWarning =
  | { kind: 'low-stock'; medicine: Medicine; forecast: StockForecast }
  | { kind: 'below-threshold'; medicine: Medicine }
  | { kind: 'expired'; medicine: Medicine }
  | { kind: 'expiring'; medicine: Medicine; days: number }
  | { kind: 'packets'; forecast: PacketForecast };

export const EXPIRY_WARN_DAYS = 30;

/** Warnings for the Today page banner, most urgent first. */
export function stockWarnings(
  medicines: readonly Medicine[],
  forecasts: ReadonlyMap<number, StockForecast>,
  packets: readonly PacketForecast[],
  today: ISODate,
  lowStockDays: number,
): StockWarning[] {
  const warnings: StockWarning[] = [];
  for (const m of medicines) {
    if (!m.active) continue;
    if (m.expirationDate && m.expirationDate < today) warnings.push({ kind: 'expired', medicine: m });
    else if (m.expirationDate && m.expirationDate <= addDays(today, EXPIRY_WARN_DAYS)) {
      warnings.push({ kind: 'expiring', medicine: m, days: daysBetween(today, m.expirationDate) });
    }
    if (!m.trackStock) continue;
    const f = forecasts.get(m.id!);
    if (f && !f.noUsage && f.daysCovered <= lowStockDays) warnings.push({ kind: 'low-stock', medicine: m, forecast: f });
    else if (m.stockThreshold > 0 && m.stockAmount <= m.stockThreshold) warnings.push({ kind: 'below-threshold', medicine: m });
  }
  for (const p of packets) if (p.runOutDate && p.daysCovered <= lowStockDays) warnings.push({ kind: 'packets', forecast: p });
  const rank = { expired: 0, 'low-stock': 1, packets: 2, 'below-threshold': 3, expiring: 4 } as const;
  return warnings.sort((a, b) => rank[a.kind] - rank[b.kind]);
}
