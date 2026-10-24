// Apps Script 서비스를 흉내 내서 Code.gs를 Node에서 실행하기 위한 도구 (테스트 전용)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getDisplayValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.rows[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) vals.push(row[this.c - 1 + j] == null ? '' : String(row[this.c - 1 + j]));
      out.push(vals);
    }
    return out;
  }
  getValues() { return this.getDisplayValues(); }
  setValues(vals) {
    if (this.r - 1 + vals.length > this.sheet.maxRows) throw new Error('range out of bounds');
    vals.forEach((row, i) => {
      const target = this.sheet.rows[this.r - 1 + i] || (this.sheet.rows[this.r - 1 + i] = []);
      row.forEach((v, j) => { target[this.c - 1 + j] = v; });
    });
    for (let i = 0; i < this.sheet.rows.length; i++) if (!this.sheet.rows[i]) this.sheet.rows[i] = [];
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.maxRows = 1000; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.rows.map((r) => { let n = 0; (r || []).forEach((v, j) => { if (v !== '' && v != null) n = j + 1; }); return n; })); }
  getMaxRows() { return this.maxRows; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  insertRowsAfter(after, n) { this.maxRows += n; }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  setFrozenRows() {}
}

function tzParts(date) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = {};
  f.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
  return p;
}

function createEnv(opts = {}) {
  let nowMs = opts.now ? Date.parse(opts.now) : Date.now();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(nowMs); else super(...a); }
    static now() { return nowMs; }
  }
  const sheets = {};
  const props = {};
  const fetches = [];
  const triggers = [];
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new Sheet(n)),
  };
  const ctx = {
    console: { log: () => {}, warn: () => {}, error: console.error },
    Date: FakeDate, Math, JSON, String, Number, Array, Object, Error, RegExp, isNaN, parseFloat,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Seoul' },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (m) => ({ create: () => triggers.push({ fn, m, getHandlerFunction: () => fn }) }) }) }),
    },
    UrlFetchApp: { fetch: (url, o) => { fetches.push({ url, body: JSON.parse(o.payload) }); return { getResponseCode: () => 200, getContentText: () => '{}' }; } },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = tzParts(d);
        return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
          .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second).replace(/^H$/, String(Number(p.hour)));
      },
      parseDate: (s) => new RealDate(s.replace(' ', 'T') + '+09:00'),
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s)).digest()).map((b) => (b > 127 ? b - 256 : b)),
    },
    HtmlService: {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return {
    ctx, sheets, props, fetches, triggers,
    setNow: (iso) => { nowMs = Date.parse(iso); },
    key: () => props.APP_KEY,
  };
}

module.exports = { createEnv };
