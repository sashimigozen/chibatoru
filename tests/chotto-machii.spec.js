const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const text = '自分本体に19ダメージを与える。その後、この対戦中、相手のターンをすべて飛ばす。';

test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest('chotto_machii'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.phase = 'battle'; state.screen = 'battle'; state.currentSide = 'player'; state.actionTurn = 8;
    state.environment = null; state.kashikashiActionTurn = null;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], createPlayerState(), {
      life: 20, will: 10, maxWill: 10, turnsTaken: 4,
      deck: Array.from({ length: 8 }, () => createCardFromBase('general_student', side))
    });
    state.players.player.hand = [createCardFromBase('chotto_machii', 'player')];
    render();
  });
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
});

async function useCard(page, side = 'player') {
  await page.evaluate(side => {
    const card = state.players[side].hand.find(c => c.baseId === 'chotto_machii');
    castImmediateItem(side, card, true);
  }, side);
  await expect.poll(() => page.evaluate(side => state.players[side].trash.some(c => c.baseId === 'chotto_machii'), side)).toBe(true);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}

test('能力値・本文・専攻・オンライン登録が一致する', async ({ page }) => {
  const result = await page.evaluate(() => {
    const c = createCardFromBase('chotto_machii', 'player');
    return { name: c.name, cost: c.cost, type: c.type, category: c.category, text: cardRulesText(c),
      immediate: isImmediateItemBaseId(c.baseId), direct: DIRECT_DECK_CARD_IDS.has(c.baseId),
      common: SPECIALTY_CARD_IDS.common.includes(c.baseId),
      update: UPDATE_HISTORY[0].changes.find(c => c.title === 'ちょっと待ちぃ').after };
  });
  expect(result).toMatchObject({ name: 'ちょっと待ちぃ', cost: 10, type: 'item', category: 'common', text,
    immediate: true, direct: true, common: true });
  expect(result.update).toContain(text);
  expect(fs.readFileSync(path.join(__dirname, '../card_rules.txt'), 'utf8')).toContain(`chotto_machii: "${text}"`);
  const catalog = require('../server/card-catalog.json');
  expect(catalog.direct).toContain('chotto_machii'); expect(catalog.specialties.common).toContain('chotto_machii');
});

test('気力20なら1になり、戦意10を払い相手のターンを永久に飛ばす', async ({ page }) => {
  await useCard(page);
  expect(await page.evaluate(() => ({ life: state.players.player.life, will: state.players.player.will,
    skipped: state.players.opponent.skipAllTurns, ownSkipped: state.players.player.skipAllTurns, gameOver: state.gameOver })))
    .toEqual({ life: 1, will: 0, skipped: true, ownSkipped: false, gameOver: false });
  for (let n = 1; n <= 2; n++) {
    await page.evaluate(async () => { await finishEndTurn('player'); });
    expect(await page.evaluate(() => ({ side: state.currentSide, action: state.actionTurn,
      ownTurns: state.players.player.turnsTaken, enemyTurns: state.players.opponent.turnsTaken,
      ownDeck: state.players.player.deck.length, enemyDeck: state.players.opponent.deck.length,
      ownWill: state.players.player.will, enemyHand: state.players.opponent.hand.length })))
      .toEqual({ side: 'player', action: 8 + n, ownTurns: 4 + n, enemyTurns: 4,
        ownDeck: 8 - n, enemyDeck: 8, ownWill: 10, enemyHand: 0 });
    await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  }
});

test('効果がない通常の対戦では相手へ交代し通常のターン開始を行う', async ({ page }) => {
  await page.evaluate(async () => { await finishEndTurn('player'); });
  expect(await page.evaluate(() => [state.currentSide, state.players.player.turnsTaken,
    state.players.opponent.turnsTaken, state.players.opponent.deck.length, state.players.opponent.hand.length]))
    .toEqual(['opponent', 4, 5, 7, 1]);
});

test('飛ばされた相手の戦意回復・開始/終了時効果・遅刻処理は行わない', async ({ page }) => {
  await page.evaluate(() => {
    const enemy = state.players.opponent; enemy.life = 10; enemy.will = 2; enemy.maxWill = 5;
    enemy.board.teacher = makeBoardCard(createCardFromBase('kakiage_teacher', 'opponent'));
    enemy.hand = [createCardFromBase('general_student', 'opponent')];
    addHandLoad(enemy.hand[0]);
    enemy.late = [{ card: createCardFromBase('general_student', 'opponent'), remaining: 2 }];
  });
  await useCard(page);
  await page.evaluate(async () => { await finishEndTurn('player'); });
  expect(await page.evaluate(() => {
    const enemy = state.players.opponent;
    return { life: enemy.life, will: enemy.will, maxWill: enemy.maxWill, turns: enemy.turnsTaken,
      deck: enemy.deck.length, hand: enemy.hand.length, late: enemy.late.map(entry => entry.remaining),
      seats: enemy.board.seats.filter(Boolean).length, skipped: enemy.skipAllTurns };
  })).toEqual({ life: 10, will: 2, maxWill: 5, turns: 4, deck: 8, hand: 1, late: [2], seats: 0, skipped: true });
});

for (const life of [19, 1]) test(`気力${life}でも使用できるが敗北し後半は発動しない`, async ({ page }) => {
  await page.evaluate(life => { state.players.player.life = life; }, life);
  await useCard(page);
  expect(await page.evaluate(() => ({ life: state.players.player.life, over: state.gameOver,
    winner: state.gameWinner, skipped: state.players.opponent.skipAllTurns, will: state.players.player.will })))
    .toEqual({ life: 0, over: true, winner: 'opponent', skipped: false, will: 0 });
});

test('ダメージ無効なら自傷を防いでも後半は発動する', async ({ page }) => {
  await page.evaluate(() => {
    Object.assign(state.players.player, { life: 1, lifeShieldUntilTurn: state.actionTurn, lifeShieldUntilSide: 'player' });
  });
  await useCard(page);
  expect(await page.evaluate(() => [state.players.player.life, state.players.opponent.skipAllTurns])).toEqual([1, true]);
});

test('戦意不足では使えず、使用時効果の禁止中は自傷もターン消去も行わない', async ({ page }) => {
  expect(await page.evaluate(() => {
    state.players.player.will = 9;
    return castImmediateItem('player', state.players.player.hand[0], true);
  })).toBe(false);
  await page.evaluate(() => { state.players.player.will = 10; state.players.player.effectUseLockTurnsRemaining = 1; });
  await useCard(page);
  expect(await page.evaluate(() => [state.players.player.life, state.players.opponent.skipAllTurns, state.players.player.will])).toEqual([20, false, 0]);
});

test('カシカシや使用済みカードの移動で既に確定したターン消去は解除されない', async ({ page }) => {
  await useCard(page);
  await page.evaluate(() => {
    state.players.player.trash = [];
    state.kashikashiActionTurn = state.actionTurn;
  });
  expect(await page.evaluate(() => playerActiveEffectLines('opponent').join(''))).toContain('ちょっと待ちぃ');
  await page.evaluate(async () => { await finishEndTurn('player'); });
  expect(await page.evaluate(() => [state.currentSide, state.players.opponent.skipAllTurns])).toEqual(['player', true]);
});

test('相手カードの自分ターン開始時効果は通常どおり発動する', async ({ page }) => {
  await page.evaluate(() => { state.players.opponent.board.teacher = makeBoardCard(createCardFromBase('ninety_three_teacher', 'opponent')); });
  await useCard(page);
  await page.evaluate(async () => { await finishEndTurn('player'); });
  expect(await page.evaluate(() => [state.players.player.life, state.gameOver, state.gameWinner])).toEqual([0, true, 'opponent']);
});

test('AIは自滅や重複使用を避け、使用できる場合は共通処理で発動する', async ({ page }) => {
  expect(await page.evaluate(() => {
    state.currentSide = 'opponent'; const ai = state.players.opponent;
    const item = createCardFromBase('chotto_machii', 'opponent'); ai.hand = [item];
    ai.life = 19; const lethal = [scoreAiItem(item), scoreTrainingYocchanItem('opponent', item)];
    ai.life = 20; const safe = [scoreAiItem(item), scoreTrainingYocchanItem('opponent', item)];
    state.players.player.skipAllTurns = true; const duplicate = scoreAiItem(item);
    state.players.player.skipAllTurns = false;
    return { lethal, safe, duplicate, used: useAiItem(item) };
  })).toEqual({ lethal: [0, -Infinity], safe: [80, 80], duplicate: 0, used: true });
  await expect.poll(() => page.evaluate(() => state.players.player.skipAllTurns)).toBe(true);
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
  await page.evaluate(async () => { await finishEndTurn('opponent'); });
  expect(await page.evaluate(() => [state.currentSide, state.players.opponent.life, state.players.player.turnsTaken])).toEqual(['opponent', 1, 4]);
});

test('オンラインのゲスト・観戦へ効果が同期され、次の対戦には持ち越さない', async ({ page }) => {
  await useCard(page);
  const result = await page.evaluate(() => {
    const snapshot = onlineCreateSnapshot();
    const guest = onlineTransformSnapshotForGuest(snapshot.state);
    const spectator = onlineTransformSnapshotForSpectator(snapshot.state);
    const values = { host: snapshot.state.players.opponent.skipAllTurns, guest: guest.players.player.skipAllTurns,
      guestOwn: guest.players.opponent.skipAllTurns, spectator: spectator.players.opponent.skipAllTurns };
    startCardTest('chotto_machii');
    return { ...values, reset: [state.players.player.skipAllTurns, state.players.opponent.skipAllTurns] };
  });
  expect(result).toEqual({ host: true, guest: true, guestOwn: false, spectator: true, reset: [false, false] });
});

test('ゲストの使用とターン終了コマンドでも相手を飛ばし、自分の手番が再開する', async ({ page: host, browser }) => {
  const guest = await browser.newPage();
  try {
    await guest.goto(url);
    await guest.evaluate(() => { startCardTest('chotto_machii'); state.training.skipAnimations = true; scheduleOpponentAI = () => {}; });
    for (const [page, role] of [[host, 'host'], [guest, 'guest']]) {
      await page.evaluate(role => {
        Object.assign(state.online, { role, started: true, connected: true, conn: {} });
        window.outbox = [];
        onlineSend = message => { outbox.push(JSON.parse(JSON.stringify(message))); return true; };
      }, role);
    }
    await expect.poll(() => host.evaluate(() => battlePresentationBusy())).toBe(false);
    const snapshot = await host.evaluate(() => {
      state.currentSide = 'opponent'; state.players.player.hand = [];
      state.players.opponent.hand = [createCardFromBase('chotto_machii', 'opponent')];
      return onlineCreateSnapshot();
    });
    await guest.evaluate(snapshot => onlineHandleMessage({ type: 'gameState', protocol: ONLINE_PROTOCOL_VERSION, snapshot }), snapshot);
    async function relayCommand() {
      const messages = await guest.evaluate(() => outbox.splice(0));
      for (const message of messages) if (message.command) await host.evaluate(message =>
        onlineHandleMessage({ ...message, type: 'command', protocol: ONLINE_PROTOCOL_VERSION }), message);
    }
    await guest.evaluate(() => onlineSendCommand('itemImmediate', { instanceId: state.players.player.hand[0].instanceId }));
    await relayCommand();
    await expect.poll(() => host.evaluate(() => state.players.player.skipAllTurns)).toBe(true);
    await expect.poll(() => host.evaluate(() => battlePresentationBusy())).toBe(false);
    const used = await host.evaluate(() => onlineCreateSnapshot());
    await guest.evaluate(snapshot => onlineHandleMessage({ type: 'gameState', protocol: ONLINE_PROTOCOL_VERSION, snapshot }), used);
    await guest.evaluate(() => onlineSendCommand('endTurn'));
    await relayCommand();
    await expect.poll(() => host.evaluate(() => state.players.opponent.turnsTaken)).toBe(5);
    const next = await host.evaluate(() => onlineCreateSnapshot());
    await guest.evaluate(snapshot => onlineHandleMessage({ type: 'gameState', protocol: ONLINE_PROTOCOL_VERSION, snapshot }), next);
    expect(await guest.evaluate(() => [state.currentSide, state.players.player.life, state.players.player.turnsTaken,
      state.players.opponent.turnsTaken, state.players.opponent.skipAllTurns])).toEqual(['player', 1, 5, 4, true]);
  } finally { await guest.close(); }
});
