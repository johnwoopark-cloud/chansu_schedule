/**
 * 우리집 복약·상담대비·상담진료 기록 (Google Apps Script 웹앱)
 *
 * 데이터는 이 스크립트가 붙어 있는 구글 스프레드시트에 저장된다.
 * 접속은 비밀 키(APP_KEY) 방식: 가족 주소(웹앱 URL?k=키)를 한 번 열면 그 폰에 키가 저장된다.
 * 비밀 키는 코드가 아니라 스크립트 속성(Script Properties)에만 저장한다.
 *
 * 처음 설치: setup() 실행 → 웹앱 배포 → showLinks() 실행 (자세한 내용은 설치가이드.md)
 */

const CONFIG = {
  PEOPLE: ['엄마', '아빠', '아이'],
  PRN_REASONS: ['두통', '발열', '기타'],
  PAST_DAYS: 7,                 // 며칠 전 복약까지 나중에 기록할 수 있는지
  LOW_STOCK_DAYS: 7,            // 남은 양이 이 일수 미만이면 화면에 주황색으로 표시
};

const SHEETS = {
  MEDS: {
    name: '약목록',
    headers: ['ID', '약이름', '1회용량', '1회사용량', '단위', '방식', '복용시각', '최소간격(시간)', '남은양', '사용중', '시작일'],
  },
  DOSES: {
    name: '복약기록',
    headers: ['기록ID', '날짜', '예정시각', '실제시각', '약ID', '약이름', '1회용량', '기록자', '구분', '이유', '저장시각'],
  },
  SEIZURES: {
    name: '상담대비기록',
    oldNames: ['경련기록'],  // 예전 이름의 탭이 있으면 자동으로 이름을 바꿔 그대로 쓴다
    headers: ['기록ID', '날짜', '시작시각', '지속시간', '종류', '상황', '전조증상', '당시복약', '메모', '기록자', '저장시각'],
  },
  VISITS: {
    name: '상담진료기록',
    oldNames: ['상담검사기록'],
    headers: ['기록ID', '구분', '날짜', '담당선생님', '상담시간', '상담내용', '검사내용', '검사결과', '기록자', '저장시각', '수정시각'],
  },
};

// 상담 진료 탭의 구분. 검사는 검사내용·검사결과를, 나머지는 담당선생님·상담시간·상담내용을 쓴다.
const VISIT_KINDS = ['상담센터', '병원 상담', '검사'];
const VISIT_TEST = '검사';

// index.html의 CLIENT_VERSION과 같아야 한다. 둘이 다르면 화면에 "파일 버전이 달라요" 안내가 뜬다.
const APP_VERSION = '8';

const KIND_SCHEDULED = '정해진시간';
const KIND_PRN = '필요시';

// ───────────────────────── 웹앱 진입점 ─────────────────────────

function doGet(e) {
  const url = ScriptApp.getService().getUrl();
  if (url && /\/exec$/.test(url)) {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('APP_URL') !== url) props.setProperty('APP_URL', url);
  }
  const t = HtmlService.createTemplateFromFile('index');
  t.urlKey = String((e && e.parameter && e.parameter.k) || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
  t.appUrl = appUrl_();
  return t.evaluate()
    .setTitle('우리집 복약')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** 템플릿에 값을 안전하게 넣기 위한 JSON (</script> 차단) */
function jsonForHtml_(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

// ───────────────────────── 클라이언트 API ─────────────────────────
// 이름이 api_ 로 시작하는 함수만 화면(google.script.run)에서 부른다. 모두 첫 인자로 키를 받는다.

function api_checkKey(key) {
  return { ok: isValidKey_(key), people: CONFIG.PEOPLE, version: APP_VERSION };
}

/** date를 주면 그날(최근 7일 이내) 화면, 안 주면 오늘 화면 */
function api_today(key, date) {
  auth_(key);
  return todayState_(dayOrToday_(date));
}

/** 정해진 시간 약 복용 기록. date를 주면 지난 날짜(최근 7일)에 나중에 기록한다. */
function api_takeDose(key, who, medId, slot, date) {
  auth_(key);
  who = checkWho_(who);
  const day = dayOrToday_(date);
  return withLock_(() => {
    const med = findMed_(medId);
    if (!med || med.kind !== KIND_SCHEDULED || med.times.indexOf(slot) < 0) throw new Error('약 정보를 찾을 수 없어요. 새로고침 해 주세요.');
    const isToday = day === today_();
    const existing = readTable_(SHEETS.DOSES).find((r) =>
      r['날짜'] === day && r['약ID'] === medId && r['예정시각'] === slot && r['구분'] === KIND_SCHEDULED);
    if (existing) {
      return { status: 'dup', by: existing['기록자'], at: existing['실제시각'], state: todayState_(day) };
    }
    appendRow_(SHEETS.DOSES, {
      '기록ID': newId_('D'), '날짜': day, '예정시각': slot, '실제시각': isToday ? nowHM_() : slot,
      '약ID': med.id, '약이름': med.name, '1회용량': med.dose, '기록자': who,
      '구분': KIND_SCHEDULED, '이유': isToday ? '' : '나중에 기록', '저장시각': stamp_(),
    });
    changeStock_(med, -med.per);
    // 약을 등록하기 전 날짜에 기록하면, 달력에서도 보이도록 시작일을 그날로 당긴다
    if (med.start > day) updateRow_(SHEETS.MEDS, med._row, { '시작일': day });
    return { status: 'ok', state: todayState_(day) };
  });
}

function api_undoDose(key, medId, slot, date) {
  auth_(key);
  const day = dayOrToday_(date);
  return withLock_(() => {
    const sheet = sheet_(SHEETS.DOSES);
    const rows = readTable_(SHEETS.DOSES);
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r['날짜'] === day && r['약ID'] === medId && r['예정시각'] === slot && r['구분'] === KIND_SCHEDULED) {
        sheet.deleteRow(r._row);
        const med = findMed_(medId);
        if (med) changeStock_(med, med.per);
        break;
      }
    }
    return { status: 'ok', state: todayState_(day) };
  });
}

function api_takePrn(key, who, medId, reason, force) {
  auth_(key);
  who = checkWho_(who);
  reason = CONFIG.PRN_REASONS.indexOf(reason) >= 0 ? reason : '기타';
  return withLock_(() => {
    const med = findMed_(medId);
    if (!med || med.kind !== KIND_PRN) throw new Error('약 정보를 찾을 수 없어요. 새로고침 해 주세요.');
    const last = lastPrn_(medId);
    if (last && !force) {
      const hoursAgo = (Date.now() - last.ts) / 3600000;
      if (hoursAgo < med.gapH) {
        return {
          status: 'tooSoon', by: last.by, at: last.at, sameDay: last.date === today_(),
          hoursAgo: Math.round(hoursAgo * 10) / 10, gapH: med.gapH, state: todayState_(),
        };
      }
    }
    appendRow_(SHEETS.DOSES, {
      '기록ID': newId_('P'), '날짜': today_(), '예정시각': '', '실제시각': nowHM_(),
      '약ID': med.id, '약이름': med.name, '1회용량': med.dose, '기록자': who,
      '구분': KIND_PRN, '이유': reason, '저장시각': stamp_(),
    });
    changeStock_(med, -med.per);
    return { status: 'ok', state: todayState_() };
  });
}

function api_addMed(key, m) {
  auth_(key);
  const fields = medFields_(m);
  return withLock_(() => {
    appendRow_(SHEETS.MEDS, Object.assign({ 'ID': newId_('M') }, fields, { '사용중': 'Y', '시작일': today_() }));
    return { status: 'ok', state: todayState_() };
  });
}

/** 약 수정: ID와 시작일, 지난 기록은 그대로 두고 나머지 칸을 바꾼다 */
function api_updateMed(key, id, m) {
  auth_(key);
  const fields = medFields_(m);
  return withLock_(() => {
    const med = findMed_(id);
    if (!med) throw new Error('약 정보를 찾을 수 없어요. 새로고침 해 주세요.');
    updateRow_(SHEETS.MEDS, med._row, fields);
    return { status: 'ok', state: todayState_() };
  });
}

/** 복용 중단: 시트의 사용중을 N으로 (지난 기록은 남는다) */
function api_stopMed(key, id) {
  auth_(key);
  return withLock_(() => {
    const med = findMed_(id);
    if (!med) throw new Error('약 정보를 찾을 수 없어요. 새로고침 해 주세요.');
    updateRow_(SHEETS.MEDS, med._row, { '사용중': 'N' });
    return { status: 'ok', state: todayState_() };
  });
}

/** 화면에서 받은 약 정보를 검사해서 약목록 시트의 칸 값으로 바꾼다 */
function medFields_(m) {
  m = m || {};
  const name = String(m.name || '').trim().slice(0, 40);
  const dose = String(m.dose || '').trim().slice(0, 20);
  const prn = !!m.prn;
  const times = prn ? [] : uniq_((m.times || []).map(String).filter(isHM_)).sort();
  const gapH = Math.min(48, Math.max(1, Number(m.gapH) || 4));
  const stockNum = parseFloat(m.stock);
  if (!name) throw new Error('약 이름을 적어 주세요.');
  if (!prn && !times.length) throw new Error('복용 시간을 하나 이상 골라 주세요.');
  const perNum = parseFloat(dose);
  const unit = (dose.match(/[^\d.\s]+/) || [''])[0] || (String(m.stock || '').match(/[^\d.\s]+/) || ['ml'])[0];
  return {
    '약이름': name, '1회용량': dose || '-',
    '1회사용량': isNaN(perNum) ? '' : String(perNum), '단위': unit,
    '방식': prn ? KIND_PRN : KIND_SCHEDULED, '복용시각': times.join(','),
    '최소간격(시간)': prn ? String(gapH) : '', '남은양': isNaN(stockNum) ? '' : String(stockNum),
  };
}

function api_saveSeizure(key, who, d) {
  auth_(key);
  who = checkWho_(who);
  d = d || {};
  const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : today_();
  const time = isHM_(d.time) ? d.time : nowHM_();
  withLock_(() => {
    appendRow_(SHEETS.SEIZURES, {
      '기록ID': newId_('S'), '날짜': date, '시작시각': time, '지속시간': clip(d.duration, 30),
      '종류': clip(d.type, 30), '상황': clip(d.situation, 30),
      '전조증상': (Array.isArray(d.aura) ? d.aura : []).map((x) => clip(x, 30)).join(', '),
      '당시복약': clip(d.medState, 20), '메모': clip(d.memo, 500), '기록자': who, '저장시각': stamp_(),
    });
  });
  return { status: 'ok' };
}

// ───────────────────────── 상담 진료 기록 ─────────────────────────

/** 상담 진료 기록 전체 (최근 날짜가 먼저) */
function api_visits(key) {
  auth_(key);
  return visitList_();
}

/** 새로 저장하거나, v.id가 있으면 그 기록을 고친다 (검사 결과를 나중에 채우는 경우 등) */
function api_saveVisit(key, who, v) {
  auth_(key);
  who = checkWho_(who);
  v = v || {};
  const clip = (x, n) => String(x == null ? '' : x).trim().slice(0, n);
  const kind = VISIT_KINDS.indexOf(v.kind) >= 0 ? v.kind : '';
  if (!kind) throw new Error('구분(상담센터 / 병원 상담 / 검사)을 골라 주세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) throw new Error('날짜를 골라 주세요.');
  const isTest = kind === VISIT_TEST;
  const fields = {
    '구분': kind, '날짜': v.date,
    '담당선생님': isTest ? '' : clip(v.teacher, 40),
    '상담시간': isTest ? '' : clip(v.time, 40),
    '상담내용': isTest ? '' : clip(v.content, 3000),
    '검사내용': isTest ? clip(v.testName, 500) : '',
    '검사결과': isTest ? clip(v.result, 3000) : '',
  };
  if (isTest && !fields['검사내용']) throw new Error('검사 내용을 적어 주세요.');
  if (!isTest && !fields['상담내용'] && !fields['담당선생님']) throw new Error('담당 선생님이나 상담 내용을 적어 주세요.');
  return withLock_(() => {
    if (v.id) {
      const row = readTable_(SHEETS.VISITS).find((r) => r['기록ID'] === v.id);
      if (!row) throw new Error('기록을 찾을 수 없어요. 새로고침 해 주세요.');
      updateRow_(SHEETS.VISITS, row._row, Object.assign(fields, { '수정시각': stamp_() }));
    } else {
      appendRow_(SHEETS.VISITS, Object.assign({ '기록ID': newId_('V') }, fields, { '기록자': who, '저장시각': stamp_() }));
    }
    return { status: 'ok', visits: visitList_() };
  });
}

function api_deleteVisit(key, id) {
  auth_(key);
  return withLock_(() => {
    const row = readTable_(SHEETS.VISITS).find((r) => r['기록ID'] === id);
    if (row) sheet_(SHEETS.VISITS).deleteRow(row._row);
    return { status: 'ok', visits: visitList_() };
  });
}

function visitList_() {
  return readTable_(SHEETS.VISITS).filter((r) => r['기록ID']).map((r) => ({
    id: r['기록ID'], kind: r['구분'], date: r['날짜'], teacher: r['담당선생님'], time: r['상담시간'],
    content: r['상담내용'], testName: r['검사내용'], result: r['검사결과'], by: r['기록자'],
    savedAt: r['저장시각'], updatedAt: r['수정시각'], _order: r._row,
  })).sort((a, b) => (a.date === b.date ? b._order - a._order : a.date < b.date ? 1 : -1));
}

function api_month(key, year, month) {
  auth_(key);
  year = Number(year);
  month = Number(month);
  if (!(year > 2000 && month >= 1 && month <= 12)) throw new Error('잘못된 날짜');
  const prefix = year + '-' + pad2_(month) + '-';
  const today = today_();
  const meds = readMeds_().filter((m) => m.active);
  const scheduled = meds.filter((m) => m.kind === KIND_SCHEDULED);
  const doses = readTable_(SHEETS.DOSES);
  const seizures = readTable_(SHEETS.SEIZURES);
  const lastDay = new Date(year, month, 0).getDate();
  const days = [];
  let expected = 0;
  let done = 0;
  for (let d = 1; d <= lastDay; d++) {
    const date = prefix + pad2_(d);
    const dayDoses = doses.filter((r) => r['날짜'] === date);
    const slots = [];
    if (date <= today) {
      const times = uniq_([].concat.apply([], scheduled.filter((m) => m.start <= date).map((m) => m.times))).sort();
      times.forEach((t) => {
        const due = scheduled.filter((m) => m.start <= date && m.times.indexOf(t) >= 0);
        const got = due.filter((m) => dayDoses.some((r) => r['약ID'] === m.id && r['예정시각'] === t && r['구분'] === KIND_SCHEDULED));
        if (date < today || t <= nowHM_()) {
          expected += due.length;
          done += got.length;
        }
        slots.push({ time: t, done: got.length === due.length, count: got.length, total: due.length });
      });
    }
    days.push({
      date: date, day: d, future: date > today, slots: slots,
      doses: dayDoses.map((r) => ({
        name: r['약이름'], slot: r['예정시각'], at: r['실제시각'], by: r['기록자'],
        prn: r['구분'] === KIND_PRN, reason: r['이유'],
      })),
      seizures: seizures.filter((r) => r['날짜'] === date).map((r) => ({
        time: r['시작시각'], duration: r['지속시간'], type: r['종류'], situation: r['상황'],
        aura: r['전조증상'], medState: r['당시복약'], memo: r['메모'], by: r['기록자'],
      })),
    });
  }
  const pastSeizures = seizures.map((r) => r['날짜']).filter((x) => x && x <= today).sort();
  const lastSz = pastSeizures[pastSeizures.length - 1];
  return {
    year: year, month: month, today: today,
    firstWeekday: new Date(year, month - 1, 1).getDay(),
    days: days,
    rate: expected ? Math.round(done / expected * 100) : null,
    seizureCount: seizures.filter((r) => String(r['날짜']).indexOf(prefix) === 0).length,
    seizureFreeDays: lastSz ? daysBetween_(lastSz, today) : null,
  };
}

// ───────────────────────── 오늘 화면 데이터 ─────────────────────────

/** 하루 화면 데이터. day를 안 주면 오늘. 지난 날짜에도 지금 먹는 약을 모두 보여 줘서 나중에 기록할 수 있게 한다. */
function todayState_(day) {
  const today = today_();
  day = day || today;
  const meds = readMeds_().filter((m) => m.active);
  const rows = readTable_(SHEETS.DOSES);
  const todays = rows.filter((r) => r['날짜'] === day);
  const taken = {};
  todays.filter((r) => r['구분'] === KIND_SCHEDULED).forEach((r) => {
    taken[r['약ID'] + '|' + r['예정시각']] = { by: r['기록자'], at: r['실제시각'] };
  });
  const prnToday = todays.filter((r) => r['구분'] === KIND_PRN)
    .map((r) => ({ medId: r['약ID'], by: r['기록자'], at: r['실제시각'], reason: r['이유'] }));
  return {
    date: day,
    dateLabel: dateLabel_(day),
    isToday: day === today,
    today: today,
    minDate: addDays_(today, -CONFIG.PAST_DAYS),
    now: nowHM_(),
    people: CONFIG.PEOPLE,
    reasons: CONFIG.PRN_REASONS,
    meds: meds.map((m) => ({
      id: m.id, name: m.name, dose: m.dose, prn: m.kind === KIND_PRN, times: m.times,
      gapH: m.gapH, stock: m.stock, unit: m.unit, per: m.per,
      daysLeft: daysLeft_(m), low: isLow_(m),
    })),
    taken: taken,
    prnToday: prnToday,
  };
}

// ───────────────────────── 예전 알림 트리거 정리 ─────────────────────────

/**
 * 알림 기능은 뺐다. 예전에 등록된 15분 트리거가 이 함수를 부르면 트리거를 스스로 지운다.
 * (이 함수가 없으면 트리거가 돌 때마다 "함수를 찾을 수 없음" 오류 메일이 온다)
 */
function checkReminders() {
  removeOldTriggers_();
}

function removeOldTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'checkReminders')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

// ───────────────────────── 관리용 (편집기에서 직접 실행) ─────────────────────────

/** 처음 한 번: 시트 만들기, 비밀 키 만들기 (예전 알림 트리거가 있으면 지움) */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach((k) => prepareSheet_(findSheet_(SHEETS[k]) || ss.insertSheet(SHEETS[k].name), SHEETS[k]));
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('APP_KEY')) props.setProperty('APP_KEY', randomToken_(24));
  removeOldTriggers_();

  console.log('설정 완료. 이제 [배포 → 새 배포 → 웹 앱]으로 배포한 뒤 showLinks()를 실행하세요.');
  showLinks();
}

/** 가족에게 보낼 주소를 보여 준다 */
function showLinks() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('APP_KEY');
  const url = appUrl_();
  console.log('비밀 키: ' + key);
  if (url) {
    console.log('가족 주소(이 주소를 가족 폰에서 한 번 열기): ' + url + '?k=' + key);
  } else {
    console.log('웹앱 주소를 아직 모릅니다. 배포 화면의 "웹 앱 URL" 뒤에 ?k=' + key + ' 를 붙여서 쓰세요.');
    console.log('(또는 웹 앱 URL을 한 번 열어 본 뒤 showLinks()를 다시 실행하면 전체 주소가 나옵니다.)');
  }
}

/** 폰을 잃어버렸을 때: 비밀 키를 바꾼다. 모든 폰이 로그아웃되고 새 가족 주소로 다시 등록해야 한다. */
function rotateKey() {
  PropertiesService.getScriptProperties().setProperty('APP_KEY', randomToken_(24));
  console.log('비밀 키를 바꿨습니다. 모든 폰에서 새 가족 주소로 다시 등록해야 합니다.');
  showLinks();
}

// ───────────────────────── 시트 읽기/쓰기 ─────────────────────────

/** 시트를 찾는다. 예전 이름(oldNames)의 탭만 있으면 새 이름으로 바꿔서 쓴다. */
function findSheet_(def) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.name);
  if (sh) return sh;
  (def.oldNames || []).some((n) => {
    const old = ss.getSheetByName(n);
    if (old) { old.setName(def.name); sh = old; }
    return !!sh;
  });
  return sh;
}

/** 시트를 돌려준다. 없으면 머리글을 넣어 새로 만든다 (새 탭이 생겨도 setup을 다시 안 돌려도 되게) */
function sheet_(def) {
  return findSheet_(def) || prepareSheet_(SpreadsheetApp.getActiveSpreadsheet().insertSheet(def.name), def);
}

function prepareSheet_(sh, def) {
  sh.getRange(1, 1, sh.getMaxRows(), def.headers.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold').setBackground('#EEF1F5');
  sh.setFrozenRows(1);
  return sh;
}

/** 시트를 [{머리글: 값, _row: 행번호}] 로 읽는다 (값은 모두 화면에 보이는 문자열) */
function readTable_(def) {
  const sh = sheet_(def);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(1, 1, last, sh.getLastColumn()).getDisplayValues();
  const head = values[0].map((h) => String(h).trim());
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every((v) => v === '')) continue;
    const o = { _row: i + 1 };
    head.forEach((h, j) => { if (h) o[h] = String(row[j]).trim(); });
    out.push(o);
  }
  return out;
}

function appendRow_(def, obj) {
  const sh = sheet_(def);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map((h) => String(h).trim());
  const row = head.map((h) => (obj[h] == null ? '' : String(obj[h])));
  const r = sh.getLastRow() + 1;
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
}

function setCell_(def, rowNum, header, value) {
  const patch = {};
  patch[header] = value;
  updateRow_(def, rowNum, patch);
}

function updateRow_(def, rowNum, obj) {
  const sh = sheet_(def);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map((h) => String(h).trim());
  Object.keys(obj).forEach((h) => {
    const col = head.indexOf(h) + 1;
    if (col > 0) sh.getRange(rowNum, col).setNumberFormat('@').setValue(String(obj[h]));
  });
}

function readMeds_() {
  return readTable_(SHEETS.MEDS).filter((r) => r['ID'] && r['약이름']).map((r) => {
    const stock = parseFloat(r['남은양']);
    const per = parseFloat(r['1회사용량']);
    const gap = parseFloat(r['최소간격(시간)']);
    return {
      id: r['ID'], name: r['약이름'], dose: r['1회용량'] || '-',
      per: isNaN(per) ? 0 : per, unit: r['단위'] || '',
      kind: r['방식'] === KIND_PRN ? KIND_PRN : KIND_SCHEDULED,
      times: uniq_(String(r['복용시각'] || '').split(/[,\s]+/).map(normHM_).filter(Boolean)).sort(),
      gapH: isNaN(gap) ? 4 : gap,
      stock: isNaN(stock) ? null : stock,
      active: String(r['사용중'] || 'Y').toUpperCase() !== 'N',
      start: /^\d{4}-\d{2}-\d{2}$/.test(r['시작일']) ? r['시작일'] : '0000-00-00',
      _row: r._row,
    };
  });
}

function findMed_(id) {
  return readMeds_().find((m) => m.id === id && m.active) || null;
}

function changeStock_(med, delta) {
  if (med.stock == null || !delta) return;
  const v = Math.max(0, Math.round((med.stock + delta) * 100) / 100);
  setCell_(SHEETS.MEDS, med._row, '남은양', v);
}

function lastPrn_(medId) {
  const rows = readTable_(SHEETS.DOSES).filter((r) => r['약ID'] === medId && r['구분'] === KIND_PRN && r['저장시각']);
  if (!rows.length) return null;
  const r = rows[rows.length - 1];
  return { by: r['기록자'], at: r['실제시각'], date: r['날짜'], ts: Utilities.parseDate(r['저장시각'], tz_(), 'yyyy-MM-dd HH:mm:ss').getTime() };
}

function daysLeft_(m) {
  if (m.stock == null || m.kind !== KIND_SCHEDULED || !m.per || !m.times.length) return null;
  return Math.floor(m.stock / (m.per * m.times.length));
}

function isLow_(m) {
  const d = daysLeft_(m);
  return d != null && d < CONFIG.LOW_STOCK_DAYS;
}

// ───────────────────────── 공통 도우미 ─────────────────────────

function isValidKey_(key) {
  const real = PropertiesService.getScriptProperties().getProperty('APP_KEY');
  return !!real && typeof key === 'string' && key === real;
}

function auth_(key) {
  if (!isValidKey_(key)) throw new Error('AUTH');
}

function checkWho_(who) {
  if (CONFIG.PEOPLE.indexOf(who) < 0) throw new Error('누가 기록하는지 다시 골라 주세요.');
  return who;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function appUrl_() {
  const saved = PropertiesService.getScriptProperties().getProperty('APP_URL');
  if (saved) return saved;
  const url = ScriptApp.getService().getUrl();
  return url && /\/exec$/.test(url) ? url : '';
}

function tz_() {
  return Session.getScriptTimeZone() || 'Asia/Seoul';
}

function today_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function nowHM_() {
  return Utilities.formatDate(new Date(), tz_(), 'HH:mm');
}

function stamp_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}

function dateLabel_(ymd) {
  const p = ymd.split('-').map(Number);
  const wd = '일월화수목금토'.charAt(new Date(p[0], p[1] - 1, p[2]).getDay());
  return p[1] + '월 ' + p[2] + '일 ' + wd + '요일';
}

/** 'yyyy-MM-dd'가 최근 PAST_DAYS일 ~ 오늘 사이면 그대로, 비었으면 오늘, 그 밖이면 오류 */
function dayOrToday_(d) {
  const today = today_();
  if (d == null || d === '') return today;
  d = String(d);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today || d < addDays_(today, -CONFIG.PAST_DAYS)) {
    throw new Error('최근 ' + CONFIG.PAST_DAYS + '일 안의 날짜만 기록할 수 있어요.');
  }
  return d;
}

function addDays_(ymd, n) {
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

function daysBetween_(a, b) {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

function isHM_(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s));
}

/** "8:00", "08:00", "800" 같은 입력을 "08:00" 으로 */
function normHM_(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{1,2}):(\d{2})$/) || s.match(/^(\d{1,2})(\d{2})$/);
  if (!m) return '';
  const v = pad2_(Number(m[1])) + ':' + m[2];
  return isHM_(v) ? v : '';
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function uniq_(a) {
  return a.filter((x, i) => a.indexOf(x) === i);
}

function newId_(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

function randomToken_(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + Math.random());
  let out = '';
  for (let i = 0; i < len; i++) out += chars.charAt(((bytes[i % bytes.length] + 256) % 256) % chars.length);
  return out;
}

// ===== Code.gs 끝 (이 줄이 보이면 끝까지 붙여넣은 것) =====
