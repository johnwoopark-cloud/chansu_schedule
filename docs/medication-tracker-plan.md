# 복약 기록 웹앱 기획안 (v3)

MedTimer(오픈소스 Android 복약 앱)의 기능을 모두 웹앱으로 옮기고, 분석 단계에서 정한 추가 기능 10개를 더한다.
MedTimer 분석 내용은 [`medtimer-analysis.md`](medtimer-analysis.md)에 있다.

## 0. 확정된 조건

| 항목 | 결정 |
|---|---|
| 형태 | 웹앱(PWA). Android Chrome에서 홈 화면에 설치해서 사용 |
| 기기 | Android 폰만 |
| 알림 | **넣지 않음.** MedTimer의 알림 기능은 "앱 화면 안의 표시"로 바꾼다(3장) |
| 사용자 | 본인 1명 |
| 저장소 | 이 저장소(`chansu_schedule`)의 `web/` 폴더 |
| 데이터 | 폰 브라우저 안(IndexedDB)에만 저장. 서버·계정·동기화·외부 요청 없음 |
| 언어 | 한국어 UI (MedTimer에 없는 부분) |

## 1. 기능 목록

표기: **[MT]** MedTimer에서 가져온 기능 / **[신규]** 추가 기능 / **[대체]** 알림 기능을 화면 표시로 바꾼 것

### 1.1 약
- [MT] 약 이름, 메모, 색(선택 사용), 아이콘, 정렬 순서
- [신규] **함량**(숫자 + 단위: mg, mcg, g, mL, IU, %)과 1회 복용량(숫자 + 단위: 정, 캡슐, 포, mL, 방울)을 따로 입력
- [MT] 재고 수량과 재고 단위, 리필 크기(여러 개 등록 가능)
- [MT] 제조일, 유효기간
- [MT] 반감기(시간), 최고 농도 도달 시간(시간) → 체내 농도 추정 그래프에 사용
- [MT] "건너뛸 수 없음" 표시(필수 약)
- [MT] 태그 붙이기와 태그 필터
- [MT] 약 전체 일정 일시정지/재개(설정은 보존)

### 1.2 복용 시기 [신규]
- 아침 / 점심 / 저녁 / 취침 전 기본 제공, 이름·시각 수정과 시기 추가 가능
- 일정은 **시기를 지정**하거나 **직접 시각을 지정**할 수 있다. 시기의 시각을 바꾸면 그 시기를 쓰는 일정이 모두 따라 바뀐다
- [신규] **약봉투 재고**: 시기별로 "봉지 몇 개 남음"을 관리한다. 시기를 체크하면 봉지가 하나 줄어든다. 약국에서 시기별로 묶어 준 약에 맞춘 방식

### 1.3 복용 일정 (MedTimer 일정 유형 전체)
- [MT] **시각 기반**: 정한 시각(또는 시기)에 복용
  - 요일 지정, 매월 특정일 지정(비어 있으면 제한 없음)
  - 기간 한정(시작일·종료일)
  - 주기: N일 복용 후 M일 휴약, 주기 시작일 지정(피임약 등)
- [MT] **연속 간격**: N시간마다. 다음 시각을 "예정 시각 기준" 또는 "실제 체크한 시각 기준"으로 계산하는 옵션
- [MT] **시간대 간격**: 하루 중 시작~종료 시각 사이에서 N시간마다(예: 09~21시, 4시간마다)
- [MT] **연결 일정**: 앞 일정을 체크한 뒤 X분 후(최대 24시간, 여러 단계 연결 가능). 예: "A 먹고 30분 뒤 B"
- [MT] 1회 복용량을 체크할 때 직접 입력하는 옵션(변동 용량)
- [MT] 자동 복용 처리(기록용. 실제 복용 확인이 아님을 화면에 표시)
- [MT] 복용 안내 문구(식후 30분 등)
- [MT] 주말 모드: 선택한 요일에 예정 시각을 정한 시각으로 늦춤
- [MT] 일정별 활성/비활성
- [MT] 약별 일정 미리보기 달력

### 1.4 오늘 화면과 복용 체크
- [MT] 날짜별 목록: 예정 항목, 완료 항목, 추가 복용, 재고 변경 기록(표시 옵션)
- [신규] **시기 카드**: 시기별로 묶어 보여 주고, 카드를 한 번 눌러 전체를 "복용함" 처리 (MedTimer의 "All taken"을 화면으로 가져옴)
- [MT] 항목별 상태: 미체크 → 복용함 / 건너뜀. 아이콘을 눌러 상태 변경, 내용을 눌러 상세 수정(시각, 용량, 메모)
- [MT] **추가 복용 기록**: 예정에 없던 복용을 약·용량을 골라 기록(비활성 일정을 프리셋으로 사용 가능), 날짜 변경 가능
- [MT] 상태 필터, 태그 필터
- [신규] **기록 전용 방식**: 예정 항목은 알림 없이 그날 화면에 자동으로 "미체크"로 나타난다
- [신규] 실수로 누른 체크를 바로 되돌리는 실행 취소
- [신규] 자정 넘김 처리: 새벽 3시(설정 가능) 전 체크는 전날로 기록하는 옵션
- [신규] **복용 메모와 증상 기록**: 체크할 때 메모나 증상 태그(어지러움, 속쓰림 등, 직접 추가 가능)를 남김

### 1.5 재고와 조제
- [MT] 복용 체크 시 재고 자동 차감(복용량 숫자 기준), 체크 취소 시 복구. 기록에 차감 전·후 재고를 남김
- [MT] "지금 리필" 버튼(리필 크기만큼 증가, 리필 기록 남김)
- [MT] 재고 기준값(이 수량 이하가 되면 경고)
- [MT] **소진 예상일**: 앞으로의 일정을 계산해서 재고가 0이 되는 날을 구함(기본 28일, 필요하면 더 길게)
- [신규] **소진일 표시**: 약 목록과 오늘 화면 상단에 "○일분 남음 · ○월 ○일 소진"
- [신규] **조제 기록(받아 온 약)**: 받은 날, 병원, 약국, 처방 일수, 메모, 포함된 약과 수량
  - 저장하면 각 약 재고가 늘어나고, 처방 일수로 일정의 시작일·종료일을 자동으로 채우는 옵션
  - 약국에서 시기별로 묶어 준 경우, 시기별 봉지 수를 같이 입력
- [신규] **약봉투·처방전 사진 첨부**: 조제 기록에 사진을 붙여 브라우저 저장소에 보관(글자 인식 없음, 기기 밖으로 나가지 않음)

### 1.6 분석
- [MT] **차트**: 복용/건너뜀 원형 그래프(선택 기간과 전체), 날짜별 약 누적 막대 그래프. 기간 1·2·3·7·14·30일. 약 색 지정 시 그 색 사용
- [MT] **기록 표**: 복용 시각, 약 이름, 용량, 예정 시각. 열 정렬, 태그 필터
- [MT] **달력**: 월간 달력에 날짜별 기록 표시, 약 하나를 골라 필터, 날짜 상세 보기
- [MT] **체내 농도 추정 그래프**: 반감기·최고 농도 시간을 입력한 약만. 복용 기록으로 1구획 1차 흡수 모델(Bateman 식)을 계산해 추정 곡선을 그림. "참고용 추정치"라고 표시
- [MT] 마지막에 본 분석 화면과 기간을 기억
- [신규] 주간·월간 복용률(%)과 약별 복용률

### 1.7 내보내기·백업
- [MT] 복용 기록 CSV 내보내기
- [MT] 복용 기록 PDF 내보내기
- [MT] 약 목록 JSON 백업/복원 → **전체 데이터**(약, 일정, 시기, 기록, 조제, 설정)로 확장
- [MT 대체] 자동 백업: Android 브라우저는 폴더에 자동 저장할 수 없으므로, 백업 주기가 지나면 오늘 화면에 "백업하기" 버튼을 띄우고 한 번 눌러 다운로드 폴더에 저장
- [신규] **진료용 요약 PDF**: 현재 복용 중인 약(이름·함량·용법), 최근 조제일, 최근 30일 복용률, 최근 증상 메모를 한 장에
- [신규] 비밀번호 암호화 백업(WebCrypto: PBKDF2로 키 생성 → AES-GCM)
- 사진은 용량이 커서 백업에 넣을지 선택하게 한다

### 1.8 보안·기타
- [신규] 앱 실행 시 PIN 잠금(선택)
- [MT] 앱 안 도움말(오프라인)
- 다크 모드(시스템 설정 따름)
- 첫 실행 안내: 홈 화면 설치, 영구 저장 요청, 백업 안내

## 2. 가져오지 않는 MedTimer 기능

| 기능 | 이유 |
|---|---|
| 알림, 다시 알림, 반복 알림, 알람형 알림, 알림 중요도 | 알림을 넣지 않기로 함 |
| 위치 기반 다시 알림 | 알림 기능이고 위치 정보가 필요함 |
| 여러 사람 약을 태그로 관리 | 본인만 사용. 태그 기능 자체는 가져옴 |

## 3. 알림 기능을 화면 표시로 바꾼 것

| MedTimer 알림 | 이 앱에서 |
|---|---|
| 복용 시각 알림 | 오늘 화면에서 시각이 지난 미체크 시기 카드를 빨간색으로 강조 |
| 재고 부족·소진 알림(1회/매번/매일) | 오늘 화면 상단 경고 띠, 약 목록의 재고 배지 |
| 유효기간 경과 알림(1회/매일) | 오늘 화면 경고 띠, 약 목록 배지 |
| 자동 백업 완료 알림 | 마지막 백업 날짜 표시, 주기 경과 시 "백업하기" 버튼 |

## 4. 화면 구성

```text
[하단 탭]  오늘 | 약 | 조제 | 분석 | 더보기

오늘    날짜 이동, 경고 띠(재고·유효기간·백업), 시기 카드, 직접 시각 항목,
        추가 복용 버튼, 필터
약      복용 중 / 일시정지 / 중단 목록(재고·소진일 배지), 태그 필터
        └ 약 상세: 기본 정보, 함량, 재고·리필, 일정 목록, 일정 미리보기 달력, 조제 이력
          └ 일정 편집: 유형 선택 → 기본 설정 → 고급 설정(요일·월일·기간·주기·주말 모드·연결)
조제    받아 온 기록 목록(최신순), 새 조제 등록(약 선택·수량·시기별 봉지·사진)
분석    차트 | 표 | 달력 | 농도  (기간 선택, 태그 필터)
더보기  복용 시기 설정, 증상 태그 관리, 내보내기(CSV·PDF·진료용 요약),
        백업/복원, PIN 잠금, 자정 넘김 설정, 도움말, 앱 정보
```

## 5. 데이터 모델 (IndexedDB)

MedTimer의 Room 스키마(버전 26)를 바탕으로 웹에 맞게 고치고 신규 기능용 테이블을 더한다.

```text
medicines
  id, name, notes, color, useColor, icon, sortOrder, active
  strength, strengthUnit                      [신규] 함량
  stockAmount, stockUnit, refillSizes[], stockThreshold
  productionDate?, expirationDate?
  halfLifeHours?, timeToPeakHours?
  cannotBeSkipped, tagIds[]

slots                                          [신규] 복용 시기
  id, label, time("08:00"), order, packetStock?   ← 약봉투 재고

schedules                                      ← MedTimer Reminder
  id, medicineId, type: TIME | CONTINUOUS_INTERVAL | WINDOWED_INTERVAL | LINKED
  slotId? | timeOfDay?                         ← 시기 또는 직접 시각
  doseQty, doseUnit, variableAmount, autoTaken, instructions, active
  weekdays[7], monthDays(비트마스크), periodStart?, periodEnd?
  cycle { startDate, activeDays, pauseDays }?
  interval { minutes, startAt, fromProcessed }?
  window { start, end }?
  linked { parentScheduleId, delayMinutes }?
  weekendShift { days[], time }?
  sourcePrescriptionId?                        [신규] 조제 기록에서 만든 일정

doseEvents                                     ← MedTimer ReminderEvent
  id, scheduleId?, medicineId, kind: SCHEDULED | EXTRA | REFILL | STOCK_ADJUST
  date("2026-10-22"), slotId?, scheduledAt?, processedAt?
  status: TAKEN | SKIPPED
  snapshot { medicineName, strength, doseQty, doseUnit, color, tags[] }
  stockBefore?, stockAfter?
  note?, symptomIds[]                          [신규]

prescriptions                                  [신규] 조제 기록
  id, receivedDate, hospital?, pharmacy?, days?, note?
  items[{ medicineId, quantity }], packets[{ slotId, count }]
  photoIds[]

photos                                         [신규] id, blob, mimeType, createdAt
tags          id, name
symptoms      id, name                         [신규]
settings      lateNightCutoff, analysisRange, activeAnalysisView,
              backupIntervalDays, lastBackupAt, pinHash?, showStockChanges
```

설계 원칙:
- **미체크 항목은 저장하지 않는다.** 일정 엔진이 날짜별 예정 항목을 계산하고, 기록(`doseEvents`)과 맞춰 본다. 기록이 없으면 미체크다. MedTimer는 알림이 기록을 만들지만, 이 앱은 알림이 없으므로 이 방식이 맞다
- **스냅샷**(MedTimer 방식): 기록에 당시 약 이름·함량·용량을 복사해 두어, 약 정보를 바꾸거나 지워도 과거 기록이 남는다
- 연속 간격·연결 일정은 앞 기록의 실제 체크 시각에 따라 다음 예정이 정해지므로, 일정 엔진이 기록을 읽어 계산한다

## 6. 핵심 로직

| 모듈 | 역할 | MedTimer 대응 |
|---|---|---|
| `schedule-engine` | 일정 + 날짜 범위 → 예정 항목 목록. 요일·월일·기간·주기·간격·연결·주말 모드 처리 | `feature/reminders/scheduling` |
| `day-view` | 예정 항목과 기록을 합쳐 시기별 카드 상태 계산 | Overview |
| `stock` | 체크/취소 시 재고 증감, 봉지 재고, 조제 반영 | `StockHandling`, `RefillProcessor` |
| `run-out` | 일정 엔진으로 미래를 계산해 소진일 산출 | `SimulatedRemindersRepository` |
| `stats` | 복용률, 차트 데이터, 표 데이터 | `StatisticsProvider` 등 |
| `concentration` | 반감기·최고 농도 시간으로 농도 곡선 계산 | 농도 그래프 |
| `backup` | JSON 내보내기/가져오기, 암호화, 버전 이전(마이그레이션) | `BackupRepositoryImpl` |
| `export` | CSV, PDF(브라우저 인쇄 기능으로 PDF 저장) | CSV/PDF 내보내기 |

일정 엔진과 재고 계산은 화면과 분리된 순수 함수로 만들고 단위 테스트를 충분히 붙인다. 날짜 계산이 틀리면 기록 전체가 틀어지기 때문이다.

## 7. 기술 구성

| 항목 | 선택 |
|---|---|
| 빌드 | Vite + TypeScript |
| UI | Preact + 가벼운 CSS(직접 작성) |
| 저장 | IndexedDB(Dexie.js), `navigator.storage.persist()` |
| 오프라인·설치 | vite-plugin-pwa(Service Worker, manifest) |
| 차트 | uPlot 같은 작은 차트 라이브러리를 번들에 포함 |
| 날짜 | date-fns(시간대: 기기 기준) |
| 암호화 | WebCrypto(브라우저 기본 기능) |
| 테스트 | Vitest(일정 엔진·재고·통계), Playwright(주요 화면) |
| 배포 | GitHub Actions로 `web/` 빌드 → GitHub Pages |

외부 CDN, 웹폰트 서버, 분석 도구를 쓰지 않는다. 필요한 파일은 모두 번들에 넣는다.

### 저장소 구조

```text
chansu_schedule/
├─ deadlines.csv, notify.py              기존 학사일정 알림(그대로)
├─ .github/workflows/notify.yml          기존
├─ .github/workflows/deploy-web.yml      신규
├─ docs/                                 기획 문서
└─ web/
   ├─ src/db/          스키마, 마이그레이션
   ├─ src/domain/      schedule-engine, stock, run-out, stats, concentration
   ├─ src/pages/       today, medicines, prescriptions, analysis, more
   ├─ src/components/
   ├─ src/lib/         backup, export, crypto
   └─ tests/
```

> GitHub Pages에는 앱 코드만 올라가고 복약 데이터는 폰 안에만 있다. 저장소가 private이면 Pages에 유료 플랜이 필요하다.
> 약 이름 등 실제 개인 데이터는 저장소에 커밋하지 않는다. 테스트 데이터는 가짜로 만든다.

## 8. 개발 단계

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| 1. 기반 | 프로젝트 골격, PWA 설치, DB 스키마, 하단 탭, 복용 시기 설정 | 폰에 설치, 비행기 모드에서 실행 |
| 2. 약·기본 일정 | 약 등록(함량·재고·유효기간·태그), 시각/시기 일정, 요일·기간 | 약과 일정 등록 |
| 3. 오늘 화면 | 시기 카드 일괄 체크, 항목 체크·수정·취소, 추가 복용, 필터, 자정 넘김 | 하루치 기록 완료 |
| 4. 재고·조제 | 자동 차감, 리필, 소진일, 조제 기록, 약봉투 재고, 경고 띠 | 남은 일수가 실제와 일치 |
| 5. 고급 일정 | 월일·주기·연속 간격·시간대 간격·연결 일정·주말 모드·변동 용량·자동 처리, 일정 미리보기 달력 | MedTimer와 같은 예정 결과 |
| 6. 분석 | 차트, 표, 달력, 복용률, 농도 그래프 | 한 달 기록 분석 |
| 7. 내보내기·백업 | CSV, PDF, 진료용 요약, 전체 백업/복원, 암호화 백업, 백업 안내 | 앱 데이터 지우고 복원 성공 |
| 8. 마무리 | 사진 첨부, 증상 기록, PIN 잠금, 도움말, 다크 모드 | 전체 기능 점검 |

5단계 검증: MedTimer 저장소의 일정 계산 단위 테스트 사례를 참고해 같은 입력에 같은 예정 결과가 나오는지 확인한다(MIT 라이선스이므로 참고 가능, 출처 표기).

## 9. 위험 요소와 대응

- **데이터 유실**: 브라우저 데이터 삭제 시 기록이 사라짐 → 영구 저장 요청, 홈 화면 설치, 정기 백업 안내, 복원 기능
- **사진 용량**: 브라우저 저장 공간 한도 → 첨부할 때 이미지 축소(긴 변 1600px, JPEG), 저장 용량 표시
- **일정 계산 오류**: 주기·간격·연결 일정이 복잡함 → 순수 함수와 단위 테스트, 일정 미리보기 달력으로 사용자가 확인
- **알림 없음**: 잊을 수 있음 → 앱은 기록에 집중하고, 필요하면 Android 시계 알람을 따로 쓰도록 안내
- **의료 정보**: 기록 도구일 뿐이고, 농도 그래프는 참고용 추정치이며, 복용 방법은 처방과 약사 안내를 따른다는 문구 표시

## 10. 참고
- MedTimer: <https://github.com/Futsch1/medTimer> (MIT)
- 벤치마크와 역설계 분석: [`medtimer-analysis.md`](medtimer-analysis.md)
