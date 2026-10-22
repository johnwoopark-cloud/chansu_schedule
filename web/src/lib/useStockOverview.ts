import { db } from '../db/database';
import { loadDayContext, loadOccurrences } from '../db/dayContext';
import type { ISODate } from '../db/types';
import { logicalDate } from '../domain/dates';
import { buildDayPlan } from '../domain/dayPlan';
import { buildDayView } from '../domain/dayView';
import {
  DEFAULT_LOW_STOCK_DAYS,
  forecastPackets,
  forecastStock,
  remainingUsageToday,
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
    const ctx = await loadDayContext(db, now);
    const { today, medicines, schedules, slots, settings } = ctx;
    const { events, occurrences } = await loadOccurrences(db, ctx, today);
    const view = buildDayView(buildDayPlan(occurrences, slots), events, { kind: 'future' });
    const remaining = remainingUsageToday(view.groups.flatMap((g) => g.rows));

    const forecasts = new Map<number, StockForecast>();
    for (const m of medicines) {
      if (m.trackStock) forecasts.set(m.id!, forecastStock(m, schedules, today, remaining.get(m.id!) ?? 0));
    }
    const packets = slots.flatMap((slot) => {
      const takenToday = events.some((e) => e.kind === 'SCHEDULED' && e.slotId === slot.id && e.status === 'TAKEN');
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
