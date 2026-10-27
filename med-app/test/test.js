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

test('setup: 시트, 비밀 키, 토픽, 트리거', () => {
  const env = createEnv({ now: at('07:00') });
  env.ctx.setup();
  deq(Object.keys(env.sheets).sort(), ['상담대비기록', '복약기록', '약목록'].sort());
  assert.match(env.props.APP_KEY, /^[A-Za-z0-9]{24}$/);
  assert.match(env.props.NTFY_TOPIC, /^fam-med-[a-z0-9]{12}$/);
  assert.strictEqual(env.triggers.length, 1);
  env.ctx.setup();
  assert.strictEqual(env.triggers.length, 1, '두 번 실행해도 트리거는 하나');
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

test('알림: 30분/60분, 중복 없음, 기록하면 멈춤', () => {
  const { env, c, k, sched } = fresh();
  const titles = () => env.fetches.map((f) => f.body.title);
  env.setNow(at('08:20')); c.checkReminders();
  assert.strictEqual(env.fetches.length, 0);
  env.setNow(at('08:35')); c.checkReminders();
  deq(titles(), ['08:00 약 먹었나요?']);
  assert.strictEqual(env.fetches[0].body.topic, env.props.NTFY_TOPIC);
  assert.strictEqual(env.fetches[0].body.click, 'https://script.google.com/macros/s/TEST/exec');
  assert.ok(!JSON.stringify(env.fetches[0].body).includes(k), '알림에 비밀 키 없음');
  env.setNow(at('08:50')); c.checkReminders();
  assert.strictEqual(env.fetches.length, 1, '같은 단계는 한 번만');
  env.setNow(at('09:05')); c.checkReminders();
  assert.strictEqual(titles()[1], '08:00 약, 아직 기록이 없어요');
  assert.strictEqual(env.fetches[1].body.priority, 5);
  env.setNow(at('09:20')); c.checkReminders();
  assert.strictEqual(env.fetches.length, 2);
  // 20:00 회차는 기록하면 알림 없음
  env.setNow(at('20:05')); c.api_takeDose(k, '아빠', sched.id, '20:00');
  env.setNow(at('20:35')); c.checkReminders();
  assert.strictEqual(env.fetches.length, 2);
});

test('알림: 늦게 시작해도 2차만 한 번, 조용한 시간엔 없음', () => {
  const { env, c } = fresh();
  env.setNow(at('09:10')); c.checkReminders();
  env.setNow(at('09:25')); c.checkReminders();
  deq(env.fetches.map((f) => f.body.title), ['08:00 약, 아직 기록이 없어요']);
  env.setNow(at('23:30')); c.checkReminders();
  env.setNow(at('06:45', '2026-10-25')); c.checkReminders();
  assert.strictEqual(env.fetches.length, 1);
});

test('알림: 재고 부족은 하루 한 번, 9시 이후', () => {
  const { env, c, k } = fresh();
  c.api_addMed(k, { name: '데파킨', dose: '2ml', stock: '20ml', times: ['08:00', '20:00'] });
  const dep = c.api_today(k).meds.find((m) => m.name === '데파킨');
  assert.strictEqual(dep.daysLeft, 5);
  assert.strictEqual(dep.low, true);
  env.setNow(at('08:00')); c.checkReminders();
  assert.strictEqual(env.fetches.filter((f) => f.body.title.includes('얼마 안')).length, 0);
  env.setNow(at('09:00')); c.checkReminders();
  env.setNow(at('09:15')); c.checkReminders();
  const stock = env.fetches.filter((f) => f.body.title.includes('얼마 안'));
  assert.strictEqual(stock.length, 1);
  assert.match(stock[0].body.message, /데파킨 20ml \(약 5일분\)/);
  assert.doesNotMatch(stock[0].body.message, /케프라/);
});

test('경련 기록 저장과 가족 알림', () => {
  const { env, c, k } = fresh();
  env.setNow(at('14:12'));
  c.api_saveSeizure(k, '아이', { date: '2026-10-24', time: '14:05', duration: '1분', type: '부분 경련', situation: '일상생활 중', aura: ['쓴맛', '공포감'], medState: '제때 복용', memo: '금방 회복' });
  const row = env.sheets['상담대비기록'].getRange(2, 1, 1, 11).getDisplayValues()[0];
  deq(row.slice(1, 10), ['2026-10-24', '14:05', '1분', '부분 경련', '일상생활 중', '쓴맛, 공포감', '제때 복용', '금방 회복', '아이']);
  const n = env.fetches[env.fetches.length - 1].body;
  assert.strictEqual(n.title, '상담대비 기록이 추가됐어요');
  assert.doesNotMatch(n.message, /부분|쓴맛|금방/, '알림에 상세 건강정보 없음');
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

test('복용 중단: 목록·알림에서 빠지고 기록은 남음', () => {
  const { env, c, k, sched } = fresh();
  env.setNow(at('08:03'));
  c.api_takeDose(k, '엄마', sched.id, '08:00');
  const r = c.api_stopMed(k, sched.id);
  assert.strictEqual(r.state.meds.find((x) => x.id === sched.id), undefined);
  assert.strictEqual(env.sheets['복약기록'].getLastRow(), 2);
  env.setNow(at('20:45')); c.checkReminders();
  assert.strictEqual(env.fetches.length, 0, '중단한 약은 알림 없음');
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
  assert.strictEqual(Object.keys(env.sheets).length, 3, '새 탭을 따로 만들지 않음');
});

test('setup 없이도 예전 탭을 찾아 이름을 바꿈', () => {
  const { env, c, k } = fresh();
  env.sheets['상담대비기록'].setName('경련기록');
  c.api_saveSeizure(k, '엄마', { date: '2026-10-24', time: '10:00', type: '기타' });
  assert.ok(env.sheets['상담대비기록'] && !env.sheets['경련기록']);
  assert.strictEqual(env.sheets['상담대비기록'].getLastRow(), 2);
});

test('상담대비 기록: 알림 결과를 알려 주고, 알림이 실패해도 기록은 한 번만 저장', () => {
  const { env, c, k } = fresh();
  env.setNow(at('14:12'));
  const ok = c.api_saveSeizure(k, '엄마', { date: '2026-10-24', time: '14:05', duration: '30분 이상', type: '멍해짐', situation: '게임 중' });
  assert.strictEqual(ok.status, 'ok');
  assert.strictEqual(ok.notified, true);
  env.net.fail = true;
  const r = c.api_saveSeizure(k, '아빠', { date: '2026-10-24', time: '15:00', duration: '1시간 이상', type: '전신 떨림', situation: '핸드폰 중' });
  assert.strictEqual(r.status, 'ok', '네트워크 오류여도 오류로 돌려보내지 않음');
  assert.strictEqual(r.notified, false);
  assert.strictEqual(env.sheets['상담대비기록'].getLastRow(), 3, '두 건만 저장 (중복 없음)');
  const row = env.sheets['상담대비기록'].rows[2];
  deq(row.slice(3, 6), ['1시간 이상', '전신 떨림', '핸드폰 중']);
  env.net.fail = false;
  env.props.NTFY_TOPIC = '';
  assert.strictEqual(c.api_saveSeizure(k, '엄마', { type: '기타' }).notified, false, '토픽이 없으면 보내지 않음');
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
