const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const helpers = html.slice(html.indexOf('    function updateHistorySeriesKey('), html.indexOf('    const LATEST_UPDATE_VERSION'));
const { consolidateUpdateHistory } = Function(`${helpers}; return { consolidateUpdateHistory };`)();

test('10月16日の機能追加と修正はマイナー更新0.26.0へまとめる', () => {
  const start = html.indexOf('const UPDATE_HISTORY =') + 'const UPDATE_HISTORY ='.length;
  const source = html.slice(start, html.indexOf('    function updateReadId(', start)).trim().replace(/;$/, '');
  const history = Function(`return ${source};`)();
  assert.equal(history[0].version, 'ver.0.26.0');
  assert.equal(history[0].versioning, 'semver');
  for (const title of ['コイントス', 'バフ演出', '出席者の継続効果']) {
    assert.ok(history[0].changes.some(change => change.title === title));
  }
  assert.equal(history.filter(entry => entry.date === '2026年10月16日').length, 1);
  assert.equal(consolidateUpdateHistory(history)[0].displayVersion, 'ver.0.26.0');
});

test('同日に公開したマイナー・パッチ更新は別々のバージョンで表示する', () => {
  const entries = ['ver.0.24.1', 'ver.0.24.0', 'ver.0.23.20'].map(version => ({
    version, versioning: 'semver', date: '2026年10月13日', changes: []
  }));
  assert.deepEqual(consolidateUpdateHistory(entries).map(entry => entry.displayVersion), entries.map(entry => entry.version));
});

test('旧履歴の同日統合表示は変えない', () => {
  const entries = ['ver.0.17.3', 'ver.0.17.0'].map(version => ({ version, date: '2026年8月11日' }));
  assert.deepEqual(consolidateUpdateHistory(entries).map(entry => entry.displayVersion), ['ver.0.17.0']);
});
