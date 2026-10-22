# 복약 기록 웹앱 기획안 (v2)

## 0. 확정된 조건

| 항목 | 결정 |
|---|---|
| 사용 기기 | Android 폰만 (Chrome에서 홈 화면에 설치하는 PWA) |
| 알림 | **넣지 않음.** 앱을 열었을 때 화면에서 미복용을 확인 |
| 사용자 | 본인 1명 (가족 관리 없음) |
| 저장소 | 이 저장소(`chansu_schedule`)의 `web/` 폴더 |
| 데이터 위치 | 폰 브라우저 안(IndexedDB)에만 저장. 서버·계정·동기화 없음 |

## 1. 벤치마크

### 1.1 조사한 앱

| 앱 | 유형 | 데이터 저장 | 참고할 점 | 우리와 다른 점 |
|---|---|---|---|---|
| **MedTimer** (F-Droid, MIT 오픈소스) | Android 네이티브 | 기기 안에만, 인터넷 불필요 | 약별 일정(요일·휴약기), 복용 확인/건너뜀, 기록을 표·차트·달력으로 보기, **재고 추적과 소진 경고**, **유효기간 경고**, 기록 CSV 내보내기, 약 목록 JSON 백업, 태그 | 알림이 중심. "약을 받아 온 날" 기록은 없고 재고 숫자만 관리 |
| **Dosezy** (F-Droid, MIT) | Android 네이티브 | 오프라인, 계정 없음, 기기 안 암호화 | "개인정보 우선"을 전면에 내세움 | 기능 정보는 적음 |
| **Medisafe** | 상용, 클라우드 | 계정·서버 | 홈 화면에서 복용함 ✓ / 건너뜀 ✗ 표시, 주·월·연 단위 복용 통계, 남은 알약 수로 리필 시점 계산, 의사에게 보낼 PDF 리포트 | 클라우드 저장. 2026년 기준 많은 국가에서 전체 기능이 유료 |
| **MyTherapy** | 상용, 클라우드 | 계정·서버 | 매 회차 복용/건너뜀과 메모 기록, 인쇄용 PDF 건강 리포트, 리필 알림을 복용 알림과 따로 관리 | 클라우드 저장. 직접 입력할 때 약 함량 입력칸이 부족하다는 리뷰 |
| **아이약** (국내) | 상용, 클라우드 | 서버 | **처방전·약봉투 사진으로 약 등록**, 처방 기간이 남은 약을 "복용 중"으로 자동 분류, DUR 병용 확인, 복용 달력 | 사진 인식과 DUR 조회는 서버가 필요 |
| **약톡 / 약 기억하기** (국내) | 상용 | 서버 | 복용/미복용/건너뜀 3단계 체크, 이력 달력, 재고 알림 | 가족 모니터링 중심 |

### 1.2 시사점

1. **MedTimer가 원하는 기능의 대부분을 이미 오프라인으로 제공한다.** 직접 만들 이유는 다음 세 가지다.
   - 국내 조제 방식에 맞추기: 약국에서 **복용 시기별로 한 봉지에 여러 약을 묶어 N일분**을 준다
   - "언제 약을 받아 왔는지"를 1급 데이터로 다루기
   - 알림 없이 기록에만 집중한 단순한 화면
   → 만들기 전에 MedTimer를 며칠 써 보고 부족한 점을 확인하는 것을 권한다.
2. **필수 기능**: 시기 단위 한 번에 체크(Medisafe·MedTimer), 복용/건너뜀/미체크 3단계(약톡), 달력 이력(공통), 남은 양 계산(MedTimer·Medisafe), 진료 때 보여 줄 요약(MyTherapy·Medisafe PDF, MedTimer CSV).
3. **제외 기능**: 사진 인식 등록, DUR 조회(서버나 외부 API 필요), 가족 관리, 알림, 혈압 등 건강 측정 기록.
4. **약 함량은 꼭 따로 입력받는다**(MyTherapy의 약점). 이름 / 함량(예: 10mg) / 1회 복용량(예: 1정)을 구분한다.

## 2. 핵심 기능

### 2.1 약 등록
- 이름, 함량(숫자 + 단위: mg, mcg, mL…), 1회 복용량(숫자 + 단위: 정, 캡슐, 포, mL), 메모(식전·식후·주의사항)
- 복용 시기: 아침 / 점심 / 저녁 / 취침 전 + 직접 추가. 시기마다 기준 시각(예: 아침 08:00)을 정하고 화면 정렬과 "시간 지남" 표시에 사용
- 주기: 매일 / 요일 지정 / N일마다 / 필요할 때(PRN)
- 상태: 복용 중 / 중단(종료일 기록, 지난 기록은 보존)

### 2.2 약 받아 온 기록 (처방·조제)
- 받은 날짜, 병원/약국(선택), 처방 일수 또는 개수, 포함된 약(여러 개 선택), 메모
- **처방 묶음**: 한 번 받아 온 약을 하나의 묶음으로 저장한다. 묶음에 포함된 약은 처방 기간 동안 자동으로 "복용 중"이 된다(아이약 방식)
- **남은 양**: 받은 양 − 복용 체크한 양 → "약 N일분 남음". 며칠 안 남으면 오늘 화면 상단에 표시(알림 대신)
- 예상 소진일: 오늘 + 남은 일수

### 2.3 복용 체크
- **오늘 화면(첫 화면)**: 복용 시기별 카드
  - 카드를 한 번 눌러 그 시기의 약 전체를 "복용함"으로 처리. 약별로도 체크 가능
  - 상태: 복용함 / 건너뜀(사유 선택) / 미체크. 기준 시각이 지난 미체크 카드는 강조 표시
  - 복용 시각 자동 기록, 수정 가능
  - 실수로 누른 체크를 바로 되돌리는 실행 취소
- **달력 화면**: 날짜별 색 표시(모두 복용 / 일부 / 미복용 / 기록 없음)
  - 날짜를 누르면 시기별 상세. 지난 날짜도 체크·수정 가능
- **취침 전 약 자정 넘김**: 새벽 3시 전까지는 "전날 취침 전"으로 기록하는 옵션

### 2.4 통계·요약
- 주간·월간 복용률(%), 약별 복용률
- **진료용 요약 화면**: 복용 중인 약 목록(이름·함량·용법), 최근 30일 복용률, 최근 조제일. 진료실에서 화면을 보여 주거나 인쇄(브라우저 PDF 저장)

### 2.5 백업
- 전체 데이터 JSON 내보내기/가져오기(Android 다운로드 폴더에 저장)
- 선택: 비밀번호 암호화 백업(WebCrypto AES-GCM)
- 복용 기록 CSV 내보내기(MedTimer 방식)
- 마지막 백업 후 30일이 지나면 오늘 화면에 "백업하세요" 안내

## 3. 화면 구성

```text
[하단 탭]  오늘 | 달력 | 약 | 조제 | 더보기

오늘    : 날짜, 시기별 카드(아침/점심/저녁/취침), 남은 약 경고, 백업 안내
달력    : 월간 달력 + 날짜 상세 시트
약      : 복용 중 / 중단 목록, 약 추가·편집
조제    : 받아 온 기록 목록(최신순), 추가 시 포함 약 선택, 약별 남은 양
더보기  : 통계, 진료용 요약, 복용 시기 설정, 백업/복원, 앱 정보
```

- 한 손 조작이 쉽도록 큰 터치 영역과 하단 탭
- 시스템 설정에 따른 다크 모드

## 4. 데이터 모델 (IndexedDB)

```text
slots          id, label("아침"), time("08:00"), order
medications    id, name, strength, strengthUnit, doseQty, doseUnit, notes,
               frequency{type, weekdays?, everyN?}, slotIds[],
               startDate, endDate?, active
refills        id, receivedDate, place?, days?, notes,
               items[{ medicationId, quantity }]
doseLogs       id, date, slotId, medicationId, status(taken|skipped),
               takenAt?, reason?, doseQtySnapshot
               인덱스: date, [date+slotId], medicationId
settings       lateNightCutoff("03:00"), lowStockDays(5), lastBackupAt
```

- "미복용"은 저장하지 않는다. 일정상 먹어야 하는데 `doseLogs`에 기록이 없으면 미복용으로 계산한다
- `doseQtySnapshot`: 나중에 용량을 바꿔도 과거 기록이 그대로 남도록 체크할 때의 용량을 같이 저장한다

## 5. 기술 구성

| 항목 | 선택 | 이유 |
|---|---|---|
| 앱 형태 | PWA (Android Chrome에서 "홈 화면에 추가") | 설치·업데이트가 간단하고 오프라인 동작 |
| 프레임워크 | Vite + Preact + TypeScript | 작은 번들, 빌드 결과가 정적 파일 |
| 저장 | IndexedDB(Dexie.js) + `navigator.storage.persist()` | 브라우저가 데이터를 임의로 지우지 않도록 요청 |
| 오프라인 | vite-plugin-pwa(Service Worker) | 첫 설치 후 네트워크 불필요 |
| 외부 요청 | 없음. 폰트·아이콘 모두 번들 | 개인정보 |
| 배포 | GitHub Pages(GitHub Actions로 `web/` 빌드 후 배포) | 서버 없이 HTTPS 제공. Service Worker는 HTTPS가 필요하다 |

### 저장소 구조

```text
chansu_schedule/
├─ deadlines.csv, notify.py          # 기존 학사일정 알림(그대로 둠)
├─ .github/workflows/
│  ├─ notify.yml                     # 기존
│  └─ deploy-web.yml                 # 신규: web/ 빌드 → GitHub Pages
├─ docs/medication-tracker-plan.md   # 이 문서
└─ web/                              # 신규 복약 앱
   ├─ index.html, vite.config.ts, package.json
   └─ src/ (db/, pages/, components/, lib/)
```

> GitHub Pages로 올라가는 것은 **앱 코드뿐**이고 복약 데이터는 폰 안에만 있다.
> 저장소가 private이면 GitHub Pages에 유료 플랜이 필요하다. 저장소를 public으로 두는 것도 괜찮다(코드에는 개인정보가 없다).
> **약 이름 등 개인 데이터는 절대 저장소에 커밋하지 않는다.** 예시 데이터는 가짜로 만든다.

## 6. 개발 단계

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| 1 | 프로젝트 골격, PWA 설치, 복용 시기 설정, 약 등록/편집 | 폰에 설치하고 비행기 모드에서 실행됨 |
| 2 | 오늘 화면 체크(시기 일괄·약별·건너뜀·취소), 자정 넘김 처리 | 하루치 기록 완료 |
| 3 | 달력 화면, 지난 날짜 수정 | 한 달 기록 확인 |
| 4 | 조제 기록, 처방 묶음, 남은 양·소진일 | 남은 일수가 실제 남은 약과 일치 |
| 5 | 백업/복원(JSON, 암호화), CSV 내보내기 | 앱을 지웠다 다시 깔아도 복원 성공 |
| 6 | 통계, 진료용 요약·인쇄 | 진료 때 한 화면으로 보여 줄 수 있음 |

## 7. 위험 요소와 대응

- **데이터 유실(캐시 삭제, 앱 삭제)**: 영구 저장 요청, 홈 화면 설치, 백업 안내, 가져오기 기능으로 대응
- **알림이 없어 잊을 수 있음**: 알림을 포기한 대신, 매일 같은 시간에 울리는 Android 시계 알람이나 기본 캘린더 반복 일정을 따로 쓰는 것을 권장. 앱은 기록에 집중한다
- **의료 정보**: 앱은 기록 도구이며 복용 방법은 처방과 약사 안내를 따른다는 문구 표시

## 8. 참고 자료

- MedTimer: <https://github.com/Futsch1/medTimer>, <https://f-droid.org/ko/packages/com.futsch1.medtimer/>
- Dosezy: <https://apt.izzysoft.de/fdroid/index/apk/com.saad2134.dosezy?repo=main>
- Medisafe: <https://apps.apple.com/app/id573916946>, <https://healthify.nz/apps/m/medisafe-meds-pill-reminder-app>
- MyTherapy: <https://healthify.nz/mytherapy-meds-pill-reminder-app>, <https://lab.mytherapyapp.com/>
- Medisafe 유료화: <https://pillo.care/blog/medisafe-no-longer-free-best-free-alternatives>
- 아이약: <https://mwm.ai/apps/app/6467175742>
- 약톡: <https://apps.apple.com/kr/app/id1571149780>
- 약 기억하기: <https://apps.apple.com/us/app/id1615675324>
