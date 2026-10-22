import { useEffect, useState } from 'preact/hooks';
import { db } from '../db/database';
import { listSlots } from '../db/slotRepository';
import { formatKoreanDate, formatKoreanTime, toISODate } from '../domain/dates';
import { upcomingSlotIndex } from '../domain/slots';
import { useLiveQuery } from '../lib/useLiveQuery';
import { StorageNotice } from '../components/StorageNotice';

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
  const slots = useLiveQuery(() => listSlots(db));
  const medicineCount = useLiveQuery(() => db.medicines.count());
  const upcoming = slots ? upcomingSlotIndex(slots, now.getHours() * 60 + now.getMinutes()) : -1;

  return (
    <>
      <header class="page-header">
        <div>
          <p class="eyebrow">오늘</p>
          <h1>{formatKoreanDate(toISODate(now))}</h1>
        </div>
      </header>

      <StorageNotice />

      {medicineCount === 0 && (
        <p class="empty-hint">
          아직 등록한 약이 없습니다. 약 등록은 다음 단계에서 추가됩니다.
        </p>
      )}

      <ul class="slot-cards">
        {slots?.map((slot, i) => (
          <li key={slot.id} class={`slot-card${i === upcoming ? ' upcoming' : ''}`}>
            <div class="slot-card-head">
              <h2>{slot.label}</h2>
              <span class="slot-time">{formatKoreanTime(slot.time)}</span>
              {i === upcoming && <span class="badge">다음</span>}
            </div>
            <p class="slot-empty">이 시기에 먹을 약이 없습니다.</p>
          </li>
        ))}
      </ul>
    </>
  );
}
