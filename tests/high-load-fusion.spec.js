const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.environment = null;
    state.currentSide = 'player'; state.gameOver = false;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [], late: [],
      will: 20, maxWill: 20, life: 20
    });
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

for (const side of ['player', 'opponent']) test(`${side}の高負荷素材で全3系統を融合、完成品は負荷なし`, async ({ page }) => {
  const results = await page.evaluate(side => {
    state.currentSide = side;
    const setHand = ids => state.players[side].hand = ids.map(id => Object.assign(createCardFromBase(id, side), { handLoadLevel: 2 }));
    const results = [];
    setHand(HORSE_MATERIAL_IDS);
    results.push(fuseHorseMaterials(side, state.players[side].hand.map(card => card.instanceId), false));
    results.push([state.players[side].hand[0].baseId, state.players[side].hand[0].handLoadLevel || 0]);
    setHand(['ruler', 'ruler']); results.push(fuseRulersForSide(side, false));
    results.push([state.players[side].hand[0].baseId, state.players[side].hand[0].handLoadLevel || 0]);
    setHand(['yuta', ...UTA_FUSION_MATERIAL_IDS]);
    const uta = state.players[side].hand[0];
    for (const id of UTA_FUSION_MATERIAL_IDS) {
      results.push(castUtaFusion(side, state.players[side].hand.find(card => card.baseId === id), getHandCard(side, uta.instanceId), false));
      if (id === UTA_FUSION_MATERIAL_IDS[0]) results.push(isHighLoadHandCard(getHandCard(side, uta.instanceId)));
    }
    results.push([state.players[side].hand[0].baseId, state.players[side].hand[0].handLoadLevel || 0]);
    results.push([state.players[side].trash.length, state.players[side].will]);
    return results;
  }, side);
  expect(results).toEqual([true, ['where_uma_bone_maibo', 0], true, ['double_diamond', 0], true, true, true, true, true, ['ultimate_yuta', 0], [0, 20]]);
});

test('戦意不足でも高負荷素材を融合でき、通常使用は既存の戦意制限を維持', async ({ page }) => {
  expect(await page.evaluate(() => {
    const results = [];
    state.players.player.will = 0;
    for (const ids of [['fusion_uma', 'fusion_bone'], ['ruler', 'ruler'], ['tsurai_nara', 'yuta']]) {
      const [source, target] = ids.map(id => Object.assign(createCardFromBase(id, 'player'), { handLoadLevel: 2 }));
      state.players.player.hand = [source, target];
      results.push([canStartHandDrag(source), handFusionType('player', source, target),
        canDropHandCardOnLife(source, 'opponent'), canDropHandCardOnSlot(source, 'seat', 'player', 0),
        performHandFusionDrop(source.instanceId, target.instanceId)]);
    }
    const attendee = Object.assign(createCardFromBase('umaibo', 'player'), { handLoadLevel: 2 });
    state.players.player.hand = [attendee];
    results.push([canUseHandCardNow(attendee), fusionCopyAttendanceCandidates('player').length]);
    state.players.player.will = 20;
    results.push([canUseHandCardNow(attendee), effectiveCardCost(attendee), fusionCopyAttendanceCandidates('player').length]);
    return results;
  })).toEqual([[true, 'horse', false, false, true], [true, 'ruler', false, false, true], [true, 'uta', false, false, true], [false, 0], [true, 6, 0]]);
});

test('高負荷素材が選択画面に表示され、クリックで融合できる', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.hand = ['fusion_uma', 'fusion_bone'].map(id => Object.assign(createCardFromBase(id, 'player'), { handLoadLevel: 2 }));
    render(); openHorseFusionChoice(state.players.player.hand[0]);
  });
  await expect(page.locator('#threeGesturesHand button.card')).toHaveCount(1);
  await page.locator('#threeGesturesHand button.card').click();
  await page.screenshot({ path: test.info().outputPath('high-load-fusion-choice.png') });
  await page.locator('#threeGesturesConfirmButton').click();
  expect(await page.evaluate(() => state.players.player.hand.map(card => card.baseId))).toEqual(['uma_bone']);
});

test('AIも高負荷のウマ素材とU太素材を融合できる', async ({ page }) => {
  expect(await page.evaluate(async () => {
    state.currentSide = 'opponent';
    state.players.opponent.hand = HORSE_MATERIAL_IDS.map(id => Object.assign(createCardFromBase(id, 'opponent'), { handLoadLevel: 2 }));
    const horse = tryFuseHorseForAi('opponent');
    const horseId = state.players.opponent.hand[0].baseId;
    state.players.opponent.hand = ['yuta', ...UTA_FUSION_MATERIAL_IDS].map(id => Object.assign(createCardFromBase(id, 'opponent'), { handLoadLevel: 2 }));
    isOpponentAiActive = () => true;
    await tryUseAiItems();
    return [horse, horseId, state.players.opponent.hand.map(card => [card.baseId, card.handLoadLevel || 0])];
  })).toEqual([true, 'where_uma_bone_maibo', [['ultimate_yuta', 0]]]);
});

test('実際のマウスドラッグで高負荷の定規2枚を融合できる', async ({ page }) => {
  await page.evaluate(() => {
    state.players.player.will = 0;
    state.players.player.hand = ['ruler', 'ruler'].map(id => Object.assign(createCardFromBase(id, 'player'), { handLoadLevel: 2 }));
    render();
  });
  const cards = page.locator('.player-hand .hand-card');
  const source = await cards.nth(0).boundingBox();
  const target = await cards.nth(1).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => state.players.player.hand.map(card => card.baseId))).toEqual(['double_diamond']);
});

test('オンラインのゲストからホストへの融合命令も全3系統で処理できる', async ({ page }) => {
  const results = await page.evaluate(async () => {
    state.online.role = 'host'; state.online.started = true; state.online.connected = true;
    state.online.conn = {}; onlineSend = () => true;
    state.currentSide = 'opponent';
    const results = [];
    for (const [type, ids] of [['horseFusion', ['fusion_uma', 'fusion_bone']], ['fuse', ['ruler', 'ruler']], ['utaFusion', ['tsurai_nara', 'yuta']]]) {
      const [source, target] = state.players.opponent.hand = ids.map(id => Object.assign(createCardFromBase(id, 'opponent'), { handLoadLevel: 2 }));
      if (type === 'utaFusion') target.utaFusionMaterials = UTA_FUSION_MATERIAL_IDS.slice(1).map(baseId => ({ baseId }));
      const payload = type === 'horseFusion' ? { ids: [source.instanceId, target.instanceId] }
        : type === 'fuse' ? { sourceInstanceId: source.instanceId, targetInstanceId: target.instanceId }
        : { instanceId: source.instanceId, targetInstanceId: target.instanceId };
      await onlineApplyRemoteCommand({ id: `loaded-${type}`, type, payload });
      const result = state.players.opponent.hand[0];
      const guest = onlineTransformSnapshotForGuest(onlineCreateSnapshot().state);
      results.push([result.baseId, result.handLoadLevel || 0, guest.players.player.hand[0].baseId, guest.players.player.hand[0].handLoadLevel || 0]);
    }
    return results;
  });
  expect(results).toEqual(['uma_bone', 'double_diamond', 'ultimate_yuta'].map(id => [id, 0, id, 0]));
});
