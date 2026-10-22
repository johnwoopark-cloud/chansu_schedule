import { useEffect, useState } from 'preact/hooks';
import { db } from '../db/database';
import { getSettings } from '../db/doseRepository';
import { listMedicines } from '../db/medicineRepository';
import { deletePrescription, savePrescription } from '../db/prescriptionRepository';
import { listSlots } from '../db/slotRepository';
import type { Medicine, Prescription, Schedule, Slot } from '../db/types';
import { logicalDate } from '../domain/dates';
import { formatNumber, medicineTitle, parseNumber } from '../domain/medicine';
import { suggestedQuantity, type PrescriptionErrors } from '../domain/prescription';
import { PageHeader } from '../components/PageHeader';
import { Field, NumberInput, Switch } from '../components/Form';
import { Icon } from '../components/Icon';
import { showToast } from '../components/Toast';
import { goBackTo } from '../router';

interface Draft {
  id?: number;
  receivedDate: string;
  hospital: string;
  pharmacy: string;
  days: string;
  note: string;
  /** medicineId → quantity text; presence means selected. */
  items: Map<number, string>;
  /** Items whose quantity was filled in automatically and may follow changes to days. */
  autoItems: Set<number>;
  /** slotId → packet count text. */
  packets: Map<number, string>;
  autoPackets: Set<number>;
  photoIds: number[];
}

function toDraft(p: Prescription): Draft {
  return {
    id: p.id,
    receivedDate: p.receivedDate,
    hospital: p.hospital ?? '',
    pharmacy: p.pharmacy ?? '',
    days: p.days ? String(p.days) : '',
    note: p.note ?? '',
    items: new Map(p.items.map((i) => [i.medicineId, formatNumber(i.quantity)])),
    autoItems: new Set(),
    packets: new Map(p.packets.map((x) => [x.slotId, String(x.count)])),
    autoPackets: new Set(),
    photoIds: p.photoIds,
  };
}

const back = { page: 'prescriptions' } as const;

export function PrescriptionEditPage({ id }: { id: number | 'new' }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [applyPeriod, setApplyPeriod] = useState(false);
  const [errors, setErrors] = useState<PrescriptionErrors>({});
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [meds, scheds, slotList, settings, existing] = await Promise.all([
        listMedicines(db),
        db.schedules.toArray(),
        listSlots(db),
        getSettings(db),
        id === 'new' ? Promise.resolve(undefined) : db.prescriptions.get(id),
      ]);
      if (cancelled) return;
      if (id !== 'new' && !existing) {
        setMissing(true);
        return;
      }
      setMedicines(meds);
      setSchedules(scheds);
      setSlots(slotList);
      setDraft(
        existing
          ? toDraft(existing)
          : {
              receivedDate: logicalDate(new Date(), settings.lateNightCutoff),
              hospital: '',
              pharmacy: '',
              days: '',
              note: '',
              items: new Map(),
              autoItems: new Set(),
              packets: new Map(),
              autoPackets: new Set(),
              photoIds: [],
            },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (missing) {
    return (
      <>
        <PageHeader title="조제 기록" back={back} />
        <p class="empty-hint">기록을 찾을 수 없습니다.</p>
      </>
    );
  }
  if (!draft) return null;

  const days = parseNumber(draft.days);
  const validDays = days !== undefined && Number.isInteger(days) && days > 0 ? days : undefined;
  const suggest = (m: Medicine, d: number | undefined) => {
    if (!d) return '';
    const q = suggestedQuantity(m, schedules, d, draft.receivedDate);
    return q > 0 ? String(q) : '';
  };
  // Medicines to offer: active ones, plus any stopped medicine already in this record.
  const choices = medicines.filter((m) => m.active || draft.items.has(m.id!));
  const usedSlotIds = new Set(
    schedules.filter((s) => s.active && draft.items.has(s.medicineId) && s.slotId !== undefined).map((s) => s.slotId!),
  );

  const update = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setErrors({});
  };

  const setDays = (text: string) => {
    const d = parseNumber(text);
    const valid = d !== undefined && Number.isInteger(d) && d > 0 ? d : undefined;
    const items = new Map(draft.items);
    for (const mId of draft.autoItems) {
      const m = medicines.find((x) => x.id === mId);
      if (m) items.set(mId, suggest(m, valid));
    }
    const packets = new Map(draft.packets);
    for (const sId of draft.autoPackets) packets.set(sId, valid ? String(valid) : '');
    update({ days: text, items, packets });
  };

  const toggleItem = (m: Medicine) => {
    const items = new Map(draft.items);
    const autoItems = new Set(draft.autoItems);
    if (items.has(m.id!)) {
      items.delete(m.id!);
      autoItems.delete(m.id!);
    } else {
      items.set(m.id!, suggest(m, validDays));
      autoItems.add(m.id!);
    }
    update({ items, autoItems });
  };

  const setItemQty = (mId: number, text: string) => {
    const items = new Map(draft.items).set(mId, text);
    const autoItems = new Set(draft.autoItems);
    autoItems.delete(mId);
    update({ items, autoItems });
  };

  const togglePacket = (slot: Slot) => {
    const packets = new Map(draft.packets);
    const autoPackets = new Set(draft.autoPackets);
    if (packets.has(slot.id!)) {
      packets.delete(slot.id!);
      autoPackets.delete(slot.id!);
    } else {
      packets.set(slot.id!, validDays ? String(validDays) : '');
      autoPackets.add(slot.id!);
    }
    update({ packets, autoPackets });
  };

  const save = async (e: Event) => {
    e.preventDefault();
    const record: Omit<Prescription, 'id'> & { id?: number } = {
      ...(draft.id !== undefined ? { id: draft.id } : {}),
      receivedDate: draft.receivedDate,
      hospital: draft.hospital,
      pharmacy: draft.pharmacy,
      ...(draft.days.trim() ? { days: parseNumber(draft.days) ?? NaN } : {}),
      note: draft.note,
      items: [...draft.items].map(([medicineId, q]) => ({ medicineId, quantity: parseNumber(q) ?? NaN })),
      packets: [...draft.packets].map(([slotId, c]) => ({ slotId, count: parseNumber(c) ?? NaN })),
      photoIds: draft.photoIds,
    };
    const result = await savePrescription(db, record, { applyPeriod });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    showToast(id === 'new' ? '조제 기록을 저장하고 재고에 더했습니다.' : '조제 기록을 수정했습니다.');
    goBackTo(back);
  };

  const remove = async () => {
    if (typeof id !== 'number') return;
    if (!confirm('이 조제 기록을 삭제할까요? 받은 양만큼 재고에서 빠집니다.')) return;
    await deletePrescription(db, id);
    showToast('조제 기록을 삭제했습니다.');
    goBackTo(back);
  };

  const untracked = choices.filter((m) => draft.items.has(m.id!) && !m.trackStock);

  return (
    <>
      <PageHeader title={id === 'new' ? '받아 온 약 기록' : '조제 기록'} back={back} />
      <form onSubmit={save} noValidate>
        <section class="card">
          <h2>언제, 어디서</h2>
          <div class="input-row">
            <Field label="받은 날짜" error={errors.receivedDate}>
              <input type="date" value={draft.receivedDate} onInput={(e) => update({ receivedDate: e.currentTarget.value })} />
            </Field>
            <Field label="처방 일수" error={errors.days}>
              <NumberInput value={draft.days} placeholder="예: 30" ariaLabel="처방 일수" onInput={setDays} />
            </Field>
          </div>
          <div class="input-row">
            <Field label="병원">
              <input value={draft.hospital} maxLength={40} onInput={(e) => update({ hospital: e.currentTarget.value })} />
            </Field>
            <Field label="약국">
              <input value={draft.pharmacy} maxLength={40} onInput={(e) => update({ pharmacy: e.currentTarget.value })} />
            </Field>
          </div>
          <Field label="메모">
            <input value={draft.note} maxLength={200} placeholder="예: 다음 진료 11/20" onInput={(e) => update({ note: e.currentTarget.value })} />
          </Field>
        </section>

        <section class="card">
          <h2>받은 약</h2>
          {choices.length === 0 && <p class="muted">먼저 약을 등록하세요.</p>}
          <ul class="pick-list">
            {choices.map((m) => {
              const selected = draft.items.has(m.id!);
              return (
                <li key={m.id} class={selected ? 'selected' : undefined}>
                  <label class="pick-label">
                    <input type="checkbox" checked={selected} onChange={() => toggleItem(m)} />
                    <span>{medicineTitle(m)}</span>
                  </label>
                  {selected && (
                    <div class="pick-qty">
                      <NumberInput
                        value={draft.items.get(m.id!)!}
                        ariaLabel={`${m.name} 수량`}
                        placeholder="수량"
                        onInput={(v) => setItemQty(m.id!, v)}
                      />
                      <span>{m.stockUnit}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {errors.items && <p class="field-error">{errors.items}</p>}
          {draft.autoItems.size > 0 && validDays && (
            <p class="field-hint">수량은 복용 일정 × 처방 일수로 채웠습니다. 실제 받은 양과 다르면 고치세요.</p>
          )}
          {untracked.length > 0 && (
            <p class="field-hint">{untracked.map((m) => m.name).join(', ')}의 재고 관리가 켜집니다.</p>
          )}
        </section>

        <section class="card">
          <h2>약봉투</h2>
          <p class="field-hint">약국에서 복용 시기별로 한 봉지에 묶어 준 경우에만 입력하세요. 그 시기를 체크하면 봉지가 하나씩 줄어듭니다.</p>
          <ul class="pick-list">
            {slots.map((slot) => {
              const selected = draft.packets.has(slot.id!);
              return (
                <li key={slot.id} class={selected ? 'selected' : undefined}>
                  <label class="pick-label">
                    <input type="checkbox" checked={selected} onChange={() => togglePacket(slot)} />
                    <span class="pick-text">
                      {slot.label}
                      {usedSlotIds.has(slot.id!) && <span class="pick-sub">선택한 약이 이 시기에 있음</span>}
                    </span>
                  </label>
                  {selected && (
                    <div class="pick-qty">
                      <NumberInput
                        value={draft.packets.get(slot.id!)!}
                        ariaLabel={`${slot.label} 봉지 수`}
                        placeholder="봉지 수"
                        onInput={(v) => {
                          const packets = new Map(draft.packets).set(slot.id!, v);
                          const autoPackets = new Set(draft.autoPackets);
                          autoPackets.delete(slot.id!);
                          update({ packets, autoPackets });
                        }}
                      />
                      <span>봉</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {errors.packets && <p class="field-error">{errors.packets}</p>}
        </section>

        {validDays && draft.items.size > 0 && (
          <section class="card">
            <Switch label="처방 일수로 복용 기간 정하기" checked={applyPeriod} onChange={setApplyPeriod} />
            <p class="field-hint">
              켜면 선택한 약의 복용 일정이 받은 날부터 {validDays}일 동안으로 바뀝니다. 다음 처방을 받으면 다시 연장됩니다.
            </p>
          </section>
        )}

        <div class="sticky-actions">
          <button type="submit" class="button primary">
            저장
          </button>
        </div>
      </form>

      {typeof id === 'number' && (
        <section class="card danger-zone">
          <button type="button" class="button danger" onClick={remove}>
            <Icon name="trash" size={18} /> 기록 삭제
          </button>
        </section>
      )}
    </>
  );
}
