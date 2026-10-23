const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('0.31.0以降の更新情報に並べ関連を載せず通常版のカード調整を残す', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('const UPDATE_HISTORY =') + 'const UPDATE_HISTORY ='.length;
  const source = html.slice(start, html.indexOf('    function updateReadId(', start)).trim().replace(/;$/, '');
  const history = Function(`return ${source};`)();
  const releaseIndex = history.findIndex(entry => entry.version === 'ver.0.31.0');
  assert.ok(releaseIndex >= 0);
  assert.doesNotMatch(JSON.stringify(history.slice(0, releaseIndex + 1)), /七並べ|チバトル並べ|並べ専用/);
  const release = history[releaseIndex];
  for (const title of ['かき揚げ教師', '窓辺イーター', 'ジョブズウッディ', '一旦', '見習いヴァンパイア', '全ロック']) {
    assert.ok(release.changes.some(change => change.title === title), title);
  }
  assert.ok(release.changes.some(change => change.title === '効果による出席先・列の選択'));
});
