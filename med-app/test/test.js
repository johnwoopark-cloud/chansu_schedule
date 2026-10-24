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
  deq(Object.keys(env.sheets).sort(), ['경련기록', '복약기록', '약목록'].sort());
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
  const row = env.sheets['경련기록'].getRange(2, 1, 1, 11).getDisplayValues()[0];
  deq(row.slice(1, 10), ['2026-10-24', '14:05', '1분', '부분 경련', '일상생활 중', '쓴맛, 공포감', '제때 복용', '금방 회복', '아이']);
  const n = env.fetches[env.fetches.length - 1].body;
  assert.strictEqual(n.title, '경련 기록이 추가됐어요');
  assert.doesNotMatch(n.message, /부분|쓴맛|금방/, '알림에 상세 건강정보 없음');
});

test('경련 기록: 이상한 날짜·시각은 지금으로', () => {
  const { env, c, k } = fresh();
  env.setNow(at('14:12'));
  c.api_saveSeizure(k, '엄마', { date: 'x', time: '99:99', type: '기타' });
  const row = env.sheets['경련기록'].getRange(2, 1, 1, 3).getDisplayValues()[0];
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

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
