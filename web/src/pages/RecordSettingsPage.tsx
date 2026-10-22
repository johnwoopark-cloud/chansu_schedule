import { db } from '../db/database';
import { getSettings, updateSettings } from '../db/doseRepository';
import { useLiveQuery } from '../lib/useLiveQuery';
import { PageHeader } from '../components/PageHeader';
import { Chip } from '../components/Form';

const CUTOFFS = [
  { value: '00:00', label: '사용 안 함' },
  { value: '01:00', label: '새벽 1시' },
  { value: '02:00', label: '새벽 2시' },
  { value: '03:00', label: '새벽 3시' },
  { value: '04:00', label: '새벽 4시' },
  { value: '05:00', label: '새벽 5시' },
];

export function RecordSettingsPage() {
  const settings = useLiveQuery(() => getSettings(db));
  if (!settings) return null;
  return (
    <>
      <PageHeader title="자정 넘김 설정" back={{ page: 'more' }} />
      <section class="card">
        <h2>하루가 바뀌는 시각</h2>
        <p class="muted">
          이 시각 전까지는 전날로 봅니다. 예를 들어 새벽 3시로 정하면, 새벽 1시에 연 오늘 화면은 어제 날짜이고 취침 전 약을
          그대로 체크할 수 있습니다.
        </p>
        <div class="chips" role="radiogroup" aria-label="하루가 바뀌는 시각">
          {CUTOFFS.map((c) => (
            <Chip
              key={c.value}
              selected={settings.lateNightCutoff === c.value}
              onClick={() => updateSettings(db, { lateNightCutoff: c.value })}
            >
              {c.label}
            </Chip>
          ))}
        </div>
      </section>
    </>
  );
}
