import { useRef, useState } from 'preact/hooks';
import { db } from '../db/database';
import {
  clearDoses,
  getSettings,
  listEventsForDate,
  listSymptoms,
  recordDoses,
  type ScheduledDose,
} from '../db/doseRepository';
import { listMedicines, listTags } from '../db/medicineRepository';
import { listSlots } from '../db/slotRepository';
import type { DoseEvent, DoseStatus } from '../db/types';
import {
  addDays,
  daysBetween,
  formatKoreanDate,
  formatKoreanTime,
  logicalDate,
  minutesIntoDay,
  timestampFor,
  toISODate,
  toTimeOfDay,
} from '../domain/dates';
import { buildDayPlan } from '../domain/dayPlan';
import { buildDayView, filterDayView, timingFor, type DoseRow, type GroupView, type StateFilter } from '../domain/dayView';
import { formatDose, formatStrength, medicineTitle } from '../domain/medicine';
import { useLiveQuery } from '../lib/useLiveQuery';
import { useNow } from '../lib/useNow';
import { StorageNotice } from '../components/StorageNotice';
import { MedicineIcon } from '../components/MedicineIcon';
import { Icon } from '../components/Icon';
import { Chip } from '../components/Form';
import { DoseEventSheet } from '../components/DoseEventSheet';
import { ExtraDoseSheet } from '../components/ExtraDoseSheet';
import { showToast } from '../components/Toast';
import { href } from '../router';

const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '미체크' },
  { value: 'done', label: '체크함' },
];

function groupTitle(g: GroupView): string {
  return g.isSlot ? g.label : formatKoreanTime(g.time);
}

function GroupStatus({ group }: { group: GroupView }) {
  const total = group.taken + group.skipped + group.pending;
  if (group.pending === 0) return <span class="badge done">완료</span>;
  if (group.overdue) return <span class="badge overdue">미체크</span>;
  if (group.taken + group.skipped > 0) {
    return (
      <span class="badge muted">
        {group.taken + group.skipped}/{total}
      </span>
    );
  }
  return null;
}

export function TodayPage() {
  const now = useNow();
  const [offset, setOffset] = useState(0);
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [tagId, setTagId] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ event: DoseEvent; canSkip: boolean } | null>(null);
  const [addingExtra, setAddingExtra] = useState(false);
  const datePicker = useRef<HTMLInputElement>(null);

  const settings = useLiveQuery(() => getSettings(db));
  const cutoff = settings?.lateNightCutoff ?? '00:00';
  const logicalToday = logicalDate(now, cutoff);
  const date = addDays(logicalToday, offset);
  const isToday = offset === 0;
  const isFuture = offset > 0;

  const data = useLiveQuery(async () => {
    const [slots, medicines, schedules, events, tags, symptoms] = await Promise.all([
      listSlots(db),
      listMedicines(db),
      db.schedules.toArray(),
      listEventsForDate(db, date),
      listTags(db),
      listSymptoms(db),
    ]);
    return { slots, medicines, schedules, events, tags, symptoms };
  }, [date]);

  if (!data || !settings) return null;

  const plan = buildDayPlan(date, data.slots, data.medicines, data.schedules);
  const view = buildDayView(plan, data.events, timingFor(date, logicalToday, minutesIntoDay(now, logicalToday)));
  const groups = filterDayView(view.groups, stateFilter, tagId);
  const planned = view.totals.taken + view.totals.skipped + view.totals.pending;
  const usedTagIds = new Set(view.groups.flatMap((g) => g.rows.flatMap((r) => r.medicine.tagIds)));
  const tags = data.tags.filter((t) => usedTagIds.has(t.id!));
  const unscheduled = data.medicines.filter((m) => m.active && !data.schedules.some((s) => s.medicineId === m.id)).length;
  const upcomingKey = isToday
    ? view.groups.find((g) => g.pending > 0 && !g.overdue)?.key
    : undefined;

  const record = async (group: GroupView, rows: DoseRow[], status: DoseStatus) => {
    const doses: ScheduledDose[] = rows.map((r) => ({ schedule: r.schedule, medicine: r.medicine, time: group.time }));
    // Today: the moment of the tap. Other days: assume the planned time; it can be edited afterwards.
    const processedAt = isToday ? Date.now() : timestampFor(date, group.time, cutoff);
    const ids = await recordDoses(db, date, doses, status, processedAt, cutoff);
    const what = rows.length === 1 ? rows[0].medicine.name : `${groupTitle(group)} ${rows.length}개`;
    showToast(`${what} ${status === 'TAKEN' ? '복용' : '건너뜀'}으로 기록했습니다.`, {
      label: '되돌리기',
      run: () => clearDoses(db, ids),
    });
  };

  const openEvent = (event: DoseEvent, canSkip: boolean) => setEditing({ event, canSkip });

  return (
    <>
      <header class="page-header today-header">
        <button type="button" class="icon-button" aria-label="전날" onClick={() => setOffset(offset - 1)}>
          <Icon name="back" />
        </button>
        <button
          type="button"
          class="today-title"
          onClick={() => datePicker.current?.showPicker?.()}
          aria-label="날짜 선택"
        >
          <span class="eyebrow">{isToday ? '오늘' : offset === -1 ? '어제' : offset === 1 ? '내일' : ' '}</span>
          <h1>{formatKoreanDate(date)}</h1>
        </button>
        <input
          ref={datePicker}
          type="date"
          class="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          value={date}
          onChange={(e) => {
            const picked = e.currentTarget.value;
            if (picked) setOffset(daysBetween(logicalToday, picked));
          }}
        />
        <button type="button" class="icon-button" aria-label="다음날" onClick={() => setOffset(offset + 1)}>
          <Icon name="forward" />
        </button>
      </header>

      {!isToday && (
        <button type="button" class="button small back-to-today" onClick={() => setOffset(0)}>
          오늘로 돌아가기
        </button>
      )}

      {isToday && logicalToday !== toISODate(now) && (
        <p class="field-hint late-night">
          새벽 {formatKoreanTime(cutoff).replace('오전 ', '')} 전이라 어제 날짜로 기록합니다.
        </p>
      )}

      <StorageNotice />

      {data.medicines.length === 0 && (
        <section class="empty-state">
          <p>등록한 약이 없습니다.</p>
          <a class="button primary" href={href({ page: 'medicine', id: 'new' })}>
            <Icon name="plus" size={20} /> 약 등록하기
          </a>
        </section>
      )}

      {planned > 0 && (
        <section class="day-summary" aria-label="요약">
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={planned} aria-valuenow={view.totals.taken + view.totals.skipped}>
            <span class="progress-taken" style={{ width: `${(view.totals.taken / planned) * 100}%` }} />
            <span class="progress-skipped" style={{ width: `${(view.totals.skipped / planned) * 100}%` }} />
          </div>
          <p>
            복용 <strong>{view.totals.taken}</strong> · 건너뜀 <strong>{view.totals.skipped}</strong> · 남음{' '}
            <strong>{view.totals.pending}</strong>
          </p>
        </section>
      )}

      {planned > 0 && (
        <div class="chips filters" aria-label="필터">
          {STATE_FILTERS.map((f) => (
            <Chip key={f.value} selected={stateFilter === f.value} onClick={() => setStateFilter(f.value)}>
              {f.label}
            </Chip>
          ))}
          {tags.map((t) => (
            <Chip key={t.id} selected={tagId === t.id} onClick={() => setTagId(tagId === t.id ? null : t.id!)}>
              #{t.name}
            </Chip>
          ))}
        </div>
      )}

      {data.medicines.length > 0 && planned === 0 && view.others.length === 0 && (
        <p class="empty-hint">{isToday ? '오늘' : '이날'} 먹을 약이 없습니다.</p>
      )}
      {planned > 0 && groups.length === 0 && <p class="empty-hint">조건에 맞는 약이 없습니다.</p>}

      {isToday && unscheduled > 0 && (
        <a class="notice-inline link" href={href({ page: 'medicines' })}>
          복용 일정이 없는 약이 {unscheduled}개 있습니다. 일정을 추가하면 여기에 표시됩니다.
        </a>
      )}

      <ul class="slot-cards">
        {groups.map((group) => {
          const pendingRows = group.rows.filter((r) => r.state === 'pending');
          return (
            <li
              key={group.key}
              class={`slot-card${group.overdue ? ' overdue' : ''}${group.key === upcomingKey ? ' upcoming' : ''}${group.pending === 0 ? ' complete' : ''}`}
            >
              <div class="slot-card-head">
                <h2>{groupTitle(group)}</h2>
                {group.isSlot && <span class="slot-time">{formatKoreanTime(group.time)}</span>}
                <GroupStatus group={group} />
              </div>
              <ul class="dose-list">
                {group.rows.map((row) => (
                  <li key={row.schedule.id} class={`dose-row ${row.state}`}>
                    <MedicineIcon medicine={row.medicine} size={36} />
                    <div class="dose-text">
                      <span class="dose-title">{medicineTitle(row.medicine)}</span>
                      <span class="dose-sub">
                        {formatDose(row.event?.snapshot.doseQty ?? row.schedule.doseQty, row.schedule.doseUnit)}
                        {row.schedule.instructions && ` · ${row.schedule.instructions}`}
                      </span>
                      {row.event?.note && <span class="dose-note">{row.event.note}</span>}
                    </div>
                    {row.state === 'pending' && !isFuture && (
                      <div class="dose-actions">
                        {!row.medicine.cannotBeSkipped && (
                          <button
                            type="button"
                            class="skip-button"
                            aria-label={`${row.medicine.name} 건너뜀`}
                            onClick={() => record(group, [row], 'SKIPPED')}
                          >
                            건너뜀
                          </button>
                        )}
                        <button
                          type="button"
                          class="check-button"
                          aria-label={`${row.medicine.name} 복용`}
                          onClick={() => record(group, [row], 'TAKEN')}
                        >
                          <Icon name="check" size={22} />
                        </button>
                      </div>
                    )}
                    {row.event && (
                      <button
                        type="button"
                        class={`status-pill ${row.state}`}
                        aria-label={`${row.medicine.name} 기록 수정`}
                        onClick={() => openEvent(row.event!, !row.medicine.cannotBeSkipped)}
                      >
                        <Icon name={row.state === 'taken' ? 'check' : 'skip'} size={16} />
                        {row.state === 'taken'
                          ? row.event.processedAt
                            ? toTimeOfDay(row.event.processedAt)
                            : '복용'
                          : '건너뜀'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {pendingRows.length > 1 && !isFuture && (
                <button type="button" class="button primary block take-all" onClick={() => record(group, pendingRows, 'TAKEN')}>
                  <Icon name="check" size={20} /> {groupTitle(group)} 모두 복용
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {view.others.length > 0 && (
        <section class="card others">
          <h2>추가 복용 · 기타 기록</h2>
          <ul class="dose-list">
            {view.others.map((e) => (
              <li key={e.id} class="dose-row">
                <div class="dose-text">
                  <span class="dose-title">
                    {e.snapshot.medicineName}
                    {formatStrength(e.snapshot) && ` ${formatStrength(e.snapshot)}`}
                  </span>
                  <span class="dose-sub">
                    {formatDose(e.snapshot.doseQty, e.snapshot.doseUnit)} ·{' '}
                    {e.kind === 'EXTRA' ? '추가 복용' : '일정이 바뀐 기록'}
                  </span>
                  {e.note && <span class="dose-note">{e.note}</span>}
                </div>
                <button
                  type="button"
                  class={`status-pill ${e.status === 'TAKEN' ? 'taken' : 'skipped'}`}
                  aria-label={`${e.snapshot.medicineName} 기록 수정`}
                  onClick={() => openEvent(e, true)}
                >
                  <Icon name={e.status === 'TAKEN' ? 'check' : 'skip'} size={16} />
                  {e.processedAt ? toTimeOfDay(e.processedAt) : ''}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.medicines.some((m) => m.active) && !isFuture && (
        <button type="button" class="button block" onClick={() => setAddingExtra(true)}>
          <Icon name="plus" size={20} /> 추가 복용 기록
        </button>
      )}

      <DoseEventSheet
        event={editing?.event ?? null}
        canSkip={editing?.canSkip ?? true}
        symptoms={data.symptoms}
        cutoff={cutoff}
        onClose={() => setEditing(null)}
      />
      <ExtraDoseSheet
        open={addingExtra}
        date={date}
        isToday={isToday}
        medicines={data.medicines}
        schedules={data.schedules}
        cutoff={cutoff}
        onClose={() => setAddingExtra(false)}
      />
    </>
  );
}
