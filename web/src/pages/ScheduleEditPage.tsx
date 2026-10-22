import { useEffect, useState } from 'preact/hooks';
import { db } from '../db/database';
import { deleteSchedule, saveSchedule } from '../db/medicineRepository';
import { getSettings } from '../db/doseRepository';
import { listSlots } from '../db/slotRepository';
import type { Medicine, Schedule, ScheduleType, Slot } from '../db/types';
import { DOSE_UNITS, formatNumber, medicineTitle, parseNumber } from '../domain/medicine';
import {
  EVERY_DAY,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  describeSchedule,
  linkedDescendants,
  newTimeSchedule,
  type ScheduleErrors,
} from '../domain/schedule';
import { formatKoreanTime, logicalDate, timestampFor, toISODate, toTimeOfDay } from '../domain/dates';
import { PageHeader } from '../components/PageHeader';
import { unitsMatch } from '../domain/stock';
import { Chip, Field, NumberInput, Segmented, SuggestInput, Switch } from '../components/Form';
import { Icon } from '../components/Icon';
import { goBackTo, href } from '../router';

const INSTRUCTION_PRESETS = ['식전 30분', '식후 30분', '식사 직후', '공복', '취침 전', '물 많이'];

const TYPES: { value: ScheduleType; label: string; hint: string }[] = [
  { value: 'TIME', label: '정해진 시각', hint: '아침, 저녁처럼 정한 때에' },
  { value: 'CONTINUOUS_INTERVAL', label: 'N시간마다', hint: '밤낮 없이 일정한 간격으로' },
  { value: 'WINDOWED_INTERVAL', label: '시간대 안에서 N시간마다', hint: '예: 9시~21시 사이 4시간마다' },
  { value: 'LINKED', label: '다른 약 먹은 뒤', hint: '예: A 먹고 30분 뒤' },
];

type ScheduleDraft = Omit<Schedule, 'id'> & { id?: number };

function defaultUnit(m: Medicine): string {
  return (DOSE_UNITS as readonly string[]).includes(m.stockUnit) ? m.stockUnit : '정';
}

/** Hours/minutes text pair ↔ minutes. */
function splitMinutes(total: number): [string, string] {
  return [String(Math.floor(total / 60)), String(total % 60)];
}
function joinMinutes(hours: string, minutes: string): number {
  const h = parseNumber(hours || '0');
  const m = parseNumber(minutes || '0');
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return Math.round(h * 60 + m);
}

function DurationInput({
  hours,
  minutes,
  onChange,
  label,
}: {
  hours: string;
  minutes: string;
  onChange: (h: string, m: string) => void;
  label: string;
}) {
  return (
    <div class="duration-input" role="group" aria-label={label}>
      <NumberInput value={hours} ariaLabel={`${label} 시간`} onInput={(v) => onChange(v, minutes)} />
      <span>시간</span>
      <NumberInput value={minutes} ariaLabel={`${label} 분`} onInput={(v) => onChange(hours, v)} />
      <span>분</span>
    </div>
  );
}

export function ScheduleEditPage({ medicineId, id }: { medicineId: number; id: number | 'new' }) {
  const [medicine, setMedicine] = useState<Medicine | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [others, setOthers] = useState<{ schedule: Schedule; label: string }[]>([]);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [doseText, setDoseText] = useState('1');
  const [interval, setIntervalText] = useState<[string, string]>(['6', '0']);
  const [delay, setDelay] = useState<[string, string]>(['0', '30']);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [cutoff, setCutoff] = useState('00:00');
  const [errors, setErrors] = useState<ScheduleErrors>({});
  const [missing, setMissing] = useState(false);
  const back = { page: 'medicine', id: medicineId } as const;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [m, allSlots, existing, allSchedules, medicines, settings] = await Promise.all([
        db.medicines.get(medicineId),
        listSlots(db),
        id === 'new' ? Promise.resolve(undefined) : db.schedules.get(id),
        db.schedules.toArray(),
        db.medicines.toArray(),
        getSettings(db),
      ]);
      if (cancelled) return;
      if (!m || (id !== 'new' && (!existing || existing.medicineId !== medicineId))) {
        setMissing(true);
        return;
      }
      const d: ScheduleDraft = existing ?? newTimeSchedule(medicineId, allSlots[0]?.id, defaultUnit(m));
      const ctx = {
        slots: new Map(allSlots.map((s) => [s.id!, s])),
        schedules: new Map(allSchedules.map((s) => [s.id!, s])),
        medicines: new Map(medicines.map((x) => [x.id!, x])),
      };
      // A schedule may follow any other schedule except itself and the ones that follow it.
      const excluded = typeof id === 'number' ? new Set([id, ...linkedDescendants(id, allSchedules)]) : new Set<number>();
      setOthers(
        allSchedules
          .filter((s) => !excluded.has(s.id!))
          .map((s) => ({ schedule: s, label: `${ctx.medicines.get(s.medicineId)?.name ?? '?'} · ${describeSchedule(s, ctx)}` })),
      );
      setMedicine(m);
      setSlots(allSlots);
      setDraft(d);
      setCutoff(settings.lateNightCutoff);
      setDoseText(formatNumber(d.doseQty));
      if (d.interval) setIntervalText(splitMinutes(d.interval.minutes));
      if (d.linked) setDelay(splitMinutes(d.linked.delayMinutes));
      const start = d.interval?.startAt;
      setStartDate(start ? toISODate(new Date(start)) : logicalDate(new Date(), settings.lateNightCutoff));
      setStartTime(start ? toTimeOfDay(start) : '08:00');
    })();
    return () => {
      cancelled = true;
    };
  }, [medicineId, id]);

  if (missing) {
    return (
      <>
        <PageHeader title="복용 일정" back={back} />
        <p class="empty-hint">일정을 찾을 수 없습니다.</p>
      </>
    );
  }
  if (!draft || !medicine) return null;

  const set = (patch: Partial<ScheduleDraft>) => {
    setDraft({ ...draft, ...patch });
    setErrors({});
  };
  const mode: 'slot' | 'time' = draft.slotId !== undefined ? 'slot' : 'time';
  const allDays = draft.weekdays.every(Boolean) || !draft.weekdays.some(Boolean);
  const usesCalendar = draft.type === 'TIME' || draft.type === 'WINDOWED_INTERVAL';

  const changeType = (type: ScheduleType) => {
    const patch: Partial<ScheduleDraft> = { type };
    if (type === 'TIME' && draft.slotId === undefined && !draft.timeOfDay) patch.slotId = slots[0]?.id;
    if (type === 'WINDOWED_INTERVAL') {
      if (!draft.window) patch.window = { start: '09:00', end: '21:00' };
      if (!draft.interval) setIntervalText(['4', '0']);
    }
    if (type === 'LINKED' && !draft.linked && others[0]) {
      patch.linked = { parentScheduleId: others[0].schedule.id!, delayMinutes: 30 };
    }
    if (type !== 'TIME' && type !== 'WINDOWED_INTERVAL' && type !== 'CONTINUOUS_INTERVAL') patch.autoTaken = false;
    set(patch);
  };

  const toggleDay = (day: number) => {
    const base = allDays ? Array(7).fill(false) : [...draft.weekdays];
    base[day] = !base[day];
    set({ weekdays: base.some(Boolean) ? base : EVERY_DAY() });
  };

  const toggleMonthDay = (day: number) => set({ monthDays: draft.monthDays ^ (1 << (day - 1)) });

  const save = async (e: Event) => {
    e.preventDefault();
    const doseQty = draft.variableAmount ? parseNumber(doseText) ?? 1 : parseNumber(doseText) ?? NaN;
    const record: ScheduleDraft = { ...draft, doseQty, doseUnit: draft.doseUnit.trim() || '정' };
    if (draft.type === 'CONTINUOUS_INTERVAL') {
      record.interval = {
        minutes: joinMinutes(...interval),
        startAt: startDate && startTime ? timestampFor(startDate, startTime, cutoff) : NaN,
        fromProcessed: !!draft.interval?.fromProcessed,
      };
    }
    if (draft.type === 'WINDOWED_INTERVAL') {
      record.interval = { minutes: joinMinutes(...interval), startAt: 0, fromProcessed: !!draft.interval?.fromProcessed };
    }
    if (draft.type === 'LINKED' && draft.linked) {
      record.linked = { ...draft.linked, delayMinutes: joinMinutes(...delay) };
    }
    if (!usesCalendar) {
      record.weekdays = EVERY_DAY();
      record.monthDays = 0;
      delete record.cycle;
    }
    const result = await saveSchedule(db, record);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    goBackTo(back);
  };

  const remove = async () => {
    if (typeof id !== 'number' || !confirm('이 일정을 삭제할까요?')) return;
    const result = await deleteSchedule(db, id);
    if (!result.ok) {
      alert('이 일정 뒤에 먹도록 연결된 일정이 있어 삭제할 수 없습니다. 연결된 일정을 먼저 바꾸거나 삭제하세요.');
      return;
    }
    goBackTo(back);
  };

  return (
    <>
      <PageHeader title={id === 'new' ? '일정 추가' : '일정 수정'} back={back} />
      <p class="muted page-intro">{medicineTitle(medicine)}</p>

      <form onSubmit={save} noValidate>
        <section class="card">
          <h2>방식</h2>
          <div class="type-picker" role="radiogroup" aria-label="일정 방식">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={draft.type === t.value}
                class={draft.type === t.value ? 'selected' : undefined}
                disabled={t.value === 'LINKED' && others.length === 0}
                onClick={() => changeType(t.value)}
              >
                <span class="type-label">{t.label}</span>
                <span class="type-hint">{t.value === 'LINKED' && others.length === 0 ? '먼저 다른 일정을 만드세요' : t.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section class="card">
          <h2>언제</h2>
          {draft.type === 'TIME' && (
            <>
              <Segmented
                ariaLabel="복용 시점 지정 방식"
                value={mode}
                onChange={(m) =>
                  m === 'slot'
                    ? set({ slotId: slots[0]?.id, timeOfDay: undefined })
                    : set({ slotId: undefined, timeOfDay: draft.timeOfDay ?? '09:00' })
                }
                options={[
                  { value: 'slot', label: '복용 시기' },
                  { value: 'time', label: '직접 시각' },
                ]}
              />
              {mode === 'slot' ? (
                slots.length > 0 ? (
                  <div class="chips" role="radiogroup" aria-label="복용 시기">
                    {slots.map((s) => (
                      <Chip key={s.id} selected={draft.slotId === s.id} onClick={() => set({ slotId: s.id })}>
                        {s.label} <span class="chip-sub">{formatKoreanTime(s.time)}</span>
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <p class="muted">
                    복용 시기가 없습니다. <a href={href({ page: 'slots' })}>복용 시기 설정</a>에서 추가하세요.
                  </p>
                )
              ) : (
                <Field label="시각" error={errors.when}>
                  <input type="time" value={draft.timeOfDay ?? ''} onInput={(e) => set({ timeOfDay: e.currentTarget.value })} />
                </Field>
              )}
              {mode === 'slot' && errors.when && <p class="field-error">{errors.when}</p>}
            </>
          )}

          {(draft.type === 'CONTINUOUS_INTERVAL' || draft.type === 'WINDOWED_INTERVAL') && (
            <Field label="간격" error={errors.interval}>
              <DurationInput
                label="간격"
                hours={interval[0]}
                minutes={interval[1]}
                onChange={(h, m) => {
                  setIntervalText([h, m]);
                  setErrors({});
                }}
              />
            </Field>
          )}

          {draft.type === 'CONTINUOUS_INTERVAL' && (
            <>
              <div class="input-row">
                <Field label="첫 복용 날짜" error={errors.when}>
                  <input type="date" value={startDate} onInput={(e) => setStartDate(e.currentTarget.value)} />
                </Field>
                <Field label="첫 복용 시각">
                  <input type="time" value={startTime} onInput={(e) => setStartTime(e.currentTarget.value)} />
                </Field>
              </div>
              <Switch
                label="실제로 체크한 시각부터 다음 복용 계산"
                checked={!!draft.interval?.fromProcessed}
                onChange={(v) => set({ interval: { minutes: 0, startAt: 0, ...draft.interval, fromProcessed: v } })}
              />
              <p class="field-hint">
                {draft.interval?.fromProcessed
                  ? '늦게 먹으면 다음 복용도 그만큼 늦어집니다.'
                  : '먹은 시각과 관계없이 첫 복용 시각부터 일정한 간격으로 정해집니다.'}
              </p>
            </>
          )}

          {draft.type === 'WINDOWED_INTERVAL' && (
            <>
              <div class="input-row">
                <Field label="시작 시각" error={errors.window}>
                  <input
                    type="time"
                    value={draft.window?.start ?? ''}
                    onInput={(e) => set({ window: { end: '21:00', ...draft.window, start: e.currentTarget.value } })}
                  />
                </Field>
                <Field label="끝 시각">
                  <input
                    type="time"
                    value={draft.window?.end ?? ''}
                    onInput={(e) => set({ window: { start: '09:00', ...draft.window, end: e.currentTarget.value } })}
                  />
                </Field>
              </div>
              <p class="field-hint">끝 시각이 시작보다 이르면 자정을 넘겨 다음 날 그 시각까지로 봅니다.</p>
              <Switch
                label="실제로 체크한 시각부터 다음 복용 계산"
                checked={!!draft.interval?.fromProcessed}
                onChange={(v) => set({ interval: { minutes: 0, startAt: 0, ...draft.interval, fromProcessed: v } })}
              />
            </>
          )}

          {draft.type === 'LINKED' && (
            <>
              <Field label="앞 약" error={errors.linked}>
                <select
                  value={draft.linked?.parentScheduleId ?? ''}
                  onChange={(e) =>
                    set({ linked: { delayMinutes: 30, ...draft.linked, parentScheduleId: Number(e.currentTarget.value) } })
                  }
                >
                  {others.map((o) => (
                    <option key={o.schedule.id} value={o.schedule.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="얼마 뒤에">
                <DurationInput
                  label="시간 차이"
                  hours={delay[0]}
                  minutes={delay[1]}
                  onChange={(h, m) => {
                    setDelay([h, m]);
                    setErrors({});
                  }}
                />
              </Field>
              <p class="field-hint">앞 약을 복용으로 체크하면 그 시각부터 계산해 오늘 화면에 나타납니다. 앞 약을 건너뛰면 나오지 않습니다.</p>
            </>
          )}
        </section>

        <section class="card">
          <h2>얼마나</h2>
          <Field label={draft.variableAmount ? '기본 복용량 (먹을 때 바꿀 수 있음)' : '1회 복용량'} error={errors.doseQty}>
            <div class="input-row">
              <NumberInput
                value={doseText}
                ariaLabel="1회 복용량"
                onInput={(v) => {
                  setDoseText(v);
                  setErrors({ ...errors, doseQty: undefined });
                }}
              />
              <SuggestInput
                id="dose-units"
                value={draft.doseUnit}
                options={DOSE_UNITS}
                ariaLabel="복용 단위"
                onInput={(v) => set({ doseUnit: v })}
              />
            </div>
          </Field>
          <Switch label="먹을 때마다 용량 입력" checked={draft.variableAmount} onChange={(v) => set({ variableAmount: v })} />
          {medicine.trackStock && !unitsMatch(draft.doseUnit, medicine.stockUnit) && (
            <p class="field-hint warn-text">재고 단위({medicine.stockUnit})와 달라서 이 일정은 재고를 줄이지 않습니다.</p>
          )}
          <Field label="복용 안내">
            <input
              value={draft.instructions}
              maxLength={40}
              placeholder="예: 식후 30분"
              onInput={(e) => set({ instructions: e.currentTarget.value })}
            />
          </Field>
          <div class="chips">
            {INSTRUCTION_PRESETS.map((p) => (
              <Chip key={p} selected={draft.instructions === p} onClick={() => set({ instructions: draft.instructions === p ? '' : p })}>
                {p}
              </Chip>
            ))}
          </div>
        </section>

        {draft.type !== 'LINKED' && (
          <section class="card">
            <h2>반복</h2>
            {usesCalendar && (
              <>
                <div class="chips" aria-label="빠른 선택">
                  <Chip selected={allDays} onClick={() => set({ weekdays: EVERY_DAY() })}>
                    매일
                  </Chip>
                  <Chip
                    selected={!allDays && draft.weekdays.every((on, i) => on === (i >= 1 && i <= 5))}
                    onClick={() => set({ weekdays: [false, true, true, true, true, true, false] })}
                  >
                    평일
                  </Chip>
                  <Chip
                    selected={!allDays && draft.weekdays.every((on, i) => on === (i === 0 || i === 6))}
                    onClick={() => set({ weekdays: [true, false, false, false, false, false, true] })}
                  >
                    주말
                  </Chip>
                </div>
                <div class="weekday-picker" role="group" aria-label="요일">
                  {WEEKDAY_ORDER.map((day) => (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={!allDays && draft.weekdays[day]}
                      class={!allDays && draft.weekdays[day] ? 'selected' : undefined}
                      onClick={() => toggleDay(day)}
                    >
                      {WEEKDAY_LABELS[day]}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div class="input-row">
              <Field label="시작일" hint="비우면 제한 없음">
                <input
                  type="date"
                  value={draft.periodStart ?? ''}
                  onInput={(e) => set({ periodStart: e.currentTarget.value || undefined })}
                />
              </Field>
              <Field label="종료일" error={errors.period}>
                <input
                  type="date"
                  value={draft.periodEnd ?? ''}
                  onInput={(e) => set({ periodEnd: e.currentTarget.value || undefined })}
                />
              </Field>
            </div>
          </section>
        )}

        {usesCalendar && (
          <details class="card" open={draft.monthDays !== 0 || !!draft.cycle}>
            <summary>
              <h2>고급 반복</h2>
            </summary>
            <div class="field">
              <span class="field-label">매월 특정일</span>
              <div class="month-day-picker" role="group" aria-label="매월 특정일">
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
                  const on = !!(draft.monthDays & (1 << (day - 1)));
                  return (
                    <button key={day} type="button" aria-pressed={on} class={on ? 'selected' : undefined} onClick={() => toggleMonthDay(day)}>
                      {day}
                    </button>
                  );
                })}
              </div>
              <span class="field-hint">
                {draft.monthDays ? '고른 날에만 먹습니다. 요일도 골랐다면 둘 다 맞는 날만입니다.' : '고르지 않으면 날짜 제한이 없습니다.'}
              </span>
              {errors.monthDays && <span class="field-error">{errors.monthDays}</span>}
            </div>
            <Switch
              label="복용·휴약 주기 (예: 21일 먹고 7일 쉼)"
              checked={!!draft.cycle}
              onChange={(v) =>
                set({ cycle: v ? { startDate: draft.periodStart ?? startDate, activeDays: 21, pauseDays: 7 } : undefined })
              }
            />
            {draft.cycle && (
              <>
                <div class="input-row">
                  <Field label="복용일 수">
                    <NumberInput
                      value={String(draft.cycle.activeDays)}
                      ariaLabel="복용일 수"
                      onInput={(v) => set({ cycle: { ...draft.cycle!, activeDays: parseNumber(v) ?? NaN } })}
                    />
                  </Field>
                  <Field label="휴약일 수">
                    <NumberInput
                      value={String(draft.cycle.pauseDays)}
                      ariaLabel="휴약일 수"
                      onInput={(v) => set({ cycle: { ...draft.cycle!, pauseDays: parseNumber(v) ?? NaN } })}
                    />
                  </Field>
                </div>
                <Field label="주기 첫날" error={errors.cycle}>
                  <input
                    type="date"
                    value={draft.cycle.startDate}
                    onInput={(e) => set({ cycle: { ...draft.cycle!, startDate: e.currentTarget.value } })}
                  />
                </Field>
              </>
            )}
          </details>
        )}

        <section class="card">
          <Switch label="이 일정 사용" checked={draft.active} onChange={(v) => set({ active: v })} />
          <p class="field-hint">끄면 일정은 남아 있지만 오늘 화면에 나오지 않습니다.</p>
          {draft.type !== 'LINKED' && (
            <>
              <Switch label="시각이 되면 자동으로 복용 처리" checked={draft.autoTaken} onChange={(v) => set({ autoTaken: v })} />
              <p class="field-hint">
                재고만 맞추려는 용도입니다. 실제로 먹었는지 확인한 기록이 아니며, 기록에 "자동"으로 표시됩니다.
              </p>
            </>
          )}
        </section>

        <div class="sticky-actions">
          <button type="submit" class="button primary">
            저장
          </button>
        </div>
      </form>

      {typeof id === 'number' && (
        <section class="card danger-zone">
          <button type="button" class="button danger" onClick={remove}>
            <Icon name="trash" size={18} /> 일정 삭제
          </button>
        </section>
      )}
    </>
  );
}
