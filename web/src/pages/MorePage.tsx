import { useEffect, useState } from 'preact/hooks';
import { PageHeader } from '../components/PageHeader';
import { Icon, type IconName } from '../components/Icon';
import { formatBytes, getStorageStatus, requestPersistentStorage, type StorageStatus } from '../lib/storage';
import { canPromptInstall, isStandalone, onInstallStateChange, promptInstall } from '../lib/install';
import { href } from '../router';

const LINKS: { page: 'slots' | 'symptoms' | 'record-settings'; label: string; icon: IconName }[] = [
  { page: 'slots', label: '복용 시기 설정', icon: 'clock' },
  { page: 'symptoms', label: '증상 태그 관리', icon: 'tag' },
  { page: 'record-settings', label: '자정 넘김 설정', icon: 'today' },
];

const UPCOMING: { label: string; stage: number }[] = [
  { label: '내보내기 (CSV · PDF · 진료용 요약)', stage: 7 },
  { label: '백업 / 복원', stage: 7 },
  { label: 'PIN 잠금', stage: 8 },
  { label: '도움말', stage: 8 },
];

export function MorePage() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [installable, setInstallable] = useState(canPromptInstall());

  useEffect(() => {
    getStorageStatus().then(setStatus);
    return onInstallStateChange(() => setInstallable(canPromptInstall()));
  }, []);

  return (
    <>
      <PageHeader title="더보기" />

      <ul class="menu">
        {LINKS.map((link) => (
          <li key={link.page}>
            <a href={href({ page: link.page })}>
              <Icon name={link.icon} />
              <span>{link.label}</span>
              <Icon name="chevron" size={20} />
            </a>
          </li>
        ))}
        {UPCOMING.map((item) => (
          <li key={item.label} class="disabled" aria-disabled="true">
            <span class="menu-label">{item.label}</span>
            <span class="badge muted">{item.stage}단계</span>
          </li>
        ))}
      </ul>

      <section class="card">
        <h2>데이터 저장</h2>
        <p class="muted">모든 기록은 이 기기의 브라우저 안에만 저장되며, 어디로도 전송되지 않습니다.</p>
        <dl class="facts">
          <dt>영구 저장</dt>
          <dd>
            {status?.persisted === true && '허용됨'}
            {status?.persisted === false && (
              <button
                type="button"
                class="button small"
                onClick={async () => {
                  await requestPersistentStorage();
                  setStatus(await getStorageStatus());
                }}
              >
                요청하기
              </button>
            )}
            {status && status.persisted === null && '지원 안 함'}
          </dd>
          <dt>사용량</dt>
          <dd>{status?.usageBytes != null ? formatBytes(status.usageBytes) : '-'}</dd>
          <dt>앱 설치</dt>
          <dd>
            {isStandalone() ? (
              '설치됨'
            ) : installable ? (
              <button type="button" class="button small" onClick={() => promptInstall()}>
                홈 화면에 설치
              </button>
            ) : (
              'Chrome 메뉴 → 홈 화면에 추가'
            )}
          </dd>
        </dl>
      </section>

      <p class="app-version">복약 기록 v{__APP_VERSION__}</p>
    </>
  );
}
