// 실행: node med-app/test/test.js
const assert = require('assert');
const { createEnv } = require('./harness');

let passed = 0;
// vm 안에서 만든 객체는 프로토타입이 달라서 JSON으로 정규화해 비교
const deq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m);
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + e.stack); process.exitCode = 1; }
}

// 서울 시각으로 시간을 정한다 (UTC = 서울 - 9시간)
const at = (hm, day = '2026-10-24') => day + 'T' + hm + ':00+09:00';

function fresh() {
  const env = createEnv({ now: at('07:00') });
  env.ctx.setup();
  const k = env.key();
  const c = env.ctx;
  c.api_addMed(k, { name: '케프라액', dose: '0.5ml', stock: '42ml', prn: false, times: ['20:00', '08:00'] });
  c.api_addMed(k, { name: '두통약', dose: '5ml', stock: '90', prn: true, gapH: 4 });
  const meds = c.api_today(k).meds;
  return { env, c, k, sched: meds.find((m) => !m.prn), prn: meds.find((m) => m.prn) };
}

test('setup: 시트와 비밀 키, 알림 트리거는 만들지 않음', () => {
  const env = createEnv({ now: at('07:00') });
  env.triggers.push({ getHandlerFunction: () => 'checkReminders' }); // 예전 버전이 남긴 트리거
  env.triggers.push({ getHandlerFunction: () => 'somethingElse' });
  env.ctx.setup();
  deq(Object.keys(env.sheets).sort(), ['상담대비기록', '복약기록', '약목록', '상담진료기록'].sort());
  assert.match(env.props.APP_KEY, /^[A-Za-z0-9]{24}$/);
  assert.strictEqual(env.props.NTFY_TOPIC, undefined);
  deq(env.triggers.map((t) => t.getHandlerFunction()), ['somethingElse'], '예전 알림 트리거만 지움');
  env.ctx.setup();
  assert.strictEqual(env.sheets['약목록'].getLastRow(), 1, '두 번 실행해도 머리글만');
});

test('키 확인과 잘못된 키 차단', () => {
  const { c, k } = fresh();
  assert.strictEqual(c.api_checkKey(k).ok, true);
  assert.strictEqual(c.api_checkKey('wrong').ok, false);
  assert.strictEqual(c.api_checkKey(undefined).ok, false);
  assert.throws(() => c.api_today('wrong'), /AUTH/);
  assert.throws(() => c.api_takeDose('wrong', '엄마', 'x', '08:00'), /AUTH/);
});

test('약 추가: 시각 정렬, 단위, 필요 시 약', () => {
  const { sched, prn } = fresh();
  deq(sched.times, ['08:00', '20:00']);
  assert.strictEqual(sched.unit, 'ml');
  assert.strictEqual(sched.per, 0.5);
  assert.strictEqual(sched.stock, 42);
  assert.strictEqual(sched.daysLeft, 42);
  assert.strictEqual(prn.prn, true);
  assert.strictEqual(prn.gapH, 4);
  assert.strictEqual(prn.unit, 'ml', '용량 단위를 따름');
});

test('약 추가 검증', () => {
  const { c, k } = fresh();
  assert.throws(() => c.api_addMed(k, { name: '', times: ['08:00'] }), /이름/);
  assert.throws(() => c.api_addMed(k, { name: 'A', times: [] }), /시간/);
  assert.throws(() => c.api_addMed(k, { name: 'A', times: ['25:00'] }), /시간/);
});

test('복용 기록, 중복 방지, 재고 차감', () => {
  const { env, c, k, sched } = fresh();
  env.setNow(at('08:03'));
  const r1 = c.api_takeDose(k, '엄마', sched.id, '08:00');
  assert.strictEqual(r1.status, 'ok');
  deq(r1.state.taken[sched.id + '|08:00'], { by: '엄마', at: '08:03' });
  assert.strictEqual(r1.state.meds.find((m) => m.id === sched.id).stock, 41.5);
  env.setNow(at('08:10'));
  const r2 = c.api_takeDose(k, '아빠', sched.id, '08:00');
  assert.strictEqual(r2.status, 'dup');
  assert.strictEqual(r2.by, '엄마');
  assert.strictEqual(r2.at, '08:03');
  assert.strictEqual(env.sheets['복약기록'].getLastRow(), 2, '중복 기록 안 됨');
  assert.strictEqual(r2.state.meds.find((m) => m.id === sched.id).stock, 41.5);
});

test('잘못된 사람/시간 거부', () => {
  const { c, k, sched } = fresh();
  assert.throws(() => c.api_takeDose(k, '할머니', sched.id, '08:00'), /누가/);
  assert.throws(() => c.api_takeDose(k, '엄마', sched.id, '12:00'), /찾을 수 없어요/);
});

test('기록 취소하면 재고 복구', () => {
  const { env, c, k, sched } = fresh();
  env.setNow(at('08:03'));
  c.api_takeDose(k, '엄마', sched.id, '08:00');
  const r = c.api_undoDose(k, sched.id, '08:00');
  assert.strictEqual(r.state.taken[sched.id + '|08:00'], undefined);
  assert.strictEqual(r.state.meds.find((m) => m.id === sched.id).stock, 42);
  assert.strictEqual(env.sheets['복약기록'].getLastRow(), 1);
});

test('필요 시 약: 간격 경고와 강제 기록', () => {
  const { env, c, k, prn } = fresh();
  env.setNow(at('10:00'));
  assert.strictEqual(c.api_takePrn(k, '아빠', prn.id, '두통', false).status, 'ok');
  env.setNow(at('12:00'));
  const r = c.api_takePrn(k, '엄마', prn.id, '두통', false);
  assert.strictEqual(r.status, 'tooSoon');
  assert.strictEqual(r.by, '아빠');
  assert.strictEqual(r.hoursAgo, 2);
  assert.strictEqual(r.gapH, 4);
  const f = c.api_takePrn(k, '엄마', prn.id, '이상한값', true);
  assert.strictEqual(f.status, 'ok');
  assert.strictEqual(f.state.prnToday.length, 2);
  assert.strictEqual(f.state.prnToday[1].reason, '기타');
  assert.strictEqual(f.state.meds.find((m) => m.id === prn.id).stock, 80);
  env.setNow(at('16:30'));
  assert.strictEqual(c.api_takePrn(k, '엄마', prn.id, '발열', false).status, 'ok', '4시간 지나면 통과');
});

test('필요 시 약: 자정을 넘겨도 간격 확인', () => {
  const { env, c, k, prn } = fresh();
  env.setNow(at('23:00'));
  c.api_takePrn(k, '엄마', prn.id, '두통', false);
  env.setNow(at('01:00', '2026-10-25'));
  const r = c.api_takePrn(k, '엄마', prn.id, '두통', false);
  assert.strictEqual(r.status, 'tooSoon');
  assert.strictEqual(r.sameDay, false);
  assert.strictEqual(r.state.prnToday.length, 0, '오늘 목록은 새 날짜 기준');
});

test('예전 알림 트리거가 돌면 스스로 지우고 아무것도 보내지 않음', () => {
  const { env, c } = fresh();
  env.triggers.push({ getHandlerFunction: () => 'checkReminders' });
  env.setNow(at('09:05'));                 // 08:00 약 미기록 상태
  c.checkReminders();
  assert.strictEqual(env.triggers.length, 0);
  assert.strictEqual(env.fetches.length, 0);
});

test('재고 부족은 화면 표시용 값으로만', () => {
  const { c, k } = fresh();
  c.api_addMed(k, { name: '데파킨', dose: '2ml', stock: '20ml', times: ['08:00', '20:00'] });
  const dep = c.api_today(k).meds.find((m) => m.name === '데파킨');
  assert.strictEqual(dep.daysLeft, 5);
  assert.strictEqual(dep.low, true);
});

test('상담대비 기록 저장 (알림 없음)', () => {
  const { env, c, k } = fresh();
  env.setNow(at('14:12'));
  c.api_saveSeizure(k, '아이', { date: '2026-10-24', time: '14:05', duration: '1분', type: '부분 경련', situation: '일상생활 중', aura: ['쓴맛', '공포감'], medState: '제때 복용', memo: '금방 회복' });
  const row = env.sheets['상담대비기록'].getRange(2, 1, 1, 11).getDisplayValues()[0];
  deq(row.slice(1, 10), ['2026-10-24', '14:05', '1분', '부분 경련', '일상생활 중', '쓴맛, 공포감', '제때 복용', '금방 회복', '아이']);
  assert.strictEqual(env.fetches.length, 0, '외부로 아무것도 보내지 않음');
});

test('경련 기록: 이상한 날짜·시각은 지금으로', () => {
  const { env, c, k } = fresh();
  env.setNow(at('14:12'));
  c.api_saveSeizure(k, '엄마', { date: 'x', time: '99:99', type: '기타' });
  const row = env.sheets['상담대비기록'].getRange(2, 1, 1, 3).getDisplayValues()[0];
  deq(row.slice(1), ['2026-10-24', '14:12']);
});

test('달력: 복약 점, 복약률, 경련, 무경련 일수', () => {
  const env = createEnv({ now: at('07:00', '2026-10-22') });
  const c = env.ctx;
  c.setup();
  const k = env.key();
  c.api_addMed(k, { name: '케프라액', dose: '0.5ml', stock: '42', times: ['08:00', '20:00'] });
  const id = c.api_today(k).meds[0].id;
  env.setNow(at('08:01', '2026-10-22')); c.api_takeDose(k, '엄마', id, '08:00');
  env.setNow(at('20:01', '2026-10-22')); c.api_takeDose(k, '엄마', id, '20:00');
  env.setNow(at('08:01', '2026-10-23')); c.api_takeDose(k, '아빠', id, '08:00');
  c.api_saveSeizure(k, '엄마', { date: '2026-10-23', time: '15:00', type: '전신 경련', duration: '2분' });
  env.setNow(at('09:00', '2026-10-24')); c.api_takeDose(k, '엄마', id, '08:00');
  const m = c.api_month(k, 2026, 10);
  assert.strictEqual(m.firstWeekday, 4, '2026-10-01은 목요일');
  assert.strictEqual(m.days.length, 31);
  deq(m.days[20].slots, [], '약 시작 전 날짜는 점 없음');
  deq(m.days[21].slots.map((s) => s.done), [true, true]);
  deq(m.days[22].slots.map((s) => s.done), [true, false]);
  deq(m.days[23].slots.map((s) => s.done), [true, false], '오늘 20:00은 아직 미기록');
  assert.strictEqual(m.days[24].future, true);
  assert.strictEqual(m.rate, 80, '지난 회차 5개 중 4개 (오늘 20:00은 아직 안 셈)');
  assert.strictEqual(m.seizureCount, 1);
  assert.strictEqual(m.days[22].seizures[0].type, '전신 경련');
  assert.strictEqual(m.seizureFreeDays, 1);
  assert.throws(() => c.api_month(k, 2026, 13));
});

test('시트를 직접 고친 값도 읽음 (시각 표기, 중단)', () => {
  const { env, c, k, sched } = fresh();
  const sh = env.sheets['약목록'];
  const head = sh.rows[0];
  const row = sh.rows.findIndex((r) => r[0] === sched.id);
  sh.rows[row][head.indexOf('복용시각')] = '8:00, 2000';
  let m = c.api_today(k).meds.find((x) => x.id === sched.id);
  deq(m.times, ['08:00', '20:00']);
  sh.rows[row][head.indexOf('사용중')] = 'n';
  assert.strictEqual(c.api_today(k).meds.find((x) => x.id === sched.id), undefined);
});

test('비밀 키 바꾸면 예전 키 차단', () => {
  const { env, c, k } = fresh();
  c.rotateKey();
  assert.notStrictEqual(env.key(), k);
  assert.strictEqual(c.api_checkKey(k).ok, false);
  assert.strictEqual(c.api_checkKey(env.key()).ok, true);
});

test('약 수정: 같은 행을 고치고 ID·시작일·기록은 유지', () => {
  const { env, c, k, sched } = fresh();
  env.setNow(at('08:03'));
  c.api_takeDose(k, '엄마', sched.id, '08:00');
  env.setNow(at('09:00', '2026-10-25'));
  const r = c.api_updateMed(k, sched.id, { name: '케프라정', dose: '250mg', stock: '30정', prn: false, times: ['08:00', '13:00', '20:00'] });
  const m = r.state.meds.find((x) => x.id === sched.id);
  deq(m.times, ['08:00', '13:00', '20:00']);
  assert.strictEqual(m.name, '케프라정');
  assert.strictEqual(m.unit, 'mg');
  assert.strictEqual(m.stock, 30);
  assert.strictEqual(env.sheets['약목록'].getLastRow(), 3, '행이 늘지 않음');
  const row = env.sheets['약목록'].rows.find((x) => x[0] === sched.id);
  assert.strictEqual(row[10], '2026-10-24', '시작일 유지');
  assert.strictEqual(env.sheets['복약기록'].getLastRow(), 2, '지난 기록 유지');
  assert.throws(() => c.api_updateMed(k, sched.id, { name: '', times: ['08:00'] }), /이름/);
  assert.throws(() => c.api_updateMed(k, 'nope', { name: 'A', times: ['08:00'] }), /찾을 수 없어요/);
  assert.throws(() => c.api_updateMed('wrong', sched.id, { name: 'A', times: ['08:00'] }), /AUTH/);
});

test('약 수정: 정해진 시간 ↔ 필요 시 전환', () => {
  const { c, k, prn } = fresh();
  let m = c.api_updateMed(k, prn.id, { name: '두통약', dose: '5ml', stock: '90', prn: false, times: ['21:00'] }).state.meds.find((x) => x.id === prn.id);
  assert.strictEqual(m.prn, false);
  deq(m.times, ['21:00']);
  m = c.api_updateMed(k, prn.id, { name: '두통약', dose: '5ml', stock: '90', prn: true, gapH: 8, times: ['21:00'] }).state.meds.find((x) => x.id === prn.id);
  assert.strictEqual(m.prn, true);
  deq(m.times, []);
  assert.strictEqual(m.gapH, 8);
});

test('복용 중단: 목록에서 빠지고 기록은 남음', () => {
  const { env, c, k, sched } = fresh();
  env.setNow(at('08:03'));
  c.api_takeDose(k, '엄마', sched.id, '08:00');
  const r = c.api_stopMed(k, sched.id);
  assert.strictEqual(r.state.meds.find((x) => x.id === sched.id), undefined);
  assert.strictEqual(env.sheets['복약기록'].getLastRow(), 2);
  assert.throws(() => c.api_takeDose(k, '엄마', sched.id, '20:00'), /찾을 수 없어요/);
  assert.throws(() => c.api_stopMed(k, sched.id), /찾을 수 없어요/);
});

test('어제 저녁 약을 나중에 기록', () => {
  const { env, c, k, sched } = fresh();             // 10-24 07:00에 약 등록 (시작일 10-24)
  env.setNow(at('09:00', '2026-10-25'));
  const r = c.api_takeDose(k, '엄마', sched.id, '20:00', '2026-10-24');
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.state.date, '2026-10-24');
  assert.strictEqual(r.state.isToday, false);
  deq(r.state.taken[sched.id + '|20:00'], { by: '엄마', at: '20:00' });
  const row = env.sheets['복약기록'].rows[1];
  assert.strictEqual(row[1], '2026-10-24');
  assert.strictEqual(row[9], '나중에 기록');
  assert.strictEqual(row[10], '2026-10-25 09:00:00', '저장시각은 실제로 누른 때');
  assert.strictEqual(r.state.meds.find((m) => m.id === sched.id).stock, 41.5, '재고도 차감');
  // 같은 회차 다시 → 중복
  assert.strictEqual(c.api_takeDose(k, '아빠', sched.id, '20:00', '2026-10-24').status, 'dup');
  // 오늘 화면에는 영향 없음
  assert.strictEqual(c.api_today(k).taken[sched.id + '|20:00'], undefined);
  // 지난 날짜 기록 취소
  const u = c.api_undoDose(k, sched.id, '20:00', '2026-10-24');
  assert.strictEqual(u.state.taken[sched.id + '|20:00'], undefined);
  assert.strictEqual(u.state.meds.find((m) => m.id === sched.id).stock, 42);
});

test('지난 날짜 범위: 7일 전까지만, 미래 불가', () => {
  const { env, c, k, sched } = fresh();
  env.setNow(at('09:00', '2026-10-31'));
  assert.strictEqual(c.api_takeDose(k, '엄마', sched.id, '08:00', '2026-10-24').status, 'ok', '정확히 7일 전 허용');
  assert.throws(() => c.api_takeDose(k, '엄마', sched.id, '08:00', '2026-10-23'), /7일/);
  assert.throws(() => c.api_takeDose(k, '엄마', sched.id, '08:00', '2026-11-01'), /7일/);
  assert.throws(() => c.api_today(k, 'yesterday'), /7일/);
  assert.strictEqual(c.api_today(k, '').date, '2026-10-31');
  assert.strictEqual(c.api_today(k).minDate, '2026-10-24');
});

test('약 등록 전 날짜에 기록하면 시작일을 당겨 달력에도 보임', () => {
  const { env, c, k, sched } = fresh();               // 시작일 10-24
  env.setNow(at('09:00', '2026-10-24'));
  const past = c.api_today(k, '2026-10-23');
  assert.ok(past.meds.some((m) => m.id === sched.id), '지난 날짜 화면에도 지금 약이 보임');
  c.api_takeDose(k, '엄마', sched.id, '20:00', '2026-10-23');
  const row = env.sheets['약목록'].rows.find((x) => x[0] === sched.id);
  assert.strictEqual(row[10], '2026-10-23');
  const m = c.api_month(k, 2026, 10);
  deq(m.days[22].slots.map((x) => x.done), [false, true]);
});

test('예전 "경련기록" 탭은 이름만 바꿔서 기록 유지', () => {
  const env = createEnv({ now: at('07:00') });
  const ss = env.ctx.SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.insertSheet('경련기록');
  old.getRange(1, 1, 2, 3).setValues([['기록ID', '날짜', '시작시각'], ['S1', '2026-10-20', '10:00']]);
  env.ctx.setup();
  assert.ok(!env.sheets['경련기록'], '예전 탭 이름 없어짐');
  assert.strictEqual(env.sheets['상담대비기록'], old, '같은 탭을 그대로 사용');
  assert.strictEqual(old.rows[1][0], 'S1', '기존 기록 유지');
  assert.ok(!Object.keys(env.sheets).includes('경련기록') && Object.keys(env.sheets).filter((n) => n === '상담대비기록').length === 1, '새 탭을 따로 만들지 않음');
});

test('setup 없이도 예전 탭을 찾아 이름을 바꿈', () => {
  const { env, c, k } = fresh();
  env.sheets['상담대비기록'].setName('경련기록');
  c.api_saveSeizure(k, '엄마', { date: '2026-10-24', time: '10:00', type: '기타' });
  assert.ok(env.sheets['상담대비기록'] && !env.sheets['경련기록']);
  assert.strictEqual(env.sheets['상담대비기록'].getLastRow(), 2);
});

test('상담대비 기록: 새 선택지 저장, 외부 전송 없음', () => {
  const { env, c, k } = fresh();
  env.setNow(at('14:12'));
  const r = c.api_saveSeizure(k, '아빠', { date: '2026-10-24', time: '15:00', duration: '1시간 이상', type: '전신 떨림', situation: '핸드폰 중' });
  deq(r, { status: 'ok' });
  deq(env.sheets['상담대비기록'].rows[1].slice(3, 6), ['1시간 이상', '전신 떨림', '핸드폰 중']);
  assert.strictEqual(env.fetches.length, 0);
});

test('상담 진료: 상담 기록 저장, 검사 결과는 나중에 채우기', () => {
  const { env, c, k } = fresh();
  env.setNow(at('16:00'));
  let r = c.api_saveVisit(k, '엄마', { kind: '상담센터', date: '2026-10-20', teacher: '김선생님', time: '15:00~15:50', content: '학교 적응 이야기\n수면 습관 점검' });
  assert.strictEqual(r.status, 'ok');
  r = c.api_saveVisit(k, '아빠', { kind: '병원 상담', date: '2026-10-24', teacher: '이교수님', time: '10:30', content: '약 용량 유지' });
  r = c.api_saveVisit(k, '아빠', { kind: '검사', date: '2026-10-22', testName: '뇌파검사(EEG)', result: '' });
  deq(r.visits.map((v) => [v.date, v.kind]), [['2026-10-24', '병원 상담'], ['2026-10-22', '검사'], ['2026-10-20', '상담센터']], '최근 날짜 먼저');
  const consult = r.visits.find((v) => v.kind === '상담센터');
  assert.strictEqual(consult.content, '학교 적응 이야기\n수면 습관 점검', '줄바꿈 유지');
  assert.strictEqual(consult.by, '엄마');
  const test = r.visits.find((v) => v.kind === '검사');
  assert.strictEqual(test.result, '');
  assert.strictEqual(test.teacher, '', '검사에는 상담 칸을 쓰지 않음');
  env.setNow(at('18:00'));
  r = c.api_saveVisit(k, '엄마', { id: test.id, kind: '검사', date: '2026-10-22', testName: '뇌파검사(EEG)', result: '이상 소견 없음', teacher: '무시됨' });
  const t2 = r.visits.find((v) => v.id === test.id);
  assert.strictEqual(t2.result, '이상 소견 없음');
  assert.strictEqual(t2.teacher, '');
  assert.strictEqual(t2.by, '아빠', '처음 기록한 사람 유지');
  assert.strictEqual(t2.updatedAt, '2026-10-24 18:00:00');
  assert.strictEqual(env.sheets['상담진료기록'].getLastRow(), 4, '수정은 새 행을 만들지 않음');
  r = c.api_deleteVisit(k, consult.id);
  deq(r.visits.map((v) => v.kind), ['병원 상담', '검사']);
  assert.strictEqual(env.sheets['상담진료기록'].getLastRow(), 3);
});

test('상담 진료: 입력 검사와 인증', () => {
  const { c, k } = fresh();
  assert.throws(() => c.api_saveVisit(k, '엄마', { kind: '기타', date: '2026-10-20', content: 'x' }), /구분/);
  assert.throws(() => c.api_saveVisit(k, '엄마', { kind: '상담센터', date: '', content: 'x' }), /날짜/);
  assert.throws(() => c.api_saveVisit(k, '엄마', { kind: '상담센터', date: '2026-10-20' }), /선생님이나 상담 내용/);
  assert.throws(() => c.api_saveVisit(k, '엄마', { kind: '검사', date: '2026-10-20', result: 'x' }), /검사 내용/);
  assert.throws(() => c.api_saveVisit(k, '엄마', { id: 'nope', kind: '검사', date: '2026-10-20', testName: 'x' }), /찾을 수 없어요/);
  assert.throws(() => c.api_saveVisit(k, '할머니', { kind: '검사', date: '2026-10-20', testName: 'x' }), /누가/);
  assert.throws(() => c.api_visits('wrong'), /AUTH/);
  assert.throws(() => c.api_deleteVisit('wrong', 'x'), /AUTH/);
});

test('새로 생긴 탭은 setup을 다시 안 돌려도 자동으로 만들어짐', () => {
  const { env, c, k } = fresh();
  delete env.sheets['상담진료기록'];                 // 예전 버전으로 설치한 시트 상황
  deq(c.api_visits(k), []);
  assert.deepStrictEqual(env.sheets['상담진료기록'].rows[0].slice(0, 3), ['기록ID', '구분', '날짜']);
  c.api_saveVisit(k, '엄마', { kind: '검사', date: '2026-10-20', testName: 'MRI' });
  assert.strictEqual(c.api_visits(k)[0].testName, 'MRI');
});

test('예전 "상담검사기록" 탭은 이름만 바꿔서 기록 유지', () => {
  const { env, c, k } = fresh();
  c.api_saveVisit(k, '엄마', { kind: '검사', date: '2026-10-20', testName: 'MRI' });
  env.sheets['상담진료기록'].setName('상담검사기록');      // 지난 버전으로 쓰던 상태
  const list = c.api_visits(k);
  assert.strictEqual(list[0].testName, 'MRI');
  assert.ok(env.sheets['상담진료기록'] && !env.sheets['상담검사기록']);
});

test('상담대비 기록: 직접 적은 지속 시간 저장', () => {
  const { env, c, k } = fresh();
  c.api_saveSeizure(k, '엄마', { date: '2026-10-24', time: '10:00', duration: '2시간 넘게 멍하게 있었음 (중간에 잠듦)', type: '멍해짐' });
  assert.strictEqual(env.sheets['상담대비기록'].rows[1][3], '2시간 넘게 멍하게 있었음 (중간에 잠듦)'.slice(0, 30));
});

test('상담대비 기록 수정: 같은 행을 고치고 처음 기록한 사람은 유지', () => {
  const { env, c, k } = fresh();
  env.setNow(at('14:12'));
  c.api_saveSeizure(k, '아이', { date: '2026-10-24', time: '14:05', duration: '1분', type: '멍해짐', situation: '공부 중', aura: ['쓴맛'], memo: '처음 메모' });
  c.api_saveSeizure(k, '엄마', { date: '2026-10-23', time: '09:00', duration: '5분', type: '기타' });
  let list = c.api_seizures(k);
  deq(list.map((x) => x.date + ' ' + x.time), ['2026-10-24 14:05', '2026-10-23 09:00'], '최근 것부터');
  const first = list[0];
  assert.strictEqual(first.aura, '쓴맛');
  assert.strictEqual(first.updatedAt, '');
  env.setNow(at('20:00'));
  c.api_saveSeizure(k, '아빠', { id: first.id, date: '2026-10-24', time: '14:00', duration: '30분 이상', type: '전신 떨림', situation: '게임 중', aura: ['쓴맛', '공포감'], medState: '미복용', memo: '고친 메모' });
  list = c.api_seizures(k);
  const e = list.find((x) => x.id === first.id);
  deq([e.time, e.duration, e.type, e.situation, e.aura, e.medState, e.memo], ['14:00', '30분 이상', '전신 떨림', '게임 중', '쓴맛, 공포감', '미복용', '고친 메모']);
  assert.strictEqual(e.by, '아이', '처음 기록한 사람 유지');
  assert.strictEqual(e.updatedAt, '2026-10-24 20:00:00');
  assert.strictEqual(env.sheets['상담대비기록'].getLastRow(), 3, '새 행을 만들지 않음');
  assert.strictEqual(c.api_month(k, 2026, 10).days[23].seizures[0].id, first.id, '달력 상세에도 ID가 있음');
  c.api_deleteSeizure(k, first.id);
  deq(c.api_seizures(k).map((x) => x.date), ['2026-10-23']);
  assert.throws(() => c.api_saveSeizure(k, '엄마', { id: 'nope', type: '기타' }), /찾을 수 없어요/);
  assert.throws(() => c.api_seizures('wrong'), /AUTH/);
  assert.throws(() => c.api_deleteSeizure('wrong', 'x'), /AUTH/);
});

test('예전 상담대비기록 탭(수정시각 칸 없음)도 수정하면 칸이 생김', () => {
  const { env, c, k } = fresh();
  const sh = env.sheets['상담대비기록'];
  sh.rows[0] = sh.rows[0].slice(0, 11);                  // 예전 머리글 (수정시각 없음)
  sh.rows.push(['S_OLD', '2026-10-20', '10:00', '2분', '부분 경련', '', '', '', '', '엄마', '2026-10-20 10:05:00']);
  env.setNow(at('09:00'));
  c.api_saveSeizure(k, '아빠', { id: 'S_OLD', date: '2026-10-20', time: '10:00', duration: '1분', type: '부분 떨림' });
  assert.strictEqual(sh.rows[0][11], '수정시각');
  const e = c.api_seizures(k).find((x) => x.id === 'S_OLD');
  assert.strictEqual(e.type, '부분 떨림');
  assert.strictEqual(e.updatedAt, '2026-10-24 09:00:00');
  assert.strictEqual(sh.rows[0].length, 12, '머리글은 한 번만 추가');
  c.api_saveSeizure(k, '아빠', { id: 'S_OLD', date: '2026-10-20', time: '10:00', type: '기타' });
  assert.strictEqual(sh.rows[0].length, 12);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
