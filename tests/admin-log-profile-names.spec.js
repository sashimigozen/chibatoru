const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
let server, logDir, base;
test.use({ httpCredentials: { username: 'admin', password: 'profile-log-test' } });
test.beforeAll(async () => {
  const port = await new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
  base = `http://127.0.0.1:${port}`;
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chibatoru-profile-log-ui-'));
  const cloudFile = path.join(logDir, 'cloud.fixture');
  fs.writeFileSync(cloudFile, JSON.stringify([
    { gameId: 'cloud-match', final: true, receivedAt: '2026-10-26T10:00:00.000Z',
      summary: { playerNames: { player: 'クラウド太郎', opponent: 'クラウド花子' }, winner: 'player' },
      events: [{eventType:'game_start', game:{decks:{player:{deckName:'クラウド学生',deckList:{general_student:3,ruler:2}},opponent:{deckName:'クラウド教師',deckList:{general_teacher:2,smiling_lecturer:1}}}}},
        { eventType: 'action', eventSeq: 1, turn: 2, cardName: '一般学生', actionType: 'play_card', side: 'player' }] },
    { gameId: 'cloud-old', final: false, summary: {}, events: [] }
  ]));
  server = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures/admin-cloud-store.cjs'), 'server.js'], { cwd: path.join(__dirname, '../server'),
    env: { ...process.env, PORT: String(port), CHIBATORU_LOG_DIR: logDir,
      CHIBATORU_LOG_ADMIN_PASSWORD: 'profile-log-test', CHIBATORU_D1_API_TOKEN: '',
      CHIBATORU_TEST_CLOUD_LOG_FILE: cloudFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('管理ログの起動待ちがタイムアウトしました')), 5000);
    server.stdout.on('data', data => { if (String(data).includes('listening')) { clearTimeout(timer); resolve(); } });
    server.once('error', reject);
  });
});
test.afterAll(() => { server?.kill('SIGTERM'); if (logDir) fs.rmSync(logDir, { recursive: true, force: true }); });

test('保存済みログの一覧と詳細をプロフィール名の対戦見出しで表示する', async ({ page }) => {
  const imported = await page.request.post(`${base}/admin/logs/import`, { data: { logs: [
    { gameId: 'profile-match', final: true, summary: { playerNames: { player: 'あさまる', opponent: 'チバトル太郎' },
      deckNames: { player: 'デッキA', opponent: 'デッキB' } }, events: [
        {eventType:'game_start',game:{decks:{player:{deckName:'デッキA',deckList:{general_student:3,ruler:2,smiling_lecturer:1}},opponent:{deckName:'デッキB',deckList:{general_teacher:2,retired_card:1}}}}},
        {eventType:'game_end',final:{cardStats:[{side:'opponent',cardId:'retired_card',cardName:'当時のカード名'}]}}
      ] },
    { gameId: 'legacy-match', final: true, events: [] }
  ] } });
  expect(imported.ok()).toBeTruthy();
  await page.goto(`${base}/admin/logs?storage=local`);
  await expect(page.getByRole('columnheader', { name: '対戦', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'あさまる vs チバトル太郎', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'プレイヤー vs 対戦相手', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('profile-log-list.png'), fullPage: true });
  await page.getByRole('link', { name: 'あさまる vs チバトル太郎', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('あさまる vs チバトル太郎');
  await expect(page.getByText('gameId: profile-match', { exact: true })).toBeVisible();
  const own=page.locator('[data-deck-side="player"]');
  await expect(own).not.toBeVisible();
  await page.getByRole("button",{name:"デッキA",exact:true}).click();
  await expect(own).toBeVisible();
  await expect(own).toContainText('6枚・3種類');
  await expect(own.getByRole('img',{name:'一般学生 3枚',exact:true}).locator('.deck-copy-badge')).toHaveText('x3');
  await expect(own.locator('.deck-window-card')).toHaveCount(3);
  await own.getByRole('button',{name:'閉じる'}).click();
  await expect(own).not.toBeVisible();
  await page.getByRole('button',{name:'デッキB',exact:true}).click();
  await expect(own).toContainText('微笑み講師');
  const enemy=page.locator('[data-deck-side="opponent"]');
  await expect(enemy).toContainText('3枚・2種類');
  await expect(enemy).toContainText('当時のカード名');
  await page.screenshot({ path: test.info().outputPath('profile-log-detail.png'), fullPage: true });
});

test('最初にクラウド一覧を表示し、対戦名から中身を開いて戻れる', async ({ page }) => {
  await page.goto(`${base}/admin/logs`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('クラウド保存ログ');
  await expect(page.getByRole('link', { name: 'クラウド太郎 vs クラウド花子', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'プレイヤー vs 対戦相手', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '終了', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '途中', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('サーバー再起動後');
  await page.screenshot({ path: test.info().outputPath('cloud-log-list.png'), fullPage: true });
  await page.getByRole('link', { name: 'クラウド太郎 vs クラウド花子', exact: true }).click();
  await expect(page).toHaveURL(`${base}/admin/logs/archive/cloud-match`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('クラウド太郎 vs クラウド花子');
  await expect(page.getByText('クラウド太郎：出席「一般学生」',{exact:true})).toBeVisible();
  await expect(page.locator('[data-deck-side="player"]')).not.toBeVisible();
  await page.getByRole('button',{name:'クラウド学生',exact:true}).click();
  await expect(page.locator('[data-deck-side="player"]')).toBeVisible();
  await expect(page.locator('[data-deck-side="player"]')).toContainText('5枚・2種類');
  await expect(page.locator('[data-deck-side="opponent"]')).toContainText('微笑み講師');
  await expect(page.getByRole('link', { name: 'ログを保存', exact: true })).toHaveAttribute('href', '/admin/logs/archive/cloud-match.json');
  await page.screenshot({ path: test.info().outputPath('cloud-log-detail.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-deck-side="player"]')).not.toBeVisible();
  const saved = await page.request.get(`${base}/admin/logs/archive/cloud-match.json`);
  expect(saved.headers()['content-disposition']).toContain('attachment;');
  expect((await saved.json()).gameId).toBe('cloud-match');
  await page.getByRole('link', { name: 'ログ一覧へ戻る', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('クラウド保存ログ');
});

test('クラウド一覧と中身は管理者認証が必要で、存在しないログは404になる', async ({ page }) => {
  for (const suffix of ['', '/archive', '/archive/cloud-match', '/archive/cloud-match.json', '/deck-cards.css']) {
    const response = await fetch(`${base}/admin/logs${suffix}`);
    expect(response.status).toBe(401);
    await response.text();
  }
  expect((await page.request.get(`${base}/admin/logs/archive/missing`)).status()).toBe(404);
});


test('古い記録にデッキ内容がなければ推測せず未記録と表示する',async({page})=>{
  await page.request.post(`${base}/admin/logs/import`,{data:{gameId:'no-deck',events:[]}});
  await page.goto(`${base}/admin/logs/no-deck`);
  await page.locator('[data-open-deck="deck-player"]').click();
  await expect(page.locator('#deck-player').getByText('デッキ内容の記録がありません。',{exact:true})).toBeVisible();
});

test('スマホでも両者の内訳を確認でき、ログ内の名前をHTMLとして実行しない',async({page})=>{
  await page.request.post(`${base}/admin/logs/import`,{data:{gameId:'safe-deck',events:[
    {eventType:'game_start',game:{decks:{player:{deckName:'<script>bad</script>',deckList:{old_card:2,general_student:3,unknown_id:1,ruler:-1,invalid:'3'}},opponent:{deckList:{general_teacher:1}}}}},
    {eventType:'game_end',final:{cardStats:[{side:'player',cardId:'old_card',cardName:'<img src=x onerror=alert(1)>'}]}}
  ]}});
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/admin/logs/safe-deck`);
  const own=page.locator('[data-deck-side="player"]');
  await page.locator('[data-open-deck="deck-player"]').click();
  await expect(own).toBeVisible();
  await expect(own).toContainText('6枚・3種類');
  await expect(own).toContainText('<script>bad</script>');
  await expect(own).toContainText('<img src=x onerror=alert(1)>');
  await expect(own).toContainText('unknown_id');
  await expect(own.locator('img,script')).toHaveCount(0);
  const bounds=await own.boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(390);
  await expect(own.locator('.deck-window-card')).toHaveCount(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('deck-detail-mobile.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.locator('[data-open-deck="deck-opponent"]').click();
  await expect(page.locator('#deck-opponent').getByRole('img',{name:'一般教師 1枚'})).toBeVisible();
});


test('通常版と同じカード面・配色を使い、多いデッキも画面内でスクロールして確認できる', async ({ page, context }) => {
  const catalog = require('../server/card-catalog.json');
  const counts = Object.fromEntries(catalog.direct.slice(0, 35).map(id => [id, 3]));
  counts.general_student = 3;
  await page.request.post(`${base}/admin/logs/import`, { data: { gameId: 'large-deck', events: [
    { eventType:'game_start', game:{decks:{player:{deckName:'多数カード',deckList:counts}}} }
  ] } });
  const game = await context.newPage();
  await game.goto(require('node:url').pathToFileURL(path.join(__dirname, '../index.html')).href);
  const display = await game.evaluate(() => Object.fromEntries(Object.entries(CARD_BASES).map(([id,c]) => [id, {type:c.type,cost:c.cost,noCost:!!c.noCost,attack:c.attack,hp:c.hp,defense:c.defense}])));
  expect(JSON.parse(JSON.stringify(display))).toEqual(catalog.display);
  const normalOrder = await game.evaluate(() => getDeckEditorIds(''));
  expect(catalog.deckOrder).toEqual(normalOrder);
  await game.evaluate(() => { state.players.player.originalDeckCounts = {general_student:3}; openDeckWindow(); });
  const gameCard = game.locator('#deckWindowGrid .card');
  const normalMarkup = await gameCard.locator('.card-face').innerHTML();
  const styles = card => card.locator('.card-face').evaluate(face => {
    const style=getComputedStyle(face); return [style.backgroundColor,style.borderColor,style.borderRadius];
  });
  const normalStyles = await styles(gameCard);
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/admin/logs/large-deck`);
  await page.getByRole('button',{name:'多数カード',exact:true}).click();
  const dialog=page.locator('#deck-player');
  const actualOrder = await dialog.locator('[data-card-id]').evaluateAll(cards=>cards.map(card=>card.dataset.cardId));
  expect(actualOrder).toEqual(normalOrder.filter(id=>counts[id]>0));
  const card=dialog.locator('[data-card-id="general_student"]');
  await expect(card).toBeVisible();
  expect(await card.locator('.card-face').innerHTML()).toBe(normalMarkup);
  await expect.poll(()=>styles(card)).toEqual(normalStyles);
  const grid=dialog.locator('.deck-window-grid');
  expect(await grid.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  const box=await dialog.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y+box.height).toBeLessThanOrEqual(844);
  await page.screenshot({path:test.info().outputPath('large-deck-mobile.png')});
  await page.mouse.click(1,1);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button',{name:'多数カード',exact:true})).toBeFocused();
  await game.close();
});

test('目次からターン・講義室チェックへ移動でき、手札と効果を読みやすく表示する',async({page})=>{
  const log=require('./fixtures/readable-log.cjs')();
  await page.request.post(`${base}/admin/logs/import`,{data:log});
  const before=await (await page.request.get(`${base}/admin/logs/readable-match.json`)).json();
  await page.goto(`${base}/admin/logs/readable-match`);
  await expect(page.getByRole('navigation',{name:'ログの目次'})).toBeVisible();
  const turn=page.locator('#log-turn-2');
  await page.getByRole('link',{name:'後攻1ターン目',exact:true}).click();
  await expect(page).toHaveURL(/#log-turn-2$/);
  await expect(turn.getByText('一般学生',{exact:true})).toBeVisible();
  await expect(turn.getByText('定規',{exact:true})).toBeVisible();
  await expect(turn).toContainText('太郎：ドロー「定規」');
  await expect(turn).not.toContainText('気力へのダメージ');
  const check=page.locator('#log-turn-2-check');
  await page.getByRole('link',{name:'講義室チェック（後攻1ターン目の後）',exact:true}).click();
  await expect(check).toContainText('気力へのダメージ → 花子の気力／2ダメージ');
  await check.getByText('最終記録時点の状態',{exact:true}).click();
  await expect(check).toContainText('1行1列：一般学生');
  await page.screenshot({path:test.info().outputPath('readable-log-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#log-turn-2').scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('readable-log-mobile.png')});
  const after=await (await page.request.get(`${base}/admin/logs/readable-match.json`)).json();
  expect(after).toEqual(before);
  await page.getByText('元データ（イベント一覧）',{exact:true}).click();
  await expect(page.locator('#log-raw').getByRole('columnheader',{name:'種類',exact:true})).toBeVisible();
});

test('気力・戦意の横に各プレイヤーの講義室を描き、点のホバーとフォーカスで出席者を表示する',async({page})=>{
  const seats=()=>Array(9).fill(null);
  const left=seats(),right=seats();
  left[0]={cardName:'一般学生',instanceId:'left-student'};
  left[4]={cardName:'バカでかい班員たち',instanceId:'large'};
  left[5]=left[7]=left[8]=left[4];
  right[2]={cardName:'<img src=x onerror=alert(1)>',instanceId:'right-student'};
  const boardSnapshot={player:{teacher:{cardName:'一般教師'},seats:left},opponent:{teacher:null,seats:right}};
  const log={gameId:'mini-classroom',summary:{playerNames:{player:'太郎',opponent:'花子'}},events:[{eventType:'turn_start',side:'player',turn:'先攻1ターン目',life:20,will:1,maxWill:1,boardSnapshot}]};
  await page.request.post(`${base}/admin/logs/import`,{data:log});
  await page.goto(`${base}/admin/logs/mini-classroom`);
  const turn=page.locator('#log-turn-1');
  const own=turn.getByRole('figure',{name:'太郎の講義室',exact:true});
  const enemy=turn.getByRole('figure',{name:'花子の講義室',exact:true});
  await expect(own.locator('.log-mini-seats > *')).toHaveCount(9);
  await expect(enemy.locator('.log-mini-seats > *')).toHaveCount(9);
  await expect(own.locator('.log-mini-teacher .log-mini-dot')).toHaveCount(1);
  await expect(enemy.locator('.log-mini-teacher .log-mini-dot')).toHaveCount(0);
  await expect(own.locator('.log-mini-seats .log-mini-dot')).toHaveCount(5);
  const student=own.getByRole('button',{name:'1行1列：一般学生',exact:true});
  const teacher=own.getByRole('button',{name:'教卓マス：一般教師',exact:true});
  const expectCentered = async () => {
    for (const classroom of [own,enemy]) {
      const desk=await classroom.locator('.log-mini-teacher .log-mini-slot').boundingBox();
      const middle=await classroom.locator('.log-mini-seats > *').nth(1).boundingBox();
      expect(Math.abs(desk.x-middle.x)).toBeLessThan(0.5);
      expect(Math.abs(desk.width-middle.width)).toBeLessThan(0.5);
    }
  };
  await expectCentered();
  await student.hover();
  await expect(student.getByRole('tooltip')).toBeVisible();
  await expect(student.getByRole('tooltip')).toHaveText('1行1列：一般学生');
  const ownColor=await student.locator('.log-mini-dot').evaluate(el=>getComputedStyle(el).backgroundColor);
  const enemyDot=enemy.locator('.log-mini-dot');
  expect(await enemyDot.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(ownColor);
  await teacher.focus();
  await expect(teacher.getByRole('tooltip')).toBeVisible();
  await expect(turn.locator('img,script')).toHaveCount(0);
  const copy=await own.locator('..').locator('.log-metric-copy').boundingBox(), board=await own.boundingBox();
  expect(board.x).toBeGreaterThan(copy.x+copy.width);
  await turn.scrollIntoViewIfNeeded();
  await page.screenshot({path:test.info().outputPath('mini-classroom-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await expectCentered();
  await student.focus();
  await expect(student.getByRole('tooltip')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('mini-classroom-mobile.png')});
  const saved=await (await page.request.get(`${base}/admin/logs/mini-classroom.json`)).json();
  expect(saved.events[0].boardSnapshot).toEqual(boardSnapshot);
});
