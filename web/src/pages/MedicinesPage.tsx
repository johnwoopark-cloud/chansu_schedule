import { useState } from 'preact/hooks';
import { db } from '../db/database';
import { listMedicines, listTags } from '../db/medicineRepository';
import { listSlots } from '../db/slotRepository';
import type { Medicine, Schedule } from '../db/types';
import { isExpired, isLowStock, medicineTitle } from '../domain/medicine';
import { toISODate } from '../domain/dates';
import { useLiveQuery } from '../lib/useLiveQuery';
import { PageHeader } from '../components/PageHeader';
import { MedicineIcon } from '../components/MedicineIcon';
import { Icon } from '../components/Icon';
import { Chip, Segmented } from '../components/Form';
import { href } from '../router';
import { useNow } from '../lib/useNow';
import { useStockOverview } from '../lib/useStockOverview';
import { formatStock } from '../components/StockText';

type Filter = 'active' | 'stopped';

function scheduleSummary(schedules: Schedule[]): { text: string; paused: boolean } {
  if (schedules.length === 0) return { text: '일정 없음', paused: false };
  const active = schedules.filter((s) => s.active).length;
  if (active === 0) return { text: '모든 일정 일시정지', paused: true };
  return { text: `일정 ${active}개${active < schedules.length ? ` (일시정지 ${schedules.length - active}개)` : ''}`, paused: false };
}

export function MedicinesPage() {
  const [filter, setFilter] = useState<Filter>('active');
  const [tagId, setTagId] = useState<number | null>(null);
  const data = useLiveQuery(async () => {
    const [medicines, schedules, tags, slots] = await Promise.all([
      listMedicines(db),
      db.schedules.toArray(),
      listTags(db),
      listSlots(db),
    ]);
    return { medicines, schedules, tags, slots };
  });
  const now = useNow();
  const stock = useStockOverview(now);
  const today = toISODate(now);

  const medicines = data?.medicines ?? [];
  const counts = {
    active: medicines.filter((m) => m.active).length,
    stopped: medicines.filter((m) => !m.active).length,
  };
  const visible = medicines.filter(
    (m) => m.active === (filter === 'active') && (tagId === null || m.tagIds.includes(tagId)),
  );
  const schedulesOf = (m: Medicine) => data?.schedules.filter((s) => s.medicineId === m.id) ?? [];
  const tagName = new Map(data?.tags.map((t) => [t.id!, t.name]));

  return (
    <>
      <PageHeader title="약">
        <a class="button primary small" href={href({ page: 'medicine', id: 'new' })}>
          <Icon name="plus" size={18} /> 약 추가
        </a>
      </PageHeader>

      {data && medicines.length > 0 && (
        <div class="list-controls">
          <Segmented
            ariaLabel="목록"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: `복용 중 ${counts.active}` },
              { value: 'stopped', label: `중단 ${counts.stopped}` },
            ]}
          />
          {data.tags.length > 0 && (
            <div class="chips" aria-label="태그 필터">
              <Chip selected={tagId === null} onClick={() => setTagId(null)}>
                전체
              </Chip>
              {data.tags.map((t) => (
                <Chip key={t.id} selected={tagId === t.id} onClick={() => setTagId(tagId === t.id ? null : t.id!)}>
                  {t.name}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      {data && medicines.length === 0 && (
        <section class="empty-state">
          <p>등록한 약이 없습니다.</p>
          <a class="button primary" href={href({ page: 'medicine', id: 'new' })}>
            <Icon name="plus" size={20} /> 첫 약 등록하기
          </a>
        </section>
      )}

      {data && medicines.length > 0 && visible.length === 0 && (
        <p class="empty-hint">{filter === 'active' ? '복용 중인 약이 없습니다.' : '중단한 약이 없습니다.'}</p>
      )}

      <ul class="medicine-list">
        {visible.map((m) => {
          const summary = scheduleSummary(schedulesOf(m));
          const forecast = stock?.forecasts.get(m.id!);
          const lowDays = !!forecast && !forecast.noUsage && forecast.daysCovered <= (stock?.lowStockDays ?? 0);
          return (
            <li key={m.id}>
              <a href={href({ page: 'medicine', id: m.id! })}>
                <MedicineIcon medicine={m} />
                <div class="medicine-list-body">
                  <span class="medicine-list-title">{medicineTitle(m)}</span>
                  <span class={`medicine-list-sub${summary.paused ? ' paused' : ''}`}>
                    {summary.text}
                    {m.trackStock && ` · 재고 ${formatStock(m)}`}
                    {forecast && !forecast.noUsage && forecast.runOutDate && ` · ${forecast.daysCovered}일분`}
                  </span>
                  <span class="medicine-list-badges">
                    {(isLowStock(m) || lowDays) && <span class="badge warn">재고 부족</span>}
                    {isExpired(m, today) && <span class="badge warn">유효기간 지남</span>}
                    {m.tagIds.map((id) => tagName.get(id) && <span key={id} class="badge muted">{tagName.get(id)}</span>)}
                  </span>
                </div>
                <Icon name="chevron" size={20} />
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
