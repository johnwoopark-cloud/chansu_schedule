import { useState } from 'preact/hooks';
import { formatKoreanDate } from '../domain/dates';
import { formatNumber } from '../domain/medicine';
import type { StockWarning } from '../domain/stock';
import { href, type Route } from '../router';
import { Icon } from './Icon';
import { formatStock } from './StockText';

function describe(w: StockWarning): { text: string; route: Route; urgent: boolean } {
  switch (w.kind) {
    case 'expired':
      return { text: `${w.medicine.name} 유효기간이 지났습니다.`, route: { page: 'medicine', id: w.medicine.id! }, urgent: true };
    case 'expiring':
      return {
        text: `${w.medicine.name} 유효기간이 ${w.days}일 남았습니다.`,
        route: { page: 'medicine', id: w.medicine.id! },
        urgent: false,
      };
    case 'low-stock':
      return {
        text:
          w.forecast.daysCovered === 0
            ? `${w.medicine.name} 남은 약이 오늘 먹을 양보다 적습니다.`
            : `${w.medicine.name} ${w.forecast.daysCovered}일분 남음 · ${formatKoreanDate(w.forecast.runOutDate!)}에 소진`,
        route: { page: 'medicine', id: w.medicine.id! },
        urgent: w.forecast.daysCovered <= 2,
      };
    case 'below-threshold':
      return {
        text: `${w.medicine.name} 재고 ${formatStock(w.medicine)} (경고 기준 ${formatNumber(w.medicine.stockThreshold)} 이하)`,
        route: { page: 'medicine', id: w.medicine.id! },
        urgent: false,
      };
    case 'packets':
      return {
        text: `${w.forecast.slot.label} 약봉투 ${w.forecast.packets}개 남음 · ${w.forecast.daysCovered}일분`,
        route: { page: 'prescriptions' },
        urgent: w.forecast.daysCovered <= 2,
      };
  }
}

const COLLAPSED = 3;

export function StockWarnings({ warnings }: { warnings: readonly StockWarning[] }) {
  const [expanded, setExpanded] = useState(false);
  if (warnings.length === 0) return null;
  const shown = expanded ? warnings : warnings.slice(0, COLLAPSED);
  return (
    <section class="warnings" aria-label="재고·유효기간 경고">
      <ul>
        {shown.map((w, i) => {
          const d = describe(w);
          return (
            <li key={i} class={d.urgent ? 'urgent' : undefined}>
              <a href={href(d.route)}>
                <Icon name="alert" size={18} />
                <span>{d.text}</span>
                <Icon name="chevron" size={16} />
              </a>
            </li>
          );
        })}
      </ul>
      {warnings.length > COLLAPSED && (
        <button type="button" class="warnings-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? '접기' : `외 ${warnings.length - COLLAPSED}건 더 보기`}
        </button>
      )}
    </section>
  );
}
