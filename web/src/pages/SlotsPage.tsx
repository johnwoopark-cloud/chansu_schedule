import { useState } from 'preact/hooks';
import { db } from '../db/database';
import { addSlot, deleteSlot, listSlots, moveSlotInDb, updateSlot, type SlotResult } from '../db/slotRepository';
import type { Slot } from '../db/types';
import { MAX_LABEL_LENGTH, SLOT_ERROR_MESSAGES } from '../domain/slots';
import { formatKoreanTime } from '../domain/dates';
import { useLiveQuery } from '../lib/useLiveQuery';
import { PageHeader } from '../components/PageHeader';
import { Icon } from '../components/Icon';

function errorMessage(result: SlotResult): string | null {
  if (result.ok) return null;
  if (result.error === 'in-use') return '이 복용 시기를 쓰는 일정이 있어 삭제할 수 없습니다.';
  return SLOT_ERROR_MESSAGES[result.error];
}

function SlotForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Pick<Slot, 'label' | 'time'>;
  submitLabel: string;
  onSubmit: (draft: Pick<Slot, 'label' | 'time'>) => Promise<SlotResult>;
  onCancel?: () => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [time, setTime] = useState(initial.time);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      class="slot-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await onSubmit({ label, time });
        setError(errorMessage(result));
        if (result.ok && !onCancel) {
          setLabel('');
          setTime(initial.time);
        }
      }}
    >
      <label>
        <span>이름</span>
        <input
          value={label}
          maxLength={MAX_LABEL_LENGTH}
          placeholder="예: 오후 간식"
          onInput={(e) => setLabel(e.currentTarget.value)}
          required
        />
      </label>
      <label>
        <span>기준 시각</span>
        <input type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} required />
      </label>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="form-actions">
        {onCancel && (
          <button type="button" class="button" onClick={onCancel}>
            취소
          </button>
        )}
        <button type="submit" class="button primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function SlotsPage() {
  const slots = useLiveQuery(() => listSlots(db));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="복용 시기 설정" back={{ page: 'more' }} />
      <p class="muted page-intro">
        오늘 화면에 시기별 카드로 표시됩니다. 기준 시각이 지나도 체크하지 않은 카드는 강조됩니다.
      </p>

      {listError && (
        <p class="form-error" role="alert">
          {listError}
        </p>
      )}

      <ul class="slot-list">
        {slots?.map((slot, i) =>
          editingId === slot.id ? (
            <li key={slot.id} class="slot-row editing">
              <SlotForm
                initial={slot}
                submitLabel="저장"
                onSubmit={async (draft) => {
                  const result = await updateSlot(db, slot.id!, draft);
                  if (result.ok) setEditingId(null);
                  return result;
                }}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={slot.id} class="slot-row">
              <button
                type="button"
                class="slot-row-main"
                onClick={() => {
                  setListError(null);
                  setEditingId(slot.id!);
                }}
              >
                <span class="slot-row-label">{slot.label}</span>
                <span class="slot-time">{formatKoreanTime(slot.time)}</span>
              </button>
              <div class="slot-row-actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`${slot.label} 위로`}
                  disabled={i === 0}
                  onClick={() => moveSlotInDb(db, slot.id!, -1)}
                >
                  <Icon name="up" size={20} />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`${slot.label} 아래로`}
                  disabled={i === slots.length - 1}
                  onClick={() => moveSlotInDb(db, slot.id!, 1)}
                >
                  <Icon name="down" size={20} />
                </button>
                <button
                  type="button"
                  class="icon-button danger"
                  aria-label={`${slot.label} 삭제`}
                  onClick={async () => {
                    if (!confirm(`'${slot.label}' 복용 시기를 삭제할까요?`)) return;
                    setListError(errorMessage(await deleteSlot(db, slot.id!)));
                  }}
                >
                  <Icon name="trash" size={20} />
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {adding ? (
        <section class="card">
          <h2>복용 시기 추가</h2>
          <SlotForm
            initial={{ label: '', time: '15:00' }}
            submitLabel="추가"
            onSubmit={async (draft) => {
              const result = await addSlot(db, draft);
              if (result.ok) setAdding(false);
              return result;
            }}
            onCancel={() => setAdding(false)}
          />
        </section>
      ) : (
        <button type="button" class="button primary block" onClick={() => setAdding(true)}>
          <Icon name="plus" size={20} /> 복용 시기 추가
        </button>
      )}
    </>
  );
}
