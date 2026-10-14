const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(url);
  await page.evaluate(() => {
    startCardTest('corridor_student'); scheduleOpponentAI = () => {}; state.environment = null; state.training.skipAnimations = true;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [], late: [], will: 10, life: 20
    });
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

for (const side of ['player', 'opponent']) test(`${side}: 情報はデッキだけ・手札だけの素材をコピーし、元と負荷は引き継がない`, async ({ page }) => {
  const results = await page.evaluate(side => {
    return ['deck', 'hand'].map(zone => {
      const p = state.players[side]; p.hand = []; p.deck = [];
      const material = Object.assign(createCardFromBase('fusion_bone', side), { handLoadLevel: 2 });
      p[zone] = [material];
      resolveHorseAttendance(side, createCardFromBase('information_tired_student', side));
      const copy = p.hand.at(-1);
      return [p[zone].some(card => card.instanceId === material.instanceId), copy.baseId,
        copy.instanceId !== material.instanceId, copy.handLoadLevel || 0, p.hand.length];
    });
  }, side);
  expect(results).toEqual([[true, 'fusion_bone', true, 0, 1], [true, 'fusion_bone', true, 0, 2]]);
});

test('通路はデッキと手札の異名をクリックで選べ、同名の重複は1候補にする', async ({ page }) => {
  const originals = await page.evaluate(() => {
    state.players.player.deck = ['fusion_uma', 'fusion_uma'].map(id => createCardFromBase(id, 'player'));
    state.players.player.hand = ['fusion_uma', 'fusion_bone'].map(id => createCardFromBase(id, 'player'));
    const originals = [state.players.player.deck.map(card => card.instanceId), state.players.player.hand.map(card => card.instanceId)];
    resolveHorseAttendance('player', createCardFromBase('corridor_student', 'player')); return originals;
  });
  const choices = page.locator('#threeGesturesHand button.card');
  await expect(choices).toHaveCount(2);
  await choices.nth(0).click(); await choices.nth(1).click();
  await page.screenshot({ path: test.info().outputPath('deck-and-hand-materials.png') });
  await page.locator('#threeGesturesConfirmButton').click();
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => [state.players.player.deck.map(card => card.instanceId), state.players.player.hand.slice(0, 2).map(card => card.instanceId)])).toEqual(originals);
  expect(await page.evaluate(() => state.players.player.hand.slice(2).map(card => card.baseId))).toEqual(['fusion_uma', 'fusion_bone']);
});

test('CPUの通路も手札だけの素材を生成できる', async ({ page }) => {
  expect(await page.evaluate(async () => {
    isCpuControlledBattleSide = () => true;
    state.players.opponent.hand = ['fusion_uma', 'fusion_bone'].map(id => createCardFromBase(id, 'opponent'));
    resolveHorseAttendance('opponent', createCardFromBase('corridor_student', 'opponent')); await fusionEffectTail;
    return state.players.opponent.hand.map(card => card.baseId).sort();
  })).toEqual(['fusion_bone', 'fusion_bone', 'fusion_uma', 'fusion_uma']);
});

test('オンラインのゲスト選択へ両方の素材だけを送り、手札とデッキを消費せず生成する', async ({ page }) => {
  await page.evaluate(() => {
    Object.assign(state.online, { role: 'host', started: true, connected: true, conn: {} });
    onlineSend = message => { if (message.privateChoiceKind === 'fusion_effect_choice') window.request = message; return true; };
    state.players.opponent.deck = [createCardFromBase('fusion_uma', 'opponent')];
    state.players.opponent.hand = ['fusion_bone', 'general_student'].map(id => createCardFromBase(id, 'opponent'));
    resolveHorseAttendance('opponent', createCardFromBase('corridor_student', 'opponent'));
  });
  await expect.poll(() => page.evaluate(() => window.request?.cards.map(card => card.baseId))).toEqual(['fusion_uma', 'fusion_bone']);
  await page.evaluate(() => onlineHandleMessage({ type: 'thinItemChoiceResponse', protocol: ONLINE_PROTOCOL_VERSION,
    privateChoiceKind: 'fusion_effect_choice', requestId: request.requestId, selectedIds: request.cards.map(card => card.instanceId) }));
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => [state.players.opponent.deck.length, state.players.opponent.hand.map(card => card.baseId)]))
    .toEqual([1, ['fusion_bone', 'general_student', 'fusion_uma', 'fusion_bone']]);
});
