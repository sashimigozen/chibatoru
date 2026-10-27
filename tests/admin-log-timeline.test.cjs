const test=require('node:test');
const assert=require('node:assert/strict');
const {renderTimeline}=require('../server/admin-log-timeline');
const fixture=require('./fixtures/readable-log.cjs');
test('コイン・マリガン・先後攻・手札・講義室チェックを実際の記録順で表示し、データを変えない',()=>{
  const log=fixture(),before=JSON.stringify(log);
  const html=renderTimeline(log);
  assert.equal(JSON.stringify(log),before);
  assert.match(html,/選択：表 ／ 結果：表/);
  assert.ok(html.indexOf('id="log-coin"')<html.indexOf('id="log-mulligan"'));
  assert.ok(html.indexOf('id="log-turn-1"')<html.indexOf('id="log-turn-1-check"'));
  assert.ok(html.indexOf('id="log-turn-1-check"')<html.indexOf('id="log-turn-2"'));
  const first=html.split('id="log-turn-1"')[1].split('id="log-turn-1-check"')[0];
  const second=html.split('id="log-turn-2"')[1].split('id="log-turn-2-check"')[0];
  const check=html.split('id="log-turn-2-check"')[1];
  assert.match(first,/先攻1ターン目/);assert.match(first,/花子/);
  assert.match(second,/後攻1ターン目/);assert.match(second,/太郎/);
  assert.match(second,/ドロー「定規」/);assert.doesNotMatch(first,/ドロー「定規」/);
  assert.match(second,/<li>一般学生<\/li><li>定規<\/li>/);
  assert.doesNotMatch(second,/気力へのダメージ/);
  assert.match(check,/気力へのダメージ → 花子の気力／2ダメージ/);
  assert.match(check,/1行1列：一般学生/);
});
test('欠落した手札やチェックの区切りを推測せず、名前をHTML実行しない',()=>{
  const html=renderTimeline({summary:{playerNames:{player:'<script>bad</script>'}},events:[{eventType:'turn_start',side:'player',turn:'先攻1ターン目',handCount:3},{eventType:'action',side:'player',actionType:'draw',cardName:'<img src=x>'}]});
  assert.match(html,/3枚（内訳の記録なし）/);
  assert.match(html,/区切りの記録なし/);
  assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<script>|<img/);
});
