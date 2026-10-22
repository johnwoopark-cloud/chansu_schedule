import { useEffect, useState } from 'preact/hooks';
import { canPromptInstall, isStandalone, onInstallStateChange, promptInstall } from '../lib/install';
import { getStorageStatus, requestPersistentStorage } from '../lib/storage';
import { Icon } from './Icon';

/** First-run guidance: install to the home screen and keep data from being evicted. */
export function StorageNotice() {
  const [persisted, setPersisted] = useState<boolean | null>(true);
  const [installable, setInstallable] = useState(canPromptInstall());
  const standalone = isStandalone();

  useEffect(() => {
    getStorageStatus().then((s) => setPersisted(s.persisted));
    return onInstallStateChange(() => setInstallable(canPromptInstall()));
  }, []);

  if (persisted !== false && standalone) return null;
  if (persisted !== false && !installable) return null;

  return (
    <section class="notice" aria-label="저장 안내">
      <Icon name="shield" />
      <div>
        <p class="notice-title">기록을 안전하게 보관하려면</p>
        <p class="notice-body">
          {standalone
            ? '브라우저가 기록을 지우지 않도록 영구 저장을 허용해 주세요.'
            : '홈 화면에 설치하면 앱처럼 열리고, 브라우저가 기록을 지울 가능성이 줄어듭니다.'}
        </p>
        <div class="notice-actions">
          {!standalone && installable && (
            <button type="button" class="button primary small" onClick={() => promptInstall()}>
              홈 화면에 설치
            </button>
          )}
          {persisted === false && (
            <button
              type="button"
              class="button small"
              onClick={async () => setPersisted(await requestPersistentStorage())}
            >
              영구 저장 요청
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
