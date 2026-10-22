import { db } from '../db/database';
import { listMedicines } from '../db/medicineRepository';
import { listPrescriptions } from '../db/prescriptionRepository';
import { formatKoreanDate } from '../domain/dates';
import { formatNumber } from '../domain/medicine';
import { useLiveQuery } from '../lib/useLiveQuery';
import { useNow } from '../lib/useNow';
import { useStockOverview } from '../lib/useStockOverview';
import { PageHeader } from '../components/PageHeader';
import { Icon } from '../components/Icon';
import { href } from '../router';

export function PrescriptionsPage() {
  const now = useNow();
  const stock = useStockOverview(now);
  const data = useLiveQuery(async () => {
    const [prescriptions, medicines, slots] = await Promise.all([
      listPrescriptions(db),
      listMedicines(db),
      db.slots.toArray(),
    ]);
    return {
      prescriptions,
      medicines: new Map(medicines.map((m) => [m.id!, m])),
      slots: new Map(slots.map((s) => [s.id!, s])),
    };
  });
  if (!data) return null;

  return (
    <>
      <PageHeader title="조제">
        <a class="button primary small" href={href({ page: 'prescription', id: 'new' })}>
          <Icon name="plus" size={18} /> 기록 추가
        </a>
      </PageHeader>
      <p class="muted page-intro">약국에서 약을 받아 온 기록입니다. 저장하면 받은 양이 재고에 더해집니다.</p>

      {stock && stock.packets.length > 0 && (
        <section class="card">
          <h2>약봉투 재고</h2>
          <ul class="packet-list">
            {stock.packets.map((p) => (
              <li key={p.slot.id} class={p.runOutDate && p.daysCovered <= stock.lowStockDays ? 'low' : undefined}>
                <span class="packet-slot">{p.slot.label}</span>
                <span class="packet-count">{p.packets}봉</span>
                <span class="packet-days">{p.runOutDate ? `${p.daysCovered}일분` : '일정 없음'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.prescriptions.length === 0 && (
        <section class="empty-state">
          <p>아직 조제 기록이 없습니다.</p>
          <a class="button primary" href={href({ page: 'prescription', id: 'new' })}>
            <Icon name="plus" size={20} /> 받아 온 약 기록하기
          </a>
        </section>
      )}

      <ul class="prescription-list">
        {data.prescriptions.map((p) => {
          const place = [p.hospital, p.pharmacy].filter(Boolean).join(' · ');
          return (
            <li key={p.id}>
              <a href={href({ page: 'prescription', id: p.id! })}>
                <div class="prescription-head">
                  <span class="prescription-date">{formatKoreanDate(p.receivedDate)}</span>
                  {p.days && <span class="badge">{p.days}일분</span>}
                </div>
                {place && <span class="muted">{place}</span>}
                <span class="prescription-items">
                  {p.items
                    .map((i) => {
                      const m = data.medicines.get(i.medicineId);
                      return `${m?.name ?? '(삭제된 약)'} ${formatNumber(i.quantity)}${m?.stockUnit ?? ''}`;
                    })
                    .concat(p.packets.map((x) => `${data.slots.get(x.slotId)?.label ?? '(삭제된 시기)'} ${x.count}봉`))
                    .join(', ')}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
