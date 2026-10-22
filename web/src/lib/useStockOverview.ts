import { db } from '../db/database';
import { getSettings, listEventsForDate } from '../db/doseRepository';
import { listMedicines } from '../db/medicineRepository';
import { listSlots } from '../db/slotRepository';
import type { ISODate } from '../db/types';
import { logicalDate } from '../domain/dates';
import {
  DEFAULT_LOW_STOCK_DAYS,
  forecastPackets,
  forecastStock,
  stockWarnings,
  type PacketForecast,
  type StockForecast,
  type StockWarning,
} from '../domain/stock';
import { useLiveQuery } from './useLiveQuery';

export interface StockOverview {
  today: ISODate;
  lowStockDays: number;
  forecasts: Map<number, StockForecast>;
  packets: PacketForecast[];
  warnings: StockWarning[];
}

/** Stock and packet forecasts for every tracked medicine, as of the current logical day. */
export function useStockOverview(now: Date): StockOverview | undefined {
  return useLiveQuery(async () => {
    const settings = await getSettings(db);
    const today = logicalDate(now, settings.lateNightCutoff);
    const [medicines, schedules, slots, events] = await Promise.all([
      listMedicines(db),
      db.schedules.toArray(),
      listSlots(db),
      listEventsForDate(db, today),
    ]);
    const scheduled = events.filter((e) => e.kind === 'SCHEDULED');
    const recorded = new Set(scheduled.flatMap((e) => (e.scheduleId !== undefined ? [e.scheduleId] : [])));
    const forecasts = new Map<number, StockForecast>();
    for (const m of medicines) {
      if (m.trackStock) forecasts.set(m.id!, forecastStock(m, schedules, today, recorded));
    }
    const packets = slots.flatMap((slot) => {
      const takenToday = scheduled.some((e) => e.slotId === slot.id && e.status === 'TAKEN');
      const f = forecastPackets(slot, medicines, schedules, today, takenToday);
      return f ? [f] : [];
    });
    const lowStockDays = settings.lowStockDays ?? DEFAULT_LOW_STOCK_DAYS;
    return {
      today,
      lowStockDays,
      forecasts,
      packets,
      warnings: stockWarnings(medicines, forecasts, packets, today, lowStockDays),
    };
    // Recompute when the logical day changes; data changes are picked up by liveQuery.
  }, [logicalDate(now, '00:00'), now.getHours()]);
}
