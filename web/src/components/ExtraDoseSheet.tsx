import { useEffect, useState } from 'preact/hooks';
import { db } from '../db/database';
import { addExtraDose, clearDoses } from '../db/doseRepository';
import type { ISODate, Medicine, Schedule } from '../db/types';
import { timestampFor, toTimeOfDay } from '../domain/dates';
import { DOSE_UNITS, formatNumber, medicineTitle, parseNumber } from '../domain/medicine';
import { Field, NumberInput, SuggestInput } from './Form';
import { Sheet } from './Sheet';
import { showToast } from './Toast';

/** Default amount for an extra dose: the medicine's first schedule, else 1 of its stock unit. */
function defaultDose(medicine: Medicine, schedules: readonly Schedule[]): { qty: number; unit: string } {
  const first = schedules.find((s) => s.medicineId === medicine.id);
  return first ? { qty: first.doseQty, unit: first.doseUnit } : { qty: 1, unit: medicine.stockUnit || '정' };
}

export function ExtraDoseSheet({
  open,
  date,
  isToday,
  medicines,
  schedules,
  cutoff,
  onClose,
}: {
  open: boolean;
  date: ISODate;
  isToday: boolean;
  medicines: readonly Medicine[];
  schedules: readonly Schedule[];
  cutoff: string;
  onClose: () => void;
}) {
  const active = medicines.filter((m) => m.active);
  const [medicineId, setMedicineId] = useState<number | null>(null);
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('정');
  const [time, setTime] = useState('12:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pick = (m: Medicine | undefined) => {
    if (!m) return;
    setMedicineId(m.id!);
    const d = defaultDose(m, schedules);
    setQty(formatNumber(d.qty));
    setUnit(d.unit);
  };

  useEffect(() => {
    if (!open) return;
    pick(active[0]);
    setTime(isToday ? toTimeOfDay(Date.now()) : '12:00');
    setNote('');
    setError(null);
    // Reset only when the sheet opens.
  }, [open]);

  const save = async (e: Event) => {
    e.preventDefault();
    const medicine = active.find((m) => m.id === medicineId);
    const doseQty = parseNumber(qty);
    if (!medicine) return setError('약을 고르세요.');
    if (doseQty === undefined || Number.isNaN(doseQty) || doseQty <= 0) return setError('복용량을 0보다 큰 숫자로 입력하세요.');
    if (!time) return setError('시각을 입력하세요.');
    const id = await addExtraDose(db, {
      medicine,
      date,
      processedAt: timestampFor(date, time, cutoff),
      doseQty,
      doseUnit: unit.trim() || '정',
      note,
    });
    onClose();
    showToast(`${medicine.name} 추가 복용을 기록했습니다.`, { label: '되돌리기', run: () => clearDoses(db, [id]) });
  };

  return (
    <Sheet open={open} title="추가 복용 기록" onClose={onClose}>
      {active.length === 0 ? (
        <p class="muted">복용 중인 약이 없습니다.</p>
      ) : (
        <form class="sheet-form" onSubmit={save} noValidate>
          <Field label="약">
            <select value={medicineId ?? ''} onChange={(e) => pick(active.find((m) => m.id === Number(e.currentTarget.value)))}>
              {active.map((m) => (
                <option key={m.id} value={m.id}>
                  {medicineTitle(m)}
                </option>
              ))}
            </select>
          </Field>
          <div class="input-row">
            <Field label="복용량">
              <div class="input-row">
                <NumberInput value={qty} ariaLabel="복용량" onInput={setQty} />
                <SuggestInput id="extra-units" value={unit} options={DOSE_UNITS} ariaLabel="단위" onInput={setUnit} />
              </div>
            </Field>
            <Field label="시각">
              <input type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} />
            </Field>
          </div>
          <Field label="메모">
            <input value={note} maxLength={200} placeholder="예: 두통이 심해서" onInput={(e) => setNote(e.currentTarget.value)} />
          </Field>
          {error && (
            <p class="form-error" role="alert">
              {error}
            </p>
          )}
          <div class="sheet-actions">
            <button type="submit" class="button primary">
              기록
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
