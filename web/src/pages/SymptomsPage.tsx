import { useState } from 'preact/hooks';
import { db } from '../db/database';
import { addSymptom, deleteSymptom, listSymptoms } from '../db/doseRepository';
import { useLiveQuery } from '../lib/useLiveQuery';
import { PageHeader } from '../components/PageHeader';
import { Icon } from '../components/Icon';

const ERRORS = {
  empty: '이름을 입력하세요.',
  duplicate: '이미 있는 증상입니다.',
  'too-long': '20자 이내로 입력하세요.',
} as const;

export function SymptomsPage() {
  const symptoms = useLiveQuery(() => listSymptoms(db));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async (e: Event) => {
    e.preventDefault();
    const result = await addSymptom(db, name);
    if (!result.ok) {
      setError(ERRORS[result.error]);
      return;
    }
    setName('');
    setError(null);
  };

  return (
    <>
      <PageHeader title="증상 태그" back={{ page: 'more' }} />
      <p class="muted page-intro">복용 기록에 붙일 수 있는 증상입니다. 오늘 화면에서 체크한 약을 눌러 기록합니다.</p>

      <form class="card inline-input" onSubmit={add}>
        <input
          value={name}
          maxLength={20}
          placeholder="새 증상 (예: 손떨림)"
          aria-label="새 증상"
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <button type="submit" class="button primary small">
          추가
        </button>
      </form>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <ul class="slot-list">
        {symptoms?.map((s) => (
          <li key={s.id} class="slot-row">
            <span class="slot-row-main">
              <span class="slot-row-label">{s.name}</span>
            </span>
            <button
              type="button"
              class="icon-button danger"
              aria-label={`${s.name} 삭제`}
              onClick={async () => {
                if (confirm(`'${s.name}'을(를) 삭제할까요? 이 증상이 붙은 기록에서도 빠집니다.`)) await deleteSymptom(db, s.id!);
              }}
            >
              <Icon name="trash" size={20} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
