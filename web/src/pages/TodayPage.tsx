import { useEffect, useState } from 'preact/hooks';
import { db } from '../db/database';
import { listMedicines } from '../db/medicineRepository';
import { listSlots } from '../db/slotRepository';
import { formatKoreanDate, formatKoreanTime, toISODate } from '../domain/dates';
import { buildDayPlan } from '../domain/dayPlan';
import { formatDose, medicineTitle } from '../domain/medicine';
import { timeToMinutes } from '../domain/slots';
import { useLiveQuery } from '../lib/useLiveQuery';
import { StorageNotice } from '../components/StorageNotice';
import { MedicineIcon } from '../components/MedicineIcon';
import { Icon } from '../components/Icon';
import { href } from '../router';

function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function TodayPage() {
  const now = useNow();
  const today = toISODate(now);
  const data = useLiveQuery(async () => {
    const [slots, medicines, schedules] = await Promise.all([listSlots(db), listMedicines(db), db.schedules.toArray()]);
    return { slots, medicines, schedules };
  });

  const plan = data ? buildDayPlan(today, data.slots, data.medicines, data.schedules).filter((g) => g.doses.length > 0) : [];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const upcoming = plan.findIndex((g) => timeToMinutes(g.time) >= nowMinutes);
  const unscheduled = data
    ? data.medicines.filter((m) => m.active && !data.schedules.some((s) => s.medicineId === m.id)).length
    : 0;

  return (
    <>
      <header class="page-header">
        <div>
          <p class="eyebrow">오늘</p>
          <h1>{formatKoreanDate(today)}</h1>
        </div>
      </header>

      <StorageNotice />

      {data && data.medicines.length === 0 && (
        <section class="empty-state">
          <p>등록한 약이 없습니다.</p>
          <a class="button primary" href={href({ page: 'medicine', id: 'new' })}>
            <Icon name="plus" size={20} /> 약 등록하기
          </a>
        </section>
      )}

      {data && data.medicines.length > 0 && plan.length === 0 && <p class="empty-hint">오늘 먹을 약이 없습니다.</p>}

      {unscheduled > 0 && (
        <a class="notice-inline link" href={href({ page: 'medicines' })}>
          복용 일정이 없는 약이 {unscheduled}개 있습니다. 일정을 추가하면 여기에 표시됩니다.
        </a>
      )}

      <ul class="slot-cards">
        {plan.map((group, i) => (
          <li key={group.key} class={`slot-card${i === upcoming ? ' upcoming' : ''}`}>
            <div class="slot-card-head">
              <h2>{group.slot?.label ?? formatKoreanTime(group.time)}</h2>
              {group.slot && <span class="slot-time">{formatKoreanTime(group.time)}</span>}
              {i === upcoming && <span class="badge">다음</span>}
            </div>
            <ul class="dose-list">
              {group.doses.map(({ schedule, medicine }) => (
                <li key={schedule.id}>
                  <MedicineIcon medicine={medicine} size={32} />
                  <div>
                    <span class="dose-title">{medicineTitle(medicine)}</span>
                    <span class="dose-sub">
                      {formatDose(schedule.doseQty, schedule.doseUnit)}
                      {schedule.instructions && ` · ${schedule.instructions}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {plan.length > 0 && <p class="field-hint center">복용 체크는 다음 단계에서 추가됩니다.</p>}
    </>
  );
}
