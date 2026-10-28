// 화면 테스트: index.html을 브라우저로 열고, google.script.run을 Node에서 실행한 Code.gs에 연결한다.
// 실행: node med-app/test/ui.js [스크린샷 폴더]
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { chromium } = require('playwright');
const { createEnv } = require('./harness');

const outDir = process.argv[2] || '';
const at = (hm, day = '2026-10-24') => day + 'T' + hm + ':00+09:00';

(async () => {
  const env = createEnv({ now: at('07:30') });
  env.ctx.setup();
  const KEY = env.key();
  const APP_URL = 'http://localhost:PORT/';

  const tpl = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(tpl.includes('var SHOW_SEIZURE = true;'), '기본값은 상담대비 기록 켜짐');
  let showSeizure = true; // 켜진 상태로 검사하고, 마지막에 껐을 때를 따로 확인
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const k = (u.searchParams.get('k') || '').replace(/[^A-Za-z0-9]/g, '');
    const html = tpl
      .replace('var SHOW_SEIZURE = true;', 'var SHOW_SEIZURE = ' + showSeizure + ';')
      .replace('<?!= jsonForHtml_(urlKey) ?>', JSON.stringify(k))
      .replace('<?!= jsonForHtml_(appUrl) ?>', JSON.stringify(APP_URL.replace('PORT', server.address().port)))
      .replace('<head>', '<head><script>window.google={script:{get run(){return makeRun();}}};function makeRun(){var ok,fail;var p=new Proxy({},{get:function(t,n){if(n==="withSuccessHandler")return function(f){ok=f;return p;};if(n==="withFailureHandler")return function(f){fail=f;return p;};return function(){var a=[].slice.call(arguments);window.__gas(n,a).then(function(r){if(r&&r.__err)fail&&fail(new Error(r.__err));else ok&&ok(r);});};}});return p;}</script>');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  let oldServer = false; // 예전 Code.gs가 배포된 상황 흉내
  await page.exposeFunction('__gas', (name, args) => {
    if (!/^api_/.test(name)) return { __err: 'not callable' };
    if (oldServer && (name === 'api_updateMed' || name === 'api_stopMed')) return { __err: 'Script function not found: ' + name };
    try {
      const r = JSON.parse(JSON.stringify(env.ctx[name].apply(null, args)));
      if (oldServer && name === 'api_checkKey') delete r.version;
      return r;
    } catch (e) { return { __err: e.message }; }
  });
  let shot = 0;
  const snap = async (name) => { if (outDir) await page.screenshot({ path: path.join(outDir, String(++shot).padStart(2, '0') + '-' + name + '.png'), fullPage: true }); };
  const text = () => page.innerText('#app');
  const settle = () => page.waitForTimeout(150);

  // 1. 키 없이 열기
  await page.goto(base);
  await settle();
  assert.match(await text(), /등록이 필요해요/);
  // 2. 잘못된 키
  await page.goto(base + '?k=wrong');
  await settle();
  assert.match(await text(), /주소가 맞지 않아요/);
  // 3. 가족 주소로 등록
  await page.goto(base + '?k=' + KEY);
  await settle();
  assert.match(await text(), /누가 쓰나요/);
  await snap('choose-who');
  await page.click('button[data-v="엄마"]');
  await settle();
  assert.match(await text(), /이 폰이 등록됐어요/);
  assert.match(await text(), /아직 등록된 약이 없어요/);
  await snap('registered-empty');

  // 4. 키 없는 주소로 다시 열어도 로그인 유지 (홈 화면용 주소)
  await page.goto(base);
  await settle();
  assert.match(await text(), /오늘의 약/);
  assert.doesNotMatch(await text(), /이 폰이 등록됐어요/);

  // 5. 약 추가 (정해진 시간)
  await page.click('[data-act="openAddMed"]');
  await page.fill('#mName', '케프라액');
  await page.fill('#mDose', '0.5ml');
  await page.fill('#mStock', '42ml');
  await page.click('[data-act="formTime"][data-v="08:00"]');
  await page.click('[data-act="formTime"][data-v="20:00"]');
  await snap('add-med');
  await page.click('[data-act="saveMed"]');
  await settle();
  // 두 번째 정해진 약
  await page.click('[data-act="openAddMed"]');
  await page.fill('#mName', '데파킨 시럽');
  await page.fill('#mDose', '2ml');
  await page.fill('#mStock', '20ml');
  await page.click('[data-act="formTime"][data-v="08:00"]');
  await page.click('[data-act="saveMed"]');
  await settle();
  // 필요 시 약
  await page.click('[data-act="openAddMed"]');
  await page.fill('#mName', '두통약');
  await page.fill('#mDose', '5ml');
  await page.fill('#mStock', '90ml');
  await page.click('[data-act="formKind"][data-v="1"]');
  await page.click('[data-act="formGap"][data-v="6"]');
  await snap('add-prn');
  await page.click('[data-act="saveMed"]');
  await settle();
  let t = await text();
  assert.match(t, /복용 중인 약\n/);
  assert.doesNotMatch(t, /복용 중인 약 ·/, '약 개수 표시 없음');
  assert.match(t, /08:00[\s\S]*0 \/ 2 완료/);
  assert.match(t, /필요할 때 먹는 약/);
  assert.match(t, /데파킨 시럽[\s\S]*20ml · 10일분/);

  // 5-1. 약 수정: 데파킨 용량 2ml → 2.5ml, 20:00 추가, 남은 양 25ml
  await page.click('[data-act="openEditMed"][aria-label="데파킨 시럽 수정"]');
  assert.strictEqual(await page.inputValue('#mName'), '데파킨 시럽');
  assert.strictEqual(await page.inputValue('#mDose'), '2ml');
  assert.strictEqual(await page.inputValue('#mStock'), '20ml');
  assert.match(await text(), /약 수정[\s\S]*저장하기[\s\S]*이 약 복용 중단/);
  await page.fill('#mDose', '2.5ml');
  await page.fill('#mStock', '25ml');
  await page.click('[data-act="formTime"][data-v="20:00"]');
  await snap('edit-med');
  await page.click('[data-act="saveMed"]');
  await settle();
  t = await text();
  assert.match(t, /데파킨 시럽 수정됨/);
  assert.match(t, /20:00[\s\S]*0 \/ 2 완료/);
  assert.match(t, /데파킨 시럽\n2.5ml · 08:00 · 20:00[\s\S]*25ml · 5일분/);
  assert.strictEqual(Object.keys(env.sheets).length, 4);
  assert.strictEqual(env.sheets['약목록'].getLastRow(), 4, '수정은 새 행을 만들지 않음');

  // 6. 복용 기록
  env.setNow(at('08:03'));
  const meds = env.ctx.api_today(KEY).meds;
  const kep = meds.find((m) => m.name === '케프라액');
  const dep = meds.find((m) => m.name === '데파킨 시럽');
  const hd = meds.find((m) => m.name === '두통약');
  await page.click(`[data-act="dose"][data-v="${kep.id}|08:00"]`);
  await settle();
  t = await text();
  assert.match(t, /엄마 · 08:03 기록/);
  assert.match(t, /1 \/ 2 완료/);
  // 다른 가족(아빠)이 같은 약을 서버에서 먼저 기록한 경우
  env.ctx.api_takeDose(KEY, '아빠', dep.id, '08:00');
  await page.click('button[data-act="who"][data-v="아빠"]');
  await page.click(`[data-act="dose"][data-v="${dep.id}|08:00"]`);
  await settle();
  assert.match(await text(), /방금 아빠가 08:03에 먼저 기록했어요/);
  await page.click('[data-act="clearWarn"]');
  t = await text();
  assert.match(t, /모두 완료/);
  // 완료된 걸 또 누르면 경고 + 취소 가능
  await page.click(`[data-act="dose"][data-v="${kep.id}|08:00"]`);
  await settle();
  assert.match(await text(), /이미 엄마가 08:03에 08:00 케프라액을\(를\) 기록했어요/);
  await snap('dup-warning');
  await page.click('[data-act="undo"]');
  await settle();
  assert.match(await text(), /기록을 취소했어요/);
  assert.match(await text(), /1 \/ 2 완료/);
  await page.click(`[data-act="dose"][data-v="${kep.id}|08:00"]`);
  await settle();

  // 7. 필요 시 약
  env.setNow(at('10:00'));
  await page.click('[data-act="reason"][data-v="두통"]');
  await page.click(`[data-act="prn"][data-v="${hd.id}"]`);
  await settle();
  assert.match(await text(), /오늘 1회 · 마지막 아빠 10:00 \(두통\)/);
  env.setNow(at('12:30'));
  await page.click('button[data-act="who"][data-v="아이"]');
  await page.click(`button.btn[data-act="prn"][data-v="${hd.id}"]`);
  await settle();
  assert.match(await text(), /2.5시간밖에 안 지났어요. 최소 간격은 6시간/);
  await snap('prn-too-soon');
  await page.click(`.alert [data-act="prn"][data-v="${hd.id}"]`);
  await settle();
  assert.match(await text(), /오늘 2회 · 마지막 아이 12:30 \(두통\)/);
  assert.doesNotMatch(await text(), /그래도 기록/);
  await snap('today');

  // 8. 상담대비 기록
  env.setNow(at('14:10'));
  await page.click('nav [data-v="seizure"]');
  await settle();
  await page.fill('#szDate', '2026-10-24'); // 브라우저는 실제 날짜를 쓰므로 고정
  await page.fill('#szTime', '14:02');
  await page.click('[data-act="saveSz"]');
  await settle();
  assert.match(await text(), /종류를 골라 주세요/);
  assert.match(await text(), /상담대비 기록/);
  t = await text();
  assert.match(t, /지속 시간\s*하나 선택\s*1분\s*5분\s*10분 이상\s*30분 이상\s*1시간 이상\s*기타/);
  assert.match(t, /전신 떨림\s*부분 떨림\s*멍해짐\s*기타/);
  assert.match(t, /수면 중\s*기상 직후\s*잠들기 전\s*공부 중\s*게임 중\s*핸드폰 중\s*일상생활 중\s*기타/);
  assert.doesNotMatch(t, /경련|2분|30초/);
  assert.strictEqual(await page.locator('#szDurEtc').count(), 0, '기타를 고르기 전에는 입력 칸 없음');
  await page.click('[data-v="duration|기타"]');
  await page.fill('#szDurEtc', '3분 정도');
  await page.click('[data-v="duration|5분"]');
  assert.strictEqual(await page.locator('#szDurEtc').count(), 0, '다른 걸 고르면 입력 칸 숨김');
  await page.click('[data-v="duration|기타"]');
  assert.strictEqual(await page.inputValue('#szDurEtc'), '3분 정도', '적은 내용은 남아 있음');
  await page.click('[data-v="type|부분 떨림"]');
  await page.click('[data-v="situation|공부 중"]');
  await page.click('[data-act="szAura"][data-v="쓴맛"]');
  await page.click('[data-v="medState|제때 복용"]');
  await page.fill('#szMemo', '금방 회복, 잘 놀고 있음');
  await snap('seizure-form');
  await page.click('[data-act="saveSz"]');
  await settle();
  assert.match(await text(), /상담대비 기록을 저장했어요/);
  assert.doesNotMatch(await text(), /알림/);
  const szRow = env.sheets['상담대비기록'].getRange(2, 1, 1, 11).getDisplayValues()[0];
  assert.deepStrictEqual(szRow.slice(1, 10), ['2026-10-24', '14:02', '3분 정도', '부분 떨림', '공부 중', '쓴맛', '제때 복용', '금방 회복, 잘 놀고 있음', '아이']);
  assert.strictEqual(env.fetches.length, 0, '알림 전송 없음');

  // 9. 달력
  await page.click('nav [data-v="cal"]');
  await page.waitForSelector('.cal');
  await page.click('.cal button[data-v="2026-10-24"]');
  await settle();
  t = await text();
  assert.match(t, /10월 24일 기록/);
  assert.match(t, /상담대비 기록 14:02 · 3분 정도/);
  assert.match(t, /부분 떨림 · 공부 중/);
  assert.match(t, /두통약 필요 시 · 두통/);
  assert.match(t, /상담대비 기록\s*1회/);
  assert.match(t, /필요 시 복용\s*2회/);
  assert.match(t, /이 날 복약 기록하기/);
  await snap('calendar');

  // 9-a. 상담대비 기록 수정: 달력 상세에서 [수정] → 값이 채워진 폼 → 수정 저장
  const szId = env.sheets['상담대비기록'].rows[1][0];
  await page.click(`[data-act="editSz"][data-v="${szId}"]`);
  await settle();
  t = await text();
  assert.match(t, /기록 수정 중/);
  assert.strictEqual(await page.inputValue('#szTime'), '14:02');
  assert.strictEqual(await page.locator('[data-v="duration|기타"]').getAttribute('aria-pressed'), 'true');
  assert.strictEqual(await page.inputValue('#szDurEtc'), '3분 정도', '직접 적은 지속 시간이 그대로');
  assert.strictEqual(await page.locator('[data-v="type|부분 떨림"]').getAttribute('aria-pressed'), 'true');
  assert.strictEqual(await page.locator('[data-act="szAura"][data-v="쓴맛"]').getAttribute('aria-pressed'), 'true');
  assert.strictEqual(await page.inputValue('#szMemo'), '금방 회복, 잘 놀고 있음');
  await page.click('[data-v="type|멍해짐"]');
  await page.click('[data-act="szAura"][data-v="공포감"]');
  await page.fill('#szMemo', '금방 회복\n저녁에 피곤해함');
  await snap('seizure-edit');
  await page.click('[data-act="saveSz"]');
  await settle();
  t = await text();
  assert.match(t, /상담대비 기록을 고쳤어요/);
  assert.match(t, /최근 기록/);
  assert.match(t, /10\/24 14:02 · 3분 정도\n멍해짐 · 공부 중 · 전조: 쓴맛, 공포감 · 복약: 제때 복용\n금방 회복\n저녁에 피곤해함\n기록: 아이 · 수정함/);
  assert.strictEqual(env.sheets['상담대비기록'].rows.filter((r) => r[0]).length, 2, '머리글 + 1건 (새로 안 생김)');
  assert.strictEqual(env.sheets['상담대비기록'].rows[1][4], '멍해짐');
  // 예전 선택지로 적힌 기록도 값이 사라지지 않음
  env.sheets['상담대비기록'].rows.push(['S_OLD', '2026-10-20', '09:30', '2분', '부분 경련', '일상생활 중', '이상한 맛', '', '', '엄마', '2026-10-20 09:40:00']);
  await page.click('nav [data-v="today"]');
  await page.click('nav [data-v="seizure"]');
  await settle();
  await page.click('[data-act="editSz"][data-v="S_OLD"]');
  await settle();
  assert.strictEqual(await page.locator('[data-v="type|부분 경련"]').getAttribute('aria-pressed'), 'true', '예전 종류도 선택된 채로 보임');
  assert.strictEqual(await page.locator('[data-act="szAura"][data-v="이상한 맛"]').getAttribute('aria-pressed'), 'true');
  assert.strictEqual(await page.inputValue('#szDurEtc'), '2분');
  await page.click('[data-act="saveSz"]');
  await settle();
  assert.deepStrictEqual(env.sheets['상담대비기록'].rows.find((r) => r[0] === 'S_OLD').slice(3, 7), ['2분', '부분 경련', '일상생활 중', '이상한 맛'], '그대로 저장해도 값 유지');
  // 수정 취소, 삭제
  await page.click('[data-act="editSz"][data-v="S_OLD"]');
  await page.click('[data-act="szCancel"]');
  assert.doesNotMatch(await text(), /기록 수정 중/);
  await page.click('[data-act="editSz"][data-v="S_OLD"]');
  await page.click('[data-act="deleteSz"]');
  await settle();
  assert.match(await text(), /기록을 삭제했어요/);
  assert.ok(!env.sheets['상담대비기록'].rows.some((r) => r[0] === 'S_OLD'));

  // 9-0. 지난 날짜 복약 기록: 다음 날 아침에 어제 저녁 약을 기록
  env.setNow(at('09:00', '2026-10-25'));
  await page.click('nav [data-v="today"]');
  await settle();
  t = await text();
  assert.match(t, /오늘\n10월 25일 일요일/);
  assert.strictEqual(await page.locator('[data-act="dayShift"][data-v="1"]').isDisabled(), true, '미래로는 못 감');
  await page.click('[data-act="dayShift"][data-v="-1"]');
  await settle();
  t = await text();
  assert.match(t, /지난 복약 기록/);
  assert.match(t, /어제\n10월 24일 토요일/);
  assert.match(t, /어제 먹은 약 기록하기/);
  assert.doesNotMatch(t, /필요할 때 먹는 약|복용 중인 약/, '지난 날짜엔 정해진 시간 약만');
  assert.match(t, /20:00\n0 \/ 2 완료/);
  await page.click('button[data-act="who"][data-v="엄마"]');
  await page.click(`[data-act="dose"][data-v="${kep.id}|20:00"]`);
  await settle();
  t = await text();
  assert.match(t, /어제 20:00 케프라액 기록됨/);
  assert.match(t, /엄마 · 20:00 기록/);
  const late = env.sheets['복약기록'].rows.filter((r) => r[1] === '2026-10-24' && r[2] === '20:00');
  assert.strictEqual(late.length, 1);
  assert.strictEqual(late[0][9], '나중에 기록');
  await snap('yesterday');
  // 같은 걸 또 누르면 경고, 취소도 그 날짜 기준
  await page.click(`[data-act="dose"][data-v="${kep.id}|20:00"]`);
  assert.match(await text(), /이미 엄마가 20:00에/);
  await page.click('[data-act="undo"]');
  await settle();
  assert.match(await text(), /20:00\n0 \/ 2 완료/);
  assert.strictEqual(env.sheets['복약기록'].rows.filter((r) => r[1] === '2026-10-24' && r[2] === '20:00').length, 0);
  // 7일 전까지만
  for (let i = 0; i < 6; i++) { await page.click('[data-act="dayShift"][data-v="-1"]'); await settle(); }
  assert.match(await text(), /7일 전/);
  assert.strictEqual(await page.locator('[data-act="dayShift"][data-v="-1"]').isDisabled(), true);
  await page.click('[data-act="gotoDay"]');
  await settle();
  assert.match(await text(), /오늘의 약/);
  // 달력에서 날짜를 골라 바로 기록하러 가기
  await page.click('nav [data-v="cal"]');
  await page.waitForSelector('.cal');
  await page.click('.cal button[data-v="2026-10-23"]');
  await settle();
  await page.click('[data-act="gotoDay"][data-v="2026-10-23"]');
  await settle();
  assert.match(await text(), /그제 먹은 약 기록하기/);
  await page.click('nav [data-v="today"]');
  await settle();
  assert.match(await text(), /오늘의 약/, '탭을 누르면 오늘로');

  // 9-1. 복용 중단: 데파킨을 빼면 오늘 화면에서 사라지고 지난 기록은 남음
  await page.click('nav [data-v="today"]');
  await settle();
  await page.click('[data-act="openEditMed"][aria-label="데파킨 시럽 수정"]');
  await page.click('[data-act="stopMed"]');
  await settle();
  t = await text();
  assert.match(t, /데파킨 시럽 복용 중단됨/);
  assert.doesNotMatch(t.replace(/데파킨 시럽 복용 중단됨/, ''), /데파킨/);
  assert.ok(env.sheets['복약기록'].rows.some((r) => r[5] === '데파킨 시럽'), '지난 기록 유지');

  // 9-2. 예전 Code.gs가 배포돼 있으면: 버전 안내가 뜨고, 저장 실패 메시지가 수정 창 위에 보임
  assert.doesNotMatch(await text(), /버전이 서로 달라요/);
  oldServer = true;
  await page.reload();
  await settle();
  assert.match(await text(), /앱 파일 버전이 서로 달라요/);
  await page.click('[data-act="openEditMed"][aria-label="케프라액 수정"]');
  await page.click('[data-act="saveMed"]');
  await settle();
  const toastBox = await page.locator('.toast').boundingBox();
  const onTop = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y).closest('.toast'), [toastBox.x + toastBox.width / 2, toastBox.y + toastBox.height / 2]);
  assert.ok(onTop, '오류 메시지가 수정 창에 가려지지 않음');
  assert.match(await page.innerText('.toast'), /저장하지 못했어요: Script function not found: api_updateMed/);
  await snap('old-server');
  oldServer = false;
  await page.click('[data-act="closeSheet"]');
  await page.reload();
  await settle();

  // 9-3. 상담대비 기록을 끄면: 탭·달력 표시·통계에서 빠짐
  showSeizure = false;
  await page.reload();
  await settle();
  t = await text();
  assert.doesNotMatch(t, /상담대비/);
  assert.strictEqual(await page.locator('nav.tabs button').count(), 3);
  await page.click('nav [data-v="cal"]');
  await page.waitForSelector('.cal');
  await page.click('.cal button[data-v="2026-10-24"]');
  await settle();
  t = await text();
  assert.doesNotMatch(t, /상담대비/);
  assert.match(t, /필요 시 복용\s*2회/);
  assert.match(t, /두통약 필요 시 · 두통/);
  await snap('no-seizure-calendar');
  await page.click('nav [data-v="today"]');
  showSeizure = true;
  await page.reload();
  await settle();

  // 9-4. 상담 진료 탭
  assert.strictEqual(await page.locator('nav.tabs button').count(), 4);
  env.setNow(at('19:00', '2026-10-25'));
  await page.click('nav [data-v="visit"]');
  await settle();
  t = await text();
  assert.match(t, /상담 진료/);
  assert.doesNotMatch(t, /상담·검사/);
  assert.match(t, /아직 기록이 없어요/);
  // 상담센터 상담
  await page.click('[data-act="openVisit"][data-v=""]');
  assert.strictEqual(await page.locator('[data-act="vKind"][aria-pressed="true"]').innerText(), '상담센터');
  await page.click('[data-act="saveVisit"]');
  assert.match(await text(), /담당 선생님이나 상담 내용을 적어 주세요/);
  await page.fill('#vDate', '2026-10-20');
  await page.fill('#vTeacher', '김선생님');
  await page.fill('#vTime', '15:00~15:50');
  const longText = '학교 적응 이야기\n수면 습관 점검\n게임 시간 줄이기\n다음 상담 전까지 일기 쓰기\n엄마와 대화 시간 늘리기';
  await page.fill('#vContent', longText);
  await snap('visit-form');
  await page.click('[data-act="saveVisit"]');
  await settle();
  t = await text();
  assert.match(t, /상담센터 기록을 저장했어요/);
  assert.match(t, /2026년 10월 20일 \(화\)/);
  assert.match(t, /담당 김선생님 · 시간 15:00~15:50/);
  assert.match(t, /전체 보기/, '긴 내용은 접어서 보여 줌');
  await page.click('[data-act="vtoggle"]');
  assert.match(await text(), /엄마와 대화 시간 늘리기/);
  assert.match(await text(), /접기/);
  // 병원 상담 (같은 종류가 아니면 선생님 추천 목록에 안 나옴)
  await page.click('[data-act="openVisit"][data-v=""]');
  await page.click('[data-act="vKind"][data-v="병원 상담"]');
  assert.strictEqual(await page.locator('#vTeacherList option').count(), 0);
  await page.fill('#vDate', '2026-10-24');
  await page.fill('#vTeacher', '이교수님');
  await page.fill('#vContent', '약 용량 유지');
  await page.click('[data-act="saveVisit"]');
  await settle();
  // 검사 (결과는 나중에)
  await page.click('[data-act="openVisit"][data-v=""]');
  await page.click('[data-act="vKind"][data-v="검사"]');
  assert.strictEqual(await page.locator('#vTeacher').count(), 0, '검사는 상담 칸 대신 검사 칸');
  await page.fill('#vDate', '2026-10-22');
  await page.click('[data-act="saveVisit"]');
  assert.match(await text(), /검사 내용을 적어 주세요/);
  await page.fill('#vTest', '뇌파검사(EEG)');
  await page.click('[data-act="saveVisit"]');
  await settle();
  t = await text();
  assert.match(t, /결과 대기/);
  // 최근 날짜 먼저
  const order = await page.locator('main .card b').allInnerTexts();
  assert.deepStrictEqual(order.slice(0, 3), ['2026년 10월 24일 (토)', '2026년 10월 22일 (목)', '2026년 10월 20일 (화)']);
  await snap('visits');
  // 검사만 보기 → 결과 채우기
  await page.click('[data-act="vfilter"][data-v="검사"]');
  t = await text();
  assert.doesNotMatch(t, /이교수님|김선생님/);
  await page.click('[data-act="openVisit"][aria-label="2026-10-22 검사 기록 수정"]');
  assert.strictEqual(await page.inputValue('#vTest'), '뇌파검사(EEG)');
  await page.fill('#vResult', '이상 소견 없음\n6개월 뒤 재검');
  await page.click('[data-act="saveVisit"]');
  await settle();
  t = await text();
  assert.match(t, /기록을 고쳤어요/);
  assert.match(t, /이상 소견 없음\n6개월 뒤 재검/);
  assert.doesNotMatch(t, /결과 대기/);
  assert.match(t, /기록: 엄마 · 수정함/);
  // 같은 종류 새 기록에서는 예전 선생님 이름 추천
  await page.click('[data-act="vfilter"][data-v="상담센터"]');
  await page.click('[data-act="openVisit"][data-v=""]');
  assert.deepStrictEqual(await page.locator('#vTeacherList option').evaluateAll((o) => o.map((x) => x.value)), ['김선생님']);
  await page.click('.sheet [data-act="closeSheet"]');
  // 삭제
  await page.click('[data-act="vfilter"][data-v="전체"]');
  await page.click('[data-act="openVisit"][aria-label="2026-10-24 병원 상담 기록 수정"]');
  await page.click('[data-act="deleteVisit"]');
  await settle();
  t = await text();
  assert.match(t, /기록을 삭제했어요/);
  assert.doesNotMatch(t, /이교수님/);
  const vrows = env.sheets['상담진료기록'].rows.slice(1).filter((r) => r.length);
  assert.strictEqual(vrows.length, 2);
  assert.deepStrictEqual(vrows.map((r) => r[1]).sort(), ['검사', '상담센터']);
  assert.strictEqual(vrows.find((r) => r[1] === '상담센터')[5], longText, '줄바꿈 그대로 저장');

  // 10. 설정 → 로그아웃
  await page.click('[data-act="openSettings"]');
  await snap('settings');
  await page.click('[data-act="logout"]');
  await settle();
  assert.match(await text(), /로그아웃했어요/);
  await page.goto(base);
  await settle();
  assert.match(await text(), /등록이 필요해요/, '로그아웃 후 키 없는 주소로는 못 들어감');

  // 11. 키를 바꾸면 기존 폰 자동 로그아웃
  await page.goto(base + '?k=' + KEY);
  await settle();
  await page.click('button[data-v="엄마"]');
  await settle();
  env.ctx.rotateKey();
  await page.goto(base);
  await settle();
  assert.match(await text(), /다시 등록해 주세요/);

  assert.deepStrictEqual(errors, [], '브라우저 오류 없음');
  await browser.close();
  server.close();
  console.log('UI test passed' + (outDir ? ', screenshots in ' + outDir : ''));
})().catch((e) => { console.error(e); process.exit(1); });
