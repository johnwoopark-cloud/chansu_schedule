# 복약 기록 (웹앱)

내 Android 폰 안에만 기록을 저장하는 복약 기록 PWA. 기획: [`../docs/medication-tracker-plan.md`](../docs/medication-tracker-plan.md)

## 개발

```bash
cd web
npm ci          # .npmrc의 legacy-peer-deps 설정을 사용
npm run dev     # 개발 서버
npm test        # 단위 테스트 (Vitest + fake-indexeddb)
npm run build   # 타입 검사 후 dist/ 생성
```

## 배포와 설치

- `main`에 `web/` 변경이 머지되면 GitHub Actions(`deploy-web.yml`)가 테스트·빌드 후 GitHub Pages에 배포한다.
- 처음 한 번 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿔야 한다.
- 폰 Chrome에서 `https://<사용자>.github.io/chansu_schedule/`을 열고 **홈 화면에 설치**한다.

## 데이터

- 모든 데이터는 브라우저 IndexedDB(`medication-log`)에만 저장된다. 서버나 외부 요청이 없다.
- 실제 복약 데이터를 이 저장소에 커밋하지 않는다.
