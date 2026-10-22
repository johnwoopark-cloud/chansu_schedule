import { useEffect, useState } from 'preact/hooks';
import { db } from '../db/database';
import {
  deleteMedicine,
  ensureTag,
  listSchedules,
  listTags,
  nextMedicineSortOrder,
  pruneUnusedTags,
  saveMedicine,
  saveSchedule,
  setAllSchedulesActive,
  setMedicineActive,
} from '../db/medicineRepository';
import { listSlots } from '../db/slotRepository';
import {
  MEDICINE_COLORS,
  MEDICINE_ICONS,
  MEDICINE_ICON_LABELS,
  STOCK_UNITS,
  STRENGTH_UNITS,
  newMedicine,
  type MedicineErrors,
} from '../domain/medicine';
import { fromDraft, toDraft, type MedicineDraft } from '../domain/medicineDraft';
import { describeSchedule } from '../domain/schedule';
import { formatDose } from '../domain/medicine';
import { useLiveQuery } from '../lib/useLiveQuery';
import { useNow } from '../lib/useNow';
import { useStockOverview } from '../lib/useStockOverview';
import { refillMedicine, undoRefill } from '../db/doseRepository';
import { logicalDate } from '../domain/dates';
import { formatNumber, parseNumber as parseNum } from '../domain/medicine';
import { forecastText, formatStock } from '../components/StockText';
import { showToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { Icon } from '../components/Icon';
import { MedicineIcon } from '../components/MedicineIcon';
import { Chip, Field, NumberInput, SuggestInput, Switch } from '../components/Form';
import { goBackTo, href, navigate } from '../router';

function SchedulesSection({ medicineId }: { medicineId: number }) {
  const data = useLiveQuery(async () => {
    const [schedules, slots, all, medicines] = await Promise.all([
      listSchedules(db, medicineId),
      listSlots(db),
      db.schedules.toArray(),
      db.medicines.toArray(),
    ]);
    return {
      schedules,
      describe: {
        slots: new Map(slots.map((s) => [s.id!, s])),
        schedules: new Map(all.map((s) => [s.id!, s])),
        medicines: new Map(medicines.map((m) => [m.id!, m])),
      },
    };
  }, [medicineId]);
  if (!data) return null;
  const anyActive = data.schedules.some((s) => s.active);

  return (
    <section class="card">
      <div class="card-head">
        <h2>복용 일정</h2>
        {data.schedules.length > 1 && (
          <button
            type="button"
            class="button small"
            onClick={() => setAllSchedulesActive(db, medicineId, !anyActive)}
          >
            <Icon name={anyActive ? 'pause' : 'play'} size={16} /> {anyActive ? '모두 일시정지' : '모두 재개'}
          </button>
        )}
      </div>
      {data.schedules.length === 0 && <p class="muted">아직 일정이 없습니다. 일정을 추가해야 오늘 화면에 표시됩니다.</p>}
      <ul class="schedule-list">
        {data.schedules.map((s) => (
          <li key={s.id} class={s.active ? undefined : 'inactive'}>
            <a href={href({ page: 'schedule', medicineId, id: s.id! })}>
              <span class="schedule-when">{describeSchedule(s, data.describe)}</span>
              <span class="schedule-dose">
                {formatDose(s.doseQty, s.doseUnit)}
                {s.instructions && ` · ${s.instructions}`}
              </span>
            </a>
            <input
              type="checkbox"
              role="switch"
              checked={s.active}
              aria-label="일정 사용"
              onChange={(e) => saveSchedule(db, { ...s, active: e.currentTarget.checked })}
            />
          </li>
        ))}
      </ul>
      <div class="button-row">
        <a class="button" href={href({ page: 'schedule', medicineId, id: 'new' })}>
          <Icon name="plus" size={20} /> 일정 추가
        </a>
        {data.schedules.length > 0 && (
          <a class="button" href={href({ page: 'medicine-calendar', id: medicineId })}>
            <Icon name="today" size={20} /> 달력으로 보기
          </a>
        )}
      </div>
    </section>
  );
}

function StockSection({ medicineId, onChanged }: { medicineId: number; onChanged: () => void }) {
  const now = useNow();
  const overview = useStockOverview(now);
  const medicine = useLiveQuery(() => db.medicines.get(medicineId), [medicineId]);
  const [custom, setCustom] = useState('');
  if (!medicine?.trackStock || !overview) return null;
  const forecast = overview.forecasts.get(medicineId);
  const low = forecast && !forecast.noUsage && forecast.daysCovered <= overview.lowStockDays;

  const refill = async (qty: number) => {
    const id = await refillMedicine(db, medicineId, qty, logicalDate(new Date(), '00:00'), Date.now());
    onChanged();
    showToast(`${formatNumber(qty)}${medicine.stockUnit} 추가했습니다.`, {
      label: '되돌리기',
      run: async () => {
        await undoRefill(db, id);
        onChanged();
      },
    });
  };

  return (
    <section class="card stock-card">
      <div class="card-head">
        <h2>재고</h2>
        <a class="button small" href={href({ page: 'prescription', id: 'new' })}>
          조제 기록
        </a>
      </div>
      <p class={`stock-amount${medicine.stockAmount <= 0 ? ' empty' : ''}`}>{formatStock(medicine)}</p>
      <p class={`stock-forecast${low ? ' low' : ''}`}>{forecastText(forecast)}</p>
      <div class="chips">
        {medicine.refillSizes.map((size) => (
          <button key={size} type="button" class="chip" onClick={() => refill(size)}>
            +{formatNumber(size)}
            {medicine.stockUnit}
          </button>
        ))}
      </div>
      <div class="inline-input">
        <input
          inputMode="decimal"
          value={custom}
          placeholder="받은 양"
          aria-label="리필 수량"
          onInput={(e) => setCustom(e.currentTarget.value)}
        />
        <button
          type="button"
          class="button small"
          onClick={() => {
            const qty = parseNum(custom);
            if (qty === undefined || Number.isNaN(qty) || qty <= 0) return;
            setCustom('');
            refill(qty);
          }}
        >
          리필
        </button>
      </div>
    </section>
  );
}

function TagEditor({ selected, onChange }: { selected: number[]; onChange: (ids: number[]) => void }) {
  const tags = useLiveQuery(() => listTags(db));
  const [text, setText] = useState('');
  const add = async () => {
    const name = text.trim();
    if (!name) return;
    const id = await ensureTag(db, name);
    if (!selected.includes(id)) onChange([...selected, id]);
    setText('');
  };
  return (
    <div class="tag-editor">
      <div class="chips">
        {tags?.map((t) => (
          <Chip
            key={t.id}
            selected={selected.includes(t.id!)}
            onClick={() =>
              onChange(selected.includes(t.id!) ? selected.filter((id) => id !== t.id) : [...selected, t.id!])
            }
          >
            {t.name}
          </Chip>
        ))}
      </div>
      <div class="inline-input">
        <input
          value={text}
          maxLength={20}
          placeholder="새 태그 (예: 혈압, 영양제)"
          aria-label="새 태그"
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" class="button small" onClick={add}>
          추가
        </button>
      </div>
    </div>
  );
}

export function MedicineEditPage({ id }: { id: number | 'new' }) {
  const [draft, setDraft] = useState<MedicineDraft | null>(null);
  const [missing, setMissing] = useState(false);
  const [errors, setErrors] = useState<MedicineErrors>({});
  const [status, setStatus] = useState<string | null>(null);
  // Stock as last loaded; if the field still shows this on save, keep whatever the DB has now
  // (refills and dose checks may have changed it while the form was open).
  const [loadedStock, setLoadedStock] = useState('');
  const isNew = id === 'new';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (id === 'new') {
        const draft = toDraft(newMedicine(await nextMedicineSortOrder(db)));
        if (!cancelled) setDraft(draft);
        return;
      }
      const medicine = await db.medicines.get(id);
      if (cancelled) return;
      if (medicine) {
        const d = toDraft(medicine);
        setDraft(d);
        setLoadedStock(d.stockAmount);
      } else setMissing(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (missing) {
    return (
      <>
        <PageHeader title="약 정보" back={{ page: 'medicines' }} />
        <p class="empty-hint">약을 찾을 수 없습니다.</p>
      </>
    );
  }
  if (!draft) return null;

  const set = <K extends keyof MedicineDraft>(key: K, value: MedicineDraft[K]) => {
    setDraft({ ...draft, [key]: value });
    setStatus(null);
    // Clear the error for the edited field; units share their number field's error.
    const field = key === 'strengthUnit' ? 'strength' : key === 'productionDate' ? 'expirationDate' : key;
    if (field in errors) {
      const { [field as keyof MedicineErrors]: _cleared, ...rest } = errors;
      setErrors(rest);
    }
  };

  const save = async (e: Event) => {
    e.preventDefault();
    const { medicine, errors } = fromDraft(draft);
    setErrors(errors);
    if (Object.keys(errors).length > 0) {
      setStatus('입력값을 확인하세요.');
      return;
    }
    if (medicine.id !== undefined && draft.stockAmount === loadedStock) {
      const current = await db.medicines.get(medicine.id);
      if (current) medicine.stockAmount = current.stockAmount;
    }
    const result = await saveMedicine(db, medicine);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    await pruneUnusedTags(db);
    if (isNew) {
      navigate({ page: 'medicine', id: result.id }, true);
      navigate({ page: 'schedule', medicineId: result.id, id: 'new' });
    } else {
      const saved = await db.medicines.get(result.id);
      if (saved) {
        const d = toDraft(saved);
        setDraft(d);
        setLoadedStock(d.stockAmount);
      }
      setStatus('저장했습니다.');
    }
  };

  const remove = async () => {
    if (typeof id !== 'number') return;
    if (!confirm(`'${draft.name}'을(를) 삭제할까요? 복용 일정도 함께 삭제됩니다.`)) return;
    const result = await deleteMedicine(db, id);
    if (!result.ok) {
      alert('복용 기록이 있는 약은 삭제할 수 없습니다. 대신 "복용 중단"을 사용하세요.');
      return;
    }
    await pruneUnusedTags(db);
    goBackTo({ page: 'medicines' });
  };

  const reloadStock = async () => {
    if (typeof id !== 'number') return;
    const m = await db.medicines.get(id);
    if (!m) return;
    const fresh = toDraft(m);
    setDraft((d) => (d ? { ...d, stockAmount: fresh.stockAmount, trackStock: fresh.trackStock } : d));
    setLoadedStock(fresh.stockAmount);
  };

  const toggleActive = async () => {
    if (typeof id !== 'number') return;
    await setMedicineActive(db, id, !draft.active);
    setDraft({ ...draft, active: !draft.active });
  };

  return (
    <>
      <PageHeader title={isNew ? '약 추가' : draft.name || '약 정보'} back={{ page: 'medicines' }} />

      {!isNew && !draft.active && (
        <p class="notice-inline">복용을 중단한 약입니다. 오늘 화면에 표시되지 않습니다.</p>
      )}

      {typeof id === 'number' && <SchedulesSection medicineId={id} />}
      {typeof id === 'number' && <StockSection medicineId={id} onChanged={reloadStock} />}

      <form class="medicine-form" onSubmit={save} noValidate>
        <section class="card">
          <h2>기본 정보</h2>
          <Field label="약 이름" error={errors.name}>
            <input
              value={draft.name}
              maxLength={50}
              placeholder="예: 타이레놀"
              onInput={(e) => set('name', e.currentTarget.value)}
            />
          </Field>
          <Field label="함량" error={errors.strength} hint="약 1개(1정, 1mL 등)에 든 성분의 양">
            <div class="input-row">
              <NumberInput value={draft.strength} placeholder="예: 500" ariaLabel="함량" onInput={(v) => set('strength', v)} />
              <SuggestInput
                id="strength-units"
                value={draft.strengthUnit}
                options={STRENGTH_UNITS}
                ariaLabel="함량 단위"
                onInput={(v) => set('strengthUnit', v)}
              />
            </div>
          </Field>
          <Field label="메모">
            <textarea
              rows={2}
              value={draft.notes}
              placeholder="처방 이유, 주의사항 등"
              onInput={(e) => set('notes', e.currentTarget.value)}
            />
          </Field>
        </section>

        <section class="card">
          <h2>모양</h2>
          <div class="icon-picker" role="radiogroup" aria-label="아이콘">
            {MEDICINE_ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                role="radio"
                aria-checked={draft.icon === icon}
                aria-label={MEDICINE_ICON_LABELS[icon]}
                class={draft.icon === icon ? 'selected' : undefined}
                onClick={() => set('icon', icon)}
              >
                <MedicineIcon medicine={{ ...draft, icon }} size={40} />
                <span>{MEDICINE_ICON_LABELS[icon]}</span>
              </button>
            ))}
          </div>
          <Switch label="색으로 구분" checked={draft.useColor} onChange={(v) => set('useColor', v)} />
          {draft.useColor && (
            <div class="swatches" role="radiogroup" aria-label="색">
              {MEDICINE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={draft.color === c}
                  aria-label={c}
                  class={draft.color === c ? 'selected' : undefined}
                  style={{ background: c }}
                  onClick={() => set('color', c)}
                />
              ))}
            </div>
          )}
        </section>

        <section class="card">
          <h2>{isNew ? '재고' : '재고 설정'}</h2>
          <Switch label="재고 관리" checked={draft.trackStock} onChange={(v) => set('trackStock', v)} />
          {!draft.trackStock && (
            <p class="field-hint">켜면 복용을 체크할 때마다 남은 양이 줄고, 떨어지는 날을 알려 줍니다.</p>
          )}
          {draft.trackStock && (
            <>
              <Field label="현재 남은 양" error={errors.stockAmount}>
                <div class="input-row">
                  <NumberInput value={draft.stockAmount} placeholder="0" ariaLabel="현재 남은 양" onInput={(v) => set('stockAmount', v)} />
                  <SuggestInput
                    id="stock-units"
                    value={draft.stockUnit}
                    options={STOCK_UNITS}
                    ariaLabel="재고 단위"
                    onInput={(v) => set('stockUnit', v)}
                  />
                </div>
              </Field>
              <Field label="부족 경고 기준" error={errors.stockThreshold} hint="남은 양이 이 값 이하가 되면 경고합니다. 비워 두면 남은 일수로만 경고합니다.">
                <NumberInput value={draft.stockThreshold} placeholder="예: 7" onInput={(v) => set('stockThreshold', v)} />
              </Field>
              <Field label="리필 크기" error={errors.refillSizes} hint="한 번에 받는 양. 여러 개는 쉼표로 구분 (예: 30, 90)">
                <input
                  inputMode="decimal"
                  value={draft.refillSizes}
                  placeholder="예: 30"
                  onInput={(e) => set('refillSizes', e.currentTarget.value)}
                />
              </Field>
            </>
          )}
        </section>

        <section class="card">
          <h2>날짜</h2>
          <div class="input-row">
            <Field label="제조일">
              <input type="date" value={draft.productionDate} onInput={(e) => set('productionDate', e.currentTarget.value)} />
            </Field>
            <Field label="유효기간" error={errors.expirationDate}>
              <input type="date" value={draft.expirationDate} onInput={(e) => set('expirationDate', e.currentTarget.value)} />
            </Field>
          </div>
        </section>

        <section class="card">
          <h2>태그</h2>
          <TagEditor selected={draft.tagIds} onChange={(ids) => set('tagIds', ids)} />
        </section>

        <details class="card">
          <summary>
            <h2>고급 설정</h2>
          </summary>
          <Switch
            label="건너뛸 수 없는 약 (건너뜀 버튼 숨김)"
            checked={draft.cannotBeSkipped}
            onChange={(v) => set('cannotBeSkipped', v)}
          />
          <div class="input-row">
            <Field label="반감기 (시간)" error={errors.halfLifeHours}>
              <NumberInput value={draft.halfLifeHours} placeholder="예: 4" onInput={(v) => set('halfLifeHours', v)} />
            </Field>
            <Field label="최고 농도 도달 (시간)" error={errors.timeToPeakHours}>
              <NumberInput value={draft.timeToPeakHours} placeholder="예: 1" onInput={(v) => set('timeToPeakHours', v)} />
            </Field>
          </div>
          <p class="field-hint">입력하면 분석 화면에서 체내 농도 추정 그래프를 볼 수 있습니다(참고용).</p>
        </details>

        <div class="sticky-actions">
          {status && (
            <span class="save-status" role="status">
              {status}
            </span>
          )}
          <button type="submit" class="button primary">
            {isNew ? '저장하고 일정 추가' : '저장'}
          </button>
        </div>
      </form>

      {!isNew && (
        <section class="card danger-zone">
          <button type="button" class="button" onClick={toggleActive}>
            <Icon name={draft.active ? 'stop' : 'play'} size={18} /> {draft.active ? '복용 중단' : '다시 복용'}
          </button>
          <button type="button" class="button danger" onClick={remove}>
            <Icon name="trash" size={18} /> 삭제
          </button>
        </section>
      )}
    </>
  );
}
