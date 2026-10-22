import { useEffect, useState } from 'preact/hooks';
import { db } from '../db/database';
import { clearDoses, restoreEvents, updateEvent } from '../db/doseRepository';
import type { DoseEvent, DoseStatus, Symptom } from '../db/types';
import { timestampFor, toTimeOfDay } from '../domain/dates';
import { formatNumber, formatStrength, parseNumber } from '../domain/medicine';
import { Chip, Field, NumberInput, Segmented } from './Form';
import { Sheet } from './Sheet';
import { showToast } from './Toast';

/** Edit a recorded dose: status, time, amount, note and symptoms; or return it to "not checked". */
export function DoseEventSheet({
  event,
  symptoms,
  cutoff,
  canSkip,
  onClose,
}: {
  event: DoseEvent | null;
  symptoms: readonly Symptom[];
  cutoff: string;
  canSkip: boolean;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<DoseStatus>('TAKEN');
  const [time, setTime] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [symptomIds, setSymptomIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!event) return;
    setStatus(event.status);
    setTime(event.processedAt ? toTimeOfDay(event.processedAt) : '');
    setQty(formatNumber(event.snapshot.doseQty));
    setNote(event.note ?? '');
    setSymptomIds([...event.symptomIds]);
    setError(null);
  }, [event]);

  if (!event) return <Sheet open={false} title="" onClose={onClose}>{null}</Sheet>;

  const isExtra = event.kind === 'EXTRA';
  const strength = formatStrength(event.snapshot);
  const title = `${event.snapshot.medicineName}${strength ? ` ${strength}` : ''}`;

  const save = async (e: Event) => {
    e.preventDefault();
    const doseQty = parseNumber(qty);
    if (doseQty === undefined || Number.isNaN(doseQty) || doseQty <= 0) {
      setError('복용량을 0보다 큰 숫자로 입력하세요.');
      return;
    }
    await updateEvent(db, event.id!, {
      status,
      ...(time ? { processedAt: timestampFor(event.date, time, cutoff) } : {}),
      doseQty,
      note,
      symptomIds,
    });
    onClose();
    showToast('기록을 수정했습니다.', { label: '되돌리기', run: () => restoreEvents(db, [event]) });
  };

  const clear = async () => {
    if (isExtra && !confirm('이 추가 복용 기록을 삭제할까요?')) return;
    await clearDoses(db, [event.id!]);
    onClose();
    showToast(isExtra ? '기록을 삭제했습니다.' : '체크를 취소했습니다.', {
      label: '되돌리기',
      run: () => restoreEvents(db, [event]),
    });
  };

  return (
    <Sheet open title={title} onClose={onClose}>
      <form class="sheet-form" onSubmit={save} noValidate>
        {!isExtra && (canSkip || status === 'SKIPPED') && (
          <Segmented
            ariaLabel="상태"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'TAKEN', label: '복용함' },
              { value: 'SKIPPED', label: '건너뜀' },
            ]}
          />
        )}
        <div class="input-row">
          <Field label={status === 'TAKEN' ? '복용 시각' : '기록 시각'}>
            <input type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} />
          </Field>
          <Field label={`복용량 (${event.snapshot.doseUnit})`} error={error ?? undefined}>
            <NumberInput value={qty} ariaLabel="복용량" onInput={setQty} />
          </Field>
        </div>
        <Field label={status === 'SKIPPED' ? '건너뛴 이유 · 메모' : '메모'}>
          <textarea
            rows={2}
            value={note}
            maxLength={200}
            placeholder={status === 'SKIPPED' ? '예: 약을 두고 나옴' : '예: 식사 늦게 함'}
            onInput={(e) => setNote(e.currentTarget.value)}
          />
        </Field>
        {symptoms.length > 0 && (
          <div class="field">
            <span class="field-label">증상</span>
            <div class="chips">
              {symptoms.map((s) => (
                <Chip
                  key={s.id}
                  selected={symptomIds.includes(s.id!)}
                  onClick={() =>
                    setSymptomIds(
                      symptomIds.includes(s.id!) ? symptomIds.filter((id) => id !== s.id) : [...symptomIds, s.id!],
                    )
                  }
                >
                  {s.name}
                </Chip>
              ))}
            </div>
          </div>
        )}
        <div class="sheet-actions">
          <button type="button" class="button danger" onClick={clear}>
            {isExtra ? '기록 삭제' : '체크 취소'}
          </button>
          <button type="submit" class="button primary">
            저장
          </button>
        </div>
      </form>
    </Sheet>
  );
}
