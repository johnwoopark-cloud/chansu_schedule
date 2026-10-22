import { useEffect, useState } from 'preact/hooks';
import { db } from '../db/database';
import { deleteSchedule, saveSchedule } from '../db/medicineRepository';
import { listSlots } from '../db/slotRepository';
import type { Medicine, Schedule, Slot } from '../db/types';
import { DOSE_UNITS, formatNumber, medicineTitle, parseNumber } from '../domain/medicine';
import { EVERY_DAY, WEEKDAY_LABELS, WEEKDAY_ORDER, newTimeSchedule, type ScheduleErrors } from '../domain/schedule';
import { formatKoreanTime } from '../domain/dates';
import { PageHeader } from '../components/PageHeader';
import { Chip, Field, NumberInput, Segmented, SuggestInput, Switch } from '../components/Form';
import { Icon } from '../components/Icon';
import { goBackTo, href } from '../router';

const INSTRUCTION_PRESETS = ['식전 30분', '식후 30분', '식사 직후', '공복', '취침 전', '물 많이'];

type ScheduleDraft = Omit<Schedule, 'id'> & { id?: number };

function defaultUnit(m: Medicine): string {
  return (DOSE_UNITS as readonly string[]).includes(m.stockUnit) ? m.stockUnit : '정';
}

export function ScheduleEditPage({ medicineId, id }: { medicineId: number; id: number | 'new' }) {
  const [medicine, setMedicine] = useState<Medicine | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [doseText, setDoseText] = useState('1');
  const [errors, setErrors] = useState<ScheduleErrors>({});
  const [missing, setMissing] = useState(false);
  const back = { page: 'medicine', id: medicineId } as const;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [m, allSlots, existing] = await Promise.all([
        db.medicines.get(medicineId),
        listSlots(db),
        id === 'new' ? Promise.resolve(undefined) : db.schedules.get(id),
      ]);
      if (cancelled) return;
      if (!m || (id !== 'new' && (!existing || existing.medicineId !== medicineId))) {
        setMissing(true);
        return;
      }
      const draft = existing ?? newTimeSchedule(medicineId, allSlots[0]?.id, defaultUnit(m));
      setMedicine(m);
      setSlots(allSlots);
      setDraft(draft);
      setDoseText(formatNumber(draft.doseQty));
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

  const toggleDay = (day: number) => {
    const base = allDays ? Array(7).fill(false) : [...draft.weekdays];
    base[day] = !base[day];
    set({ weekdays: base.some(Boolean) ? base : EVERY_DAY() });
  };

  const save = async (e: Event) => {
    e.preventDefault();
    const doseQty = parseNumber(doseText) ?? NaN;
    const result = await saveSchedule(db, { ...draft, doseQty, doseUnit: draft.doseUnit.trim() || '정' });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    goBackTo(back);
  };

  const remove = async () => {
    if (typeof id !== 'number' || !confirm('이 일정을 삭제할까요?')) return;
    await deleteSchedule(db, id);
    goBackTo(back);
  };

  return (
    <>
      <PageHeader title={id === 'new' ? '일정 추가' : '일정 수정'} back={back} />
      <p class="muted page-intro">{medicineTitle(medicine)}</p>

      <form onSubmit={save} noValidate>
        <section class="card">
          <h2>언제</h2>
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
        </section>

        <section class="card">
          <h2>얼마나</h2>
          <Field label="1회 복용량" error={errors.doseQty}>
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

        <section class="card">
          <h2>반복</h2>
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

        <section class="card">
          <Switch label="이 일정 사용" checked={draft.active} onChange={(v) => set({ active: v })} />
          <p class="field-hint">끄면 일정은 남아 있지만 오늘 화면에 나오지 않습니다.</p>
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
