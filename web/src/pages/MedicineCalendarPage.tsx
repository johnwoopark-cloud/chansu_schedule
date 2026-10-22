import { useState } from 'preact/hooks';
import { db } from '../db/database';
import { loadDayContext, occurrencesOn } from '../db/dayContext';
import type { DoseEvent, ISODate } from '../db/types';
import { formatKoreanDate, formatKoreanTime, toTimeOfDay } from '../domain/dates';
import { monthGrid, sameMonth, shiftMonth } from '../domain/calendar';
import { matchesOccurrence, type Occurrence } from '../domain/occurrences';
import { formatDose, medicineTitle } from '../domain/medicine';
import { useLiveQuery } from '../lib/useLiveQuery';
import { PageHeader } from '../components/PageHeader';
import { Icon } from '../components/Icon';

interface DayCell {
  date: ISODate;
  planned: Occurrence[];
  events: DoseEvent[];
  taken: number;
  skipped: number;
}

type Status = 'none' | 'planned' | 'done' | 'partial' | 'missed';

function statusOf(cell: DayCell, today: ISODate): Status {
  const total = cell.planned.filter((o) => !o.waiting).length;
  if (cell.date > today) return total ? 'planned' : 'none';
  if (!total && !cell.taken) return 'none';
  if (cell.taken >= total && cell.taken > 0) return 'done';
  if (cell.taken + cell.skipped > 0) return 'partial';
  return cell.date < today ? 'missed' : 'planned';
}

const WEEK_HEAD = ['월', '화', '수', '목', '금', '토', '일'];

/** Month calendar of one medicine: past days show what was recorded, future days what is planned. */
export function MedicineCalendarPage({ id }: { id: number }) {
  const [month, setMonth] = useState<ISODate | null>(null);
  const [selected, setSelected] = useState<ISODate | null>(null);

  const data = useLiveQuery(async () => {
    const ctx = await loadDayContext(db, new Date());
    const shown = month ?? ctx.today;
    const grid = monthGrid(shown);
    const from = grid.days[0];
    const to = grid.days[grid.days.length - 1];
    const events = await db.doseEvents.where('date').between(from, to, true, true).toArray();
    const cells = grid.days.map((date): DayCell => {
      const dayEvents = events.filter((e) => e.date === date);
      const planned = occurrencesOn(ctx, date, dayEvents).filter((o) => o.medicine.id === id);
      const mine = dayEvents.filter((e) => e.medicineId === id && (e.kind === 'SCHEDULED' || e.kind === 'EXTRA'));
      return {
        date,
        planned,
        events: mine,
        taken: mine.filter((e) => e.status === 'TAKEN').length,
        skipped: mine.filter((e) => e.status === 'SKIPPED').length,
      };
    });
    return { ctx, now: Date.now(), medicine: ctx.medicines.find((m) => m.id === id), month: grid.month, cells };
  }, [id, month]);

  if (!data) return null;
  if (!data.medicine) {
    return (
      <>
        <PageHeader title="달력" back={{ page: 'medicines' }} />
        <p class="empty-hint">약을 찾을 수 없습니다.</p>
      </>
    );
  }
  const today = data.ctx.today;
  const [year, monthNo] = data.month.split('-').map(Number);
  const cell = data.cells.find((c) => c.date === (selected ?? today));

  return (
    <>
      <PageHeader title={`${medicineTitle(data.medicine)} 달력`} back={{ page: 'medicine', id }} />

      <div class="month-nav">
        <button type="button" class="icon-button" aria-label="이전 달" onClick={() => setMonth(shiftMonth(data.month, -1))}>
          <Icon name="back" />
        </button>
        <h2>
          {year}년 {monthNo}월
        </h2>
        <button type="button" class="icon-button" aria-label="다음 달" onClick={() => setMonth(shiftMonth(data.month, 1))}>
          <Icon name="forward" />
        </button>
      </div>

      <div class="calendar" role="grid" aria-label="복용 달력">
        {WEEK_HEAD.map((d) => (
          <span key={d} class="calendar-head" role="columnheader">
            {d}
          </span>
        ))}
        {data.cells.map((c) => {
          const status = statusOf(c, today);
          const count = c.planned.filter((o) => !o.waiting).length;
          return (
            <button
              key={c.date}
              type="button"
              role="gridcell"
              class={`calendar-day ${status}${sameMonth(c.date, data.month) ? '' : ' outside'}${c.date === today ? ' today' : ''}${
                c.date === (selected ?? today) ? ' selected' : ''
              }`}
              aria-label={`${formatKoreanDate(c.date)} ${count ? `${count}회` : '복용 없음'}`}
              onClick={() => setSelected(c.date)}
            >
              <span class="calendar-num">{Number(c.date.slice(8))}</span>
              {count > 0 && <span class="calendar-count">{count > 1 ? `${count}회` : '•'}</span>}
            </button>
          );
        })}
      </div>

      <ul class="calendar-legend" aria-label="범례">
        <li class="done">모두 복용</li>
        <li class="partial">일부</li>
        <li class="missed">미복용</li>
        <li class="planned">예정</li>
      </ul>

      {cell && (
        <section class="card">
          <h2>{formatKoreanDate(cell.date)}</h2>
          {cell.planned.length === 0 && cell.events.length === 0 && <p class="muted">이날은 복용 일정이 없습니다.</p>}
          <ul class="calendar-detail">
            {cell.planned.map((o) => {
              const e = cell.events.find((ev) => matchesOccurrence(ev, o));
              const overdue = cell.date < today || (cell.date === today && o.at < data.now);
              return (
                <li key={o.key}>
                  <span class="calendar-time">{o.waiting ? '대기' : formatKoreanTime(toTimeOfDay(o.at))}</span>
                  <span>{formatDose(o.schedule.doseQty, o.schedule.doseUnit)}</span>
                  <span class={`badge ${e ? (e.status === 'TAKEN' ? 'done' : 'muted') : overdue ? 'overdue' : 'muted'}`}>
                    {e
                      ? e.status === 'TAKEN'
                        ? `복용 ${e.processedAt ? toTimeOfDay(e.processedAt) : ''}`
                        : '건너뜀'
                      : o.waiting
                        ? '앞 약 대기'
                        : overdue
                          ? '미체크'
                          : '예정'}
                  </span>
                </li>
              );
            })}
            {cell.events
              .filter((e) => !cell.planned.some((o) => matchesOccurrence(e, o)))
              .map((e) => (
                <li key={`e${e.id}`}>
                  <span class="calendar-time">{e.processedAt ? formatKoreanTime(toTimeOfDay(e.processedAt)) : ''}</span>
                  <span>{formatDose(e.snapshot.doseQty, e.snapshot.doseUnit)}</span>
                  <span class="badge muted">{e.kind === 'EXTRA' ? '추가 복용' : e.status === 'TAKEN' ? '복용' : '건너뜀'}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  );
}
