import type { Medicine } from '../db/types';
import { formatKoreanDate } from '../domain/dates';
import { formatNumber } from '../domain/medicine';
import type { StockForecast } from '../domain/stock';

export function formatStock(m: Pick<Medicine, 'stockAmount' | 'stockUnit'>): string {
  return `${formatNumber(Math.max(0, m.stockAmount))}${m.stockUnit}`;
}

/** "12일분 · 11월 3일 (화)까지" / "일정 없음" / "1년 이상". */
export function forecastText(f: StockForecast | undefined): string {
  if (!f) return '';
  if (f.noUsage) return '복용 일정 없음';
  if (!f.runOutDate) return '1년 이상';
  if (f.daysCovered === 0) return '오늘 먹을 양이 부족합니다';
  return `${f.daysCovered}일분 · ${formatKoreanDate(f.runOutDate)}에 소진`;
}
