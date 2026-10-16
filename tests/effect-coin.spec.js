const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

async function setup(page, face) {
  await page.clock.install();
  await page.goto(url);
  await page.evaluate(face => {
    startCardTest('general_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = false; state.actionTurn = 4;
    state.players.player.board.seats = Array(9).fill(null);
    state.players.opponent.board.seats = Array(9).fill(null);
    state.players.player.board.teacher = state.players.opponent.board.teacher = null;
    window.rolls = 0; rollCoinFace = () => { window.rolls++; return face; };
    render();
  }, face);
  await page.clock.runFor(2000);
  await expect.poll(() => page.evaluate(() => battleNewActionBlocked())).toBe(false);
}

for (const face of ['heads', 'tails']) {
  test(`形容詞学生 ${face}：演出後だけ強化する`, async ({ page }) => {
    await setup(page, face);
    await page.evaluate(() => {
      window.attendee = makeBoardCard(createCardFromBase('adjective_student', 'player'));
      state.players.player.board.seats[0] = attendee;
      resolveAttendEffects('player', attendee, 'seat', 0, { forceLocalAttendEffects: true }); render();
    });
    await expect(page.locator('.effect-coin-overlay')).toBeVisible();
    expect(await page.evaluate(() => attendee.attack)).toBe(2);
    expect(await page.evaluate(() => battleNewActionBlocked())).toBe(true);
    await page.screenshot({ path: test.info().outputPath('effect-coin.png') });
    await page.clock.runFor(1400);
    await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
    expect(await page.evaluate(() => attendee.attack)).toBe(face === 'heads' ? 5 : 2);
    expect(await page.evaluate(() => rolls)).toBe(1);
    await expect(page.locator('.effect-coin-overlay')).toHaveCount(0);
  });

  test(`眠気 ${face}：裏だけ失敗、通常攻撃にはコインなし`, async ({ page }) => {
    await setup(page, face);
    await page.evaluate(() => {
      window.attendee = makeBoardCard(createCardFromBase('general_student', 'player'));
      attendee.keywords = ['眠気']; state.players.player.board.seats[0] = attendee;
      window.miss = null; Promise.resolve(attackMissesFromDrowsiness(attendee)).then(value => window.miss = value);
    });
    await expect(page.locator('.effect-coin-overlay')).toBeVisible();
    await page.clock.runFor(1400);
    await expect.poll(() => page.evaluate(() => miss)).not.toBeNull();
    expect(await page.evaluate(() => miss)).toBe(face === 'tails');
    expect(await page.evaluate(() => rolls)).toBe(1);
    expect(await page.evaluate(() => { attendee.keywords = []; return attackMissesFromDrowsiness(attendee); })).toBe(false);
    expect(await page.evaluate(() => rolls)).toBe(1);
  });

  test(`眠気の実際の攻撃 ${face}：判定後にダメージ・行動済みを処理する`, async ({ page }) => {
    await setup(page, face);
    await page.evaluate(() => {
      window.attendee = makeBoardCard(createCardFromBase('general_student', 'player'));
      attendee.keywords = ['眠気']; attendee.playedOnTurn = 0;
      state.players.player.board.seats[0] = attendee;
      const target = makeBoardCard(createCardFromBase('general_student', 'opponent'));
      applyPermanentStatBuff(target, 0, 8);
      state.players.opponent.board.seats[0] = target;
      state.selectedAttacker = { owner: 'player', zone: 'seat', index: 0 }; render();
      window.attackDone = false; attackCard('opponent', 'seat', 0).then(() => window.attackDone = true);
    });
    await page.clock.runFor(2000);
    await page.clock.runFor(2000);
    await expect.poll(() => page.evaluate(() => attackDone)).toBe(true);
    expect(await page.evaluate(() => state.players.opponent.board.seats[0].currentHp)).toBe(face === 'heads' ? 8 : 10);
    expect(await page.evaluate(() => rolls)).toBe(1);
  });
}

test('連続破壊：破壊→表→破壊→裏で終了する', async ({ page }) => {
  await setup(page, 'heads');
  await page.evaluate(() => {
    rollCoinFace = () => ++rolls === 1 ? 'heads' : 'tails';
    for (let i = 0; i < 3; i++) state.players.opponent.board.seats[i] = makeBoardCard(createCardFromBase('general_student', 'opponent'));
    const card = makeBoardCard(createCardFromBase('adjective_vs_cynical', 'player'));
    state.players.player.board.seats[0] = card;
    resolveAttendEffects('player', card, 'seat', 0, { forceLocalAttendEffects: true }); render();
  });
  await expect(page.locator('.effect-coin-overlay')).toBeVisible();
  expect(await page.evaluate(() => listBoardRefs('opponent').length)).toBe(2);
  await page.clock.runFor(1400);
  await expect.poll(() => page.evaluate(() => listBoardRefs('opponent').length)).toBe(1);
  await page.clock.runFor(1400);
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => [listBoardRefs('opponent').length, rolls, fusionTasksBusy()])).toEqual([1, 2, false]);
});

test('表示本文は表で強化・繰り返し、裏で眠気失敗に統一する', async ({ page }) => {
  await setup(page, 'heads');
  const texts = await page.evaluate(() => [
    cardRulesText(createCardFromBase('adjective_student', 'player')),
    cardRulesText(createCardFromBase('adjective_vs_cynical', 'player')),
    BATTLE_CARD_TERM_DESCRIPTIONS['眠気']
  ]);
  expect(texts[0]).toContain('コインを1回投げ、表ならこのカードの攻撃力を+3する。');
  expect(texts[1]).toContain('コインを1回投げ、表ならこの効果を繰り返す。');
  expect(texts[2]).toContain('コインを1回投げ、裏なら攻撃に失敗する。');
});

test('演出スキップでも判定は1回だけ行う', async ({ page }) => {
  await setup(page, 'heads');
  const result = await page.evaluate(async () => {
    state.training.active = true; state.training.skipAnimations = true;
    return [await tossEffectCoin('テスト'), rolls, queuedBattlePresentations];
  });
  expect(result).toEqual(['heads', 1, 0]);
  await expect(page.locator('.effect-coin-overlay')).toHaveCount(0);
});

test('試合を離れたら古いコインから強化処理を再開しない', async ({ page }) => {
  await setup(page, 'heads');
  await page.evaluate(() => {
    window.attendee = makeBoardCard(createCardFromBase('adjective_student', 'player'));
    state.players.player.board.seats[0] = attendee;
    resolveAttendEffects('player', attendee, 'seat', 0, { forceLocalAttendEffects: true });
  });
  await expect(page.locator('.effect-coin-overlay')).toBeVisible();
  await page.evaluate(() => { state.preBattleToken++; state.screen = 'home'; });
  await page.clock.runFor(1400);
  expect(await page.evaluate(() => attendee.attack)).toBe(2);
  await expect(page.locator('.effect-coin-overlay')).toHaveCount(0);
});

test('回転や結果表示が終わるまで強化数値を見せず、バフ演出と同時に更新する', async ({ page }) => {
  await setup(page, 'heads');
  await page.evaluate(() => {
    window.attendee = makeBoardCard(createCardFromBase('adjective_student', 'player'));
    state.players.player.board.seats[0] = attendee;
    resolveAttendEffects('player', attendee, 'seat', 0, { forceLocalAttendEffects: true }); render();
  });
  await expect(page.locator('.effect-coin-overlay')).toBeVisible();
  await page.evaluate(() => document.querySelector('.effect-coin-overlay').getAnimations({ subtree: true }).forEach(a => a.pause()));
  await page.clock.runFor(5000);
  expect(await page.evaluate(() => attendee.attack)).toBe(2);
  await expect(page.locator('.effect-coin-overlay')).toHaveAttribute('data-stage', 'tossing');
  await page.evaluate(() => document.querySelector('.effect-coin-overlay').getAnimations({ subtree: true }).forEach(a => a.finish()));
  await expect(page.locator('.effect-coin-overlay')).toHaveAttribute('data-stage', 'result');
  await page.evaluate(() => document.querySelector('.effect-coin-overlay').getAnimations({ subtree: true }).forEach(a => a.pause()));
  expect(await page.evaluate(() => attendee.attack)).toBe(2);
  await page.screenshot({ path: test.info().outputPath('coin-result-before-buff.png') });
  await page.evaluate(() => document.querySelector('.effect-coin-overlay').getAnimations({ subtree: true }).forEach(a => a.finish()));
  await expect.poll(() => page.evaluate(() => attendee.attack)).toBe(5);
  const card = page.locator('.field-card[data-base-id="adjective_student"]');
  await expect(card.locator('.field-stat.attack')).toHaveText('5');
  await expect(card.locator('.board-change-effect.buff')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('buff-with-new-value.png') });
});
