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
  assert.ok(tpl.includes('var SHOW_SEIZURE = false;'), '기본값은 경련 기록 꺼짐');
  let showSeizure = true; // 기능 자체는 켜서 검사하고, 마지막에 기본값(꺼짐)을 따로 확인
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const k = (u.searchParams.get('k') || '').replace(/[^A-Za-z0-9]/g, '');
    const html = tpl
      .replace('var SHOW_SEIZURE = false;', 'var SHOW_SEIZURE = ' + showSeizure + ';')
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
  assert.strictEqual(Object.keys(env.sheets).length, 3);
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

  // 8. 경련 기록
  env.setNow(at('14:10'));
  await page.click('nav [data-v="seizure"]');
  await settle();
  await page.fill('#szDate', '2026-10-24'); // 브라우저는 실제 날짜를 쓰므로 고정
  await page.fill('#szTime', '14:02');
  await page.click('[data-act="saveSz"]');
  await settle();
  assert.match(await text(), /경련 종류를 골라 주세요/);
  await page.click('[data-v="duration|2분"]');
  await page.click('[data-v="type|부분 경련"]');
  await page.click('[data-v="situation|일상생활 중"]');
  await page.click('[data-act="szAura"][data-v="쓴맛"]');
  await page.click('[data-v="medState|제때 복용"]');
  await page.fill('#szMemo', '금방 회복, 잘 놀고 있음');
  await snap('seizure-form');
  await page.click('[data-act="saveSz"]');
  await settle();
  assert.match(await text(), /경련 기록 저장/);
  const szRow = env.sheets['경련기록'].getRange(2, 1, 1, 11).getDisplayValues()[0];
  assert.deepStrictEqual(szRow.slice(1, 10), ['2026-10-24', '14:02', '2분', '부분 경련', '일상생활 중', '쓴맛', '제때 복용', '금방 회복, 잘 놀고 있음', '아이']);
  assert.ok(env.fetches.some((f) => f.body.title === '경련 기록이 추가됐어요'));

  // 9. 달력
  await page.click('nav [data-v="cal"]');
  await page.waitForSelector('.cal');
  await page.click('.cal button[data-v="2026-10-24"]');
  await settle();
  t = await text();
  assert.match(t, /10월 24일 기록/);
  assert.match(t, /경련 14:02 · 2분/);
  assert.match(t, /두통약 필요 시 · 두통/);
  assert.match(t, /이번 달 경련\s*1회/);
  await snap('calendar');

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

  // 9-3. 기본값(경련 기록 꺼짐): 탭·달력 표시·통계에서 빠지고 필요 시 복용 횟수가 보임
  showSeizure = false;
  await page.reload();
  await settle();
  t = await text();
  assert.doesNotMatch(t, /경련/);
  assert.strictEqual(await page.locator('nav.tabs button').count(), 2);
  await page.click('nav [data-v="cal"]');
  await page.waitForSelector('.cal');
  await page.click('.cal button[data-v="2026-10-24"]');
  await settle();
  t = await text();
  assert.doesNotMatch(t, /경련/);
  assert.match(t, /이번 달 필요 시 복용\s*2회/);
  assert.match(t, /두통약 필요 시 · 두통/);
  await snap('no-seizure-calendar');
  await page.click('nav [data-v="today"]');
  showSeizure = true;
  await page.reload();
  await settle();

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
