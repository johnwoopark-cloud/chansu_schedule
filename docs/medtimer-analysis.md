# MedTimer 소개와 역설계 분석, 추가 기능 제안

> 분석 기준: MedTimer GitHub `main` 브랜치, 커밋 `1df2439` (2026-10-20), DB 스키마 버전 26.
> 라이선스가 MIT라서 소스 열람·수정·재배포가 모두 허용된다.

## 1. MedTimer 소개

| 항목 | 내용 |
|---|---|
| 정체 | 오픈소스 복약 관리 Android 앱. 개발자 Florian Fetz(독일), MIT 라이선스 |
| 설치 | F-Droid, IzzyOnDroid, Google Play, GitHub Releases APK |
| 가격 | 무료, 광고 없음 |
| 개인정보 | 모든 데이터를 폰 안 DB에만 저장. 인터넷 권한 없이 동작 |
| 변형판 | **FOSS**(F-Droid용, Google 서비스 없음)와 **full**(Play용, 위치 기반 다시 알림 포함). 그 외 기능은 같다 |
| 개발 상태 | 활발함. 2026-10 기준 커밋이 꾸준하고, 단위 테스트와 정적 분석(Sonar, OpenSSF)을 적용 |
| 한국어 | **번역 없음.** 지원 언어 26개 중 한국어가 빠져 있다(중국어·일본어 계열은 중국어만 있음). 기기 언어가 한국어이면 영어로 나온다 |

### 1.1 화면 구성 (하단 탭 3개)
1. **Overview(개요)** – 날짜별로 예정·완료된 복용 목록을 보여 준다. 아이콘을 눌러 복용함/건너뜀으로 바꾸고, 내용을 눌러 수정한다. "추가 복용 기록" 버튼이 있다.
2. **Medicine(약)** – 약 목록. 약마다 복용 알림 여러 개, 재고, 태그, 색·아이콘, 메모, 유효기간을 설정한다. 약별 예정 달력도 볼 수 있다.
3. **Analysis(분석)** – 세 가지 보기
   - 차트: 복용/건너뜀 원형 그래프, 날짜별 약 막대 그래프(기간 1·2·3·7·14·30일)
   - 표: 복용 기록을 정렬·필터
   - 달력: 월간 달력에 날짜별 기록 표시
   - (선택) 반감기를 입력하면 몸속 약물 농도 추정 그래프

### 1.2 주요 기능
- 일정: 매일, 요일 지정, N일 복용 후 M일 휴약(피임약 등), 매월 특정일, 기간 한정, 간격 반복(예: 6시간마다), 다른 알림에 연결("A 먹고 30분 뒤 B")
- 알림: 다시 알림, 반복 알림, 무음 모드에서도 울리는 알람형, 주말 모드(정한 요일에 늦게)
- 재고: 현재 수량과 리필 크기 입력 → 복용할 때마다 자동 차감 → 소진 예상일 계산 → 부족·소진 알림. "지금 리필" 버튼
- 유효기간 경과 알림
- 내보내기: 복용 기록 CSV·PDF, 약 목록 JSON 백업/복원, 폴더 지정 자동 백업
- 태그로 약 묶기(여러 사람 약을 태그로 나눠 관리하는 용도로도 씀)

## 2. 역설계: 내부 구조

### 2.1 모듈 구성
```text
app/                 앱 진입점, 화면 연결
core/database        Room(SQLite) DB, DAO, 백업 매핑
core/domain          도메인 모델(Medicine, Reminder, ReminderEvent…)
core/datastore       설정값 저장
core/ui, core/common 공통 UI, 유틸
core/location        위치 기반 다시 알림(full 변형만)
feature/reminders    일정 계산, 알림 발생, 재고 차감, 리필 처리
feature/ui           개요·약·분석 화면
```
Kotlin, Hilt(의존성 주입), Room, 일부 화면은 Jetpack Compose로 옮기는 중이다.

### 2.2 데이터 모델 (테이블 4개 + 연결 1개)

```text
Medicine (약)
  medicineId, medicineName, notes, color, useColor, iconId, sortOrder
  amount, unit            ← '현재 재고'와 그 단위(약 함량이 아님)
  refillSizes[]           ← 리필 한 번에 늘어나는 양
  productionDate, expirationDate
  halfLifeHours, timeToPeakHours   ← 농도 그래프용
  cannotBeSkipped, showNotificationAsAlarm, notificationImportance

Reminder (복용 일정) — 약 1개에 여러 개
  reminderId, medicineRelId → Medicine
  timeInMinutes           ← 하루 중 시각(분)
  amount: String          ← 1회 복용량 "1정" 같은 자유 문자열. 재고 계산은 첫 숫자만 읽음
  days[7]                 ← 요일
  consecutiveDays, pauseDays, cycleStartDay   ← N일 복용·M일 휴약
  activeDaysOfMonth(비트마스크), periodStart, periodEnd
  linkedReminderId, interval*, windowedInterval
  automaticallyTaken, variableAmount, instructions, active
  outOfStockThreshold, outOfStockReminderType, expirationReminderType

ReminderEvent (복용 기록)
  reminderEventId, reminderId, reminderType
  medicineName, amount, color, iconId, tags[]   ← 당시 값을 복사해 둠(스냅샷)
  status: RAISED | TAKEN | SKIPPED | ACKNOWLEDGED | DELETED
  remindedTimestamp(예정 시각), processedTimestamp(처리 시각)
  stockBefore, stockAfter, stockUnit, stockHandled
  notes, remainingRepeats, notificationId

Tag, MedicineToTag   ← 약-태그 다대다
```

`reminderType` 종류: `TIME_BASED`, `LINKED`, `CONTINUOUS_INTERVAL`, `WINDOWED_INTERVAL`, `OUT_OF_STOCK`, `EXPIRATION_DATE`, `REFILL`

### 2.3 동작 방식에서 눈여겨볼 점
- **기록은 알림이 만든다.** 예정 시각에 알림이 뜨면서 `RAISED` 이벤트가 생기고, 사용자가 누르면 `TAKEN`/`SKIPPED`로 바뀐다. 미래 일정은 DB에 저장하지 않고 그때그때 계산(시뮬레이션)해서 보여 준다.
- **스냅샷 방식**: 이벤트에 약 이름·용량·색을 복사해 두므로, 나중에 약 정보를 바꾸거나 지워도 과거 기록이 그대로 남는다.
- **재고 소진일**: 앞으로 28일(기본값)의 일정을 시뮬레이션해서 재고가 0이 되는 날을 계산한다(`SimulatedRemindersRepository.stockRunOutDates`). 다만 약 목록 화면에는 아직 표시하지 않는다(Compose 전환 후로 미뤄 둠).
- **리필**(`RefillProcessor`): 재고에 `refillSize`를 더하고 "10정 ➡ 40정" 형태의 `REFILL` 이벤트를 남긴다. **언제·어디서·며칠분을 받았는지는 저장하지 않는다.**
- **일괄 복용**: 같은 시각 알림이 여러 개면 알림에 "All taken" 버튼이 있다. 개요 화면에는 복용 시기 단위 묶음이 따로 없다.

## 3. 원하는 기능과 비교

| 원하는 기능 | MedTimer | 차이 |
|---|---|---|
| 약 이름 | ○ | – |
| 용량(함량) | △ | 함량 칸이 없음. 1회 복용량이 자유 문자열이고 `unit`은 재고 단위 |
| 먹는 시기 | ○ | 시각 단위. "아침/점심/저녁/취침" 같은 시기 개념은 없음 |
| 약 받아 온 날 기록 | ✗ | 리필 버튼만 있고 날짜·병원·약국·처방 일수 기록 없음 |
| 날짜·시기별 복용 체크 | ○ | 개요 화면에서 가능. 시기 묶음 일괄 체크는 알림에서만 됨 |
| 알림(선택) | ○ | 오히려 강점. 알림을 포기할 필요가 없음 |
| 기기 안에만 저장 | ○ | – |
| 한국어 | ✗ | 번역 없음 |

## 4. 추가하면 좋을 기능

우선순위 순서. 난이도는 MedTimer 코드에 직접 넣는다고 가정했다.

| # | 기능 | 내용 | 손댈 곳 | 난이도 |
|---|---|---|---|---|
| 1 | **한국어 번역** | `values-ko/strings.xml` 추가. 원 프로젝트가 Weblate로 번역 기여를 받으므로 그대로 기여하면 된다 | 리소스만 | 하 |
| 2 | **조제 기록(받아 온 약)** | 새 `Prescription` 테이블: 받은 날, 병원, 약국, 처방 일수, 메모, 포함된 약과 수량. 저장하면 각 약 재고를 늘리고, 처방 일수로 일정의 `periodStart/periodEnd`를 자동 설정한다 | DB(스키마 27, 마이그레이션), `RefillProcessor`, 약 화면에 조제 이력 탭 | 중 |
| 3 | **복용 시기 묶음** | "아침 08:00 / 점심 / 저녁 / 취침" 시기를 정의하고 일정이 시기를 참조하게 한다. 개요 화면에 시기 카드를 두고 한 번 눌러 전체 복용 처리 | 새 `Slot` 테이블, `Reminder.slotId`, 개요 화면 그룹 헤더에 "모두 복용" | 중 |
| 4 | **함량 입력칸** | `Medicine`에 `strength`, `strengthUnit`(예: 10 mg) 추가. 목록·PDF에 "이름 10mg 1정"으로 표시 | DB, 약 편집 화면, 내보내기 | 하 |
| 5 | **약봉투 단위 재고** | 국내 약국은 시기별로 한 봉지에 여러 약을 담아 준다. 시기(#3)에 "봉지 재고"를 두고, 그 시기를 체크하면 봉지가 하나 줄어든다. 약별 재고보다 실제와 잘 맞는다 | #3에 이어서 | 중 |
| 6 | **소진 예상일 표시** | 이미 계산하는 `stockRunOutDates`를 약 목록과 개요 상단에 "○일분 남음 · ○월 ○일 소진"으로 표시. 다음 진료 예약을 잡는 기준이 된다 | UI만 | 하 |
| 7 | **진료용 요약 PDF** | 현재 복용 중인 약(이름·함량·용법), 최근 조제일, 최근 30일 복용률을 한 장에. 기존 PDF 내보내기 코드를 재사용 | 내보내기 | 중 |
| 8 | **기록 전용 모드** | 알림을 끄고도 그날의 예정 항목이 개요에 미체크로 생기게 한다. 지금은 알림이 이벤트를 만들기 때문에 알림을 끄면 체크할 항목이 안 생길 수 있다(실제 기기에서 확인 필요) | 일정 처리 | 중 |
| 9 | **약봉투·처방전 사진 첨부** | 조제 기록에 사진을 붙여 앱 내부 저장소에 보관한다(인식 기능 없이 보관만). 기기 밖으로 나가지 않음 | 조제 화면, 백업에 포함 여부 결정 | 중 |
| 10 | **복용 메모/부작용 기록** | 이벤트에 `notes`가 이미 있으므로, 개요에서 바로 "어지러움" 같은 증상 태그를 고르게 한다 | UI | 하 |

## 5. 진행 방법 제안

| 방법 | 장점 | 단점 |
|---|---|---|
| **A. MedTimer 포크 후 기능 추가 (권장)** | 일정·재고·분석·백업이 이미 완성되어 있음. 알림도 덤으로 생김. #1·#4·#6은 원 프로젝트에 PR로 기여 가능 | Kotlin/Android 개발 환경 필요. 원 프로젝트를 따라가려면 병합 작업이 계속 필요 |
| B. 앞서 기획한 웹앱(PWA)을 처음부터 제작 | 단순하고 이 저장소 안에서 끝남 | MedTimer가 이미 하는 일을 다시 만드는 셈 |
| C. MedTimer를 그대로 쓰고, 부족한 조제 기록만 웹앱으로 | 개발량이 가장 적음 | 앱 두 개를 오가야 함 |

A로 간다면 순서는 다음과 같다.
1. 한국어 번역(#1)을 원 프로젝트에 기여한다. 혼자 쓰더라도 가장 효과가 크다.
2. 포크에 조제 기록(#2)과 복용 시기 묶음(#3)을 넣는다.
3. 함량(#4)과 소진일 표시(#6)는 원 프로젝트에도 쓸모가 있으므로 업스트림 PR로 제안한다.

## 참고
- 소스: <https://github.com/Futsch1/medTimer>
- F-Droid: <https://f-droid.org/ko/packages/com.futsch1.medtimer/>
- 도움말: <https://github.com/Futsch1/medTimer/tree/main/docs/help>
- 번역(Weblate): <https://hosted.weblate.org/projects/medtimer/>
