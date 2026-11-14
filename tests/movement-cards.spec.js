const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

const game = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

async function idle(page) {
  await expect.poll(() => page.evaluate(() => battlePresentationBusy({ ignoreFusionTasks: true }))).toBe(false);
}

async function start(page, id) {
  await page.goto(game);
  await page.evaluate(id => {
    state.training.skipAnimations = true;
    startCardTest(id);
    scheduleOpponentAI = () => {};
  }, id);
  await idle(page);
}

function slot(page, owner, index) {
  return page.locator(`.slot[data-owner="${owner}"][data-zone="seat"][data-index="${index}"]`);
}

async function play(page, id, zone, index = null) {
  await page.evaluate(({ id, zone, index }) => {
    const card = state.players.player.hand.find(card => card.baseId === id);
    playCard(card.instanceId, zone, 'player', index);
  }, { id, zone, index });
  await idle(page);
}

async function item(page, id) {
  await page.evaluate(id => beginItemUse(state.players.player.hand.find(card => card.baseId === id)), id);
  await idle(page);
}

async function choose(page, target, kind) {
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe(kind);
  await idle(page);
  await target.click();
  await page.locator('#itemTargetConfirmButton').click();
}

test('足軽は出席ターンから使え、行動権を使う。ミニテストスターのコピーに能力は付かない', async ({ page }) => {
  await start(page, 'mini_test_star');
  await play(page, 'mini_test_star', 'seat', 4);
  await slot(page, 'player', 4).locator('.board-card').click();
  await page.locator('#ashigaruMoveButton').click();
  await choose(page, slot(page, 'player', 5), 'movement_destination');
  await idle(page);

  expect(await page.evaluate(() => {
    const board = state.players.player.board.seats;
    return { original: [board[5].attack, board[5].currentHp, canAttack(board[5])],
      clone: [board[0].baseId, board[0].attack, board[0].currentHp, canUsePrintedCardEffects(board[0]), hasKeyword(board[0], '足軽')],
      canMoveAgain: canUseAshigaru('player', movementEntries('player').find(entry => entry.card === board[5])) };
  })).toEqual({ original: [2, 2, false], clone: ['mini_test_star', 1, 1, false, false], canMoveAgain: false });
});

test('フィジカルスカイは行動権を保ち、夢の国バイト学生は左右の効果を保持する', async ({ page }) => {
  await start(page, 'dream_park_student');
  await play(page, 'dream_park_student', 'seat', 4);
  await play(page, 'physical_sky', 'environment');
  await page.locator('#physicalSkyMoveButton').click();
  await choose(page, slot(page, 'player', 4).locator('.board-card'), 'movement_source');
  await choose(page, slot(page, 'player', 5), 'movement_destination');
  await idle(page);
  expect(await page.evaluate(() => canAttack(state.players.player.board.seats[5]))).toBe(true);
  await expect(page.locator('#physicalSkyMoveButton')).toBeDisabled();
  await slot(page, 'player', 5).locator('.board-card').click();
  await page.locator('#ashigaruMoveButton').click();
  await choose(page, slot(page, 'player', 3), 'movement_destination');
  await idle(page);

  expect(await page.evaluate(() => {
    const card = state.players.player.board.seats[3];
    return ['超注目', '超陽気'].map(keyword => hasKeyword(card, keyword)).concat(canAttack(card));
  })).toEqual([true, true, false]);
});

test('あきくん係は移動元と3行目の空き席を盤面で選び、移動時効果を処理する', async ({ page }) => {
  await start(page, 'aki_helper');
  await play(page, 'aki_helper', 'seat', 1);
  await choose(page, slot(page, 'player', 4).locator('.board-card'), 'movement_source');
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.cards.map(card => card.choiceIndex))).toEqual([6, 8]);
  await choose(page, slot(page, 'player', 8), 'movement_destination');
  await expect.poll(() => page.evaluate(() => fusionTasksBusy())).toBe(false);
  expect(await page.evaluate(() => state.players.player.board.seats.map(card => card?.baseId || null)))
    .toEqual(['mini_test_star', 'aki_helper', null, null, null, null, null, 'general_student', 'mini_test_star']);
});

test('パ学生パは攻撃力0で相手を動かし、怠惰で倒せば反撃を受けない', async ({ page }) => {
  await start(page, 'pa_student_pa');
  await item(page, 'bakadekai_laziness');
  await play(page, 'pa_student_pa', 'seat', 7);
  await slot(page, 'player', 7).locator('.board-card').click();
  await slot(page, 'opponent', 4).locator('.board-card').click();
  await choose(page, slot(page, 'opponent', 5), 'movement_destination');
  await expect.poll(() => page.evaluate(() => state.attackInProgress)).toBe(false);

  expect(await page.evaluate(() => [state.players.player.board.seats[7]?.currentHp,
    state.players.opponent.board.seats[4], state.players.opponent.board.seats[5],
    state.players.player.lazinessNextDamage])).toEqual([1, null, null, 2]);
});

test('一斉移動は両陣営で元の席順を維持し、怠惰は再使用してもダメージをリセットしない', async ({ page }) => {
  await start(page, 'bakadekai_laziness');
  await item(page, 'bakadekai_laziness');
  const result = await page.evaluate(() => {
    const side = 'opponent';
    const entries = movementEntries(side);
    const before = new Map(entries.map(({ card }) => [card, card.currentHp]));
    const move = entry => moveAttendee(entry, { owner: side, zone: 'seat', index: 1 },
      CARD_BASES.physical_sky, { side });
    const first = move(entries[0]);
    const next = state.players.player.lazinessNextDamage;
    const copy = state.players.player.hand.find(card => card.baseId === 'bakadekai_laziness');
    castImmediateItem('player', copy, true);
    const persisted = state.players.player.lazinessNextDamage;
    const moves = planRandomClassroomMoves(side);
    commitAttendeeMoves(moves, CARD_BASES.are_moshikashite, { side: 'player' });
    return { first, next, persisted, moved: moves.length,
      loss: entries.map(({ card }) => before.get(card) - card.currentHp),
      cycle: state.players.player.lazinessNextDamage };
  });
  expect(result).toEqual({ first: true, next: 2, persisted: 2, moved: 3, loss: [3, 3, 1], cycle: 2 });
});

test('数独女王は移動した行の効果だけ処理する', async ({ page }) => {
  await start(page, 'sudoku_queen');
  await play(page, 'sudoku_queen', 'seat', 8);
  const values = await page.evaluate(() => {
    const side = 'player';
    const move = (from, to) => moveAttendee(movementEntryAt({ owner: side, zone: 'seat', index: from }),
      { owner: side, zone: 'seat', index: to }, CARD_BASES.physical_sky, { side });
    move(8, 1);
    const enemy = state.players.opponent.board.seats;
    const frontDamage = [enemy[0].currentHp, enemy[2].currentHp, enemy[4].currentHp];
    move(1, 4);
    const rowBuff = state.players.player.board.seats.slice(3, 6).map(card => [card.attack, card.currentHp]);
    move(4, 7);
    move(7, 6);
    return { frontDamage, rowBuff, life: state.players.player.life };
  });
  expect(values).toEqual({ frontDamage: [1, 1, 2], rowBuff: [[3, 3], [2, 2], [3, 3]], life: 13 });
});

test('あれもしかしては満席から交換でき、複数マス出席者を分裂させない', async ({ page }) => {
  await start(page, 'are_moshikashite');
  const originalIds = await page.evaluate(() => {
    const owner = 'opponent';
    state.players[owner].board.seats.fill(null);
    placeMultiSeatCard(owner, 0, makeBoardCard(createCardFromBase('loud_members', owner)));
    for (const index of [2, 5, 6, 7, 8]) {
      state.players[owner].board.seats[index] = makeBoardCard(createCardFromBase('general_student', owner));
    }
    applyBoardAuras();
    return movementEntries(owner).map(({card}) => card.instanceId).sort();
  });
  await item(page, 'are_moshikashite');
  const result = await page.evaluate(() => {
    const owner = 'opponent';
    const entries = movementEntries(owner);
    const large = entries.find(({ card }) => isMultiSeatCard(card));
    return { ids: entries.map(({card}) => card.instanceId).sort(),
      count: state.players[owner].board.seats.filter(card => card === large?.card).length,
      changed: large?.ref.index !== 0 };
  });
  expect(result).toEqual({ ids: originalIds, count: 4, changed: true });
});

test('カードテストの8枚は、効果を試せる手札と対戦用デッキを持つ', async ({ page }) => {
  await page.goto(game);
  const ids = ['physical_sky', 'mini_test_star', 'bakadekai_laziness', 'dream_park_student',
    'sudoku_queen', 'aki_helper', 'pa_student_pa', 'are_moshikashite'];
  const results = await page.evaluate(ids => ids.map(id => {
    startCardTest(id);
    const player = state.players.player;
    const card = player.hand.find(card => card.baseId === id);
    return { id, valid: DIRECT_DECK_CARD_IDS.has(id) && getDeckEditorIds('').includes(id),
      ready: canUseHandCardNow(card), ownDeck: player.deck.length, opponentDeck: state.players.opponent.deck.length };
  }), ids);
  expect(results).toEqual(ids.map(id => ({ id, valid: true, ready: true, ownDeck: 45, opponentDeck: 45 })));
});

test('CPUは出席したターンに足軽で移動して効果を使える', async ({ page }) => {
  await start(page, 'mini_test_star');
  const result = await page.evaluate(async () => {
    const side = 'opponent';
    state.currentSide = side;
    const card = makeBoardCard(createCardFromBase('mini_test_star', side));
    state.players[side].board.seats[1] = card;
    await useAiVoluntaryMovement(side);
    const entries = movementEntries(side);
    return { attack: card.attack, hp: card.currentHp, actionUsed: cardAttacksUsedThisTurn(card),
      copies: entries.filter(entry => entry.card.generatedWithoutEffects).length };
  });
  expect(result).toEqual({ attack: 2, hp: 2, actionUsed: 1, copies: 1 });
});

test('オンラインのゲストが足軽・パ学生パ・あきくん係の盤面選択を完了できる', async ({ browser }) => {
  test.setTimeout(90000);
  const port = await new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const contexts = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('対戦サーバー起動待ち')), 5000);
      server.stdout.on('data', chunk => {
        if (String(chunk).includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.once('error', reject);
    });
    const url = new URL(game);
    url.searchParams.set('ws', `ws://127.0.0.1:${port}`);
    const errors = [];
    for (const side of ['host', 'guest']) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url.href);
      await page.locator('#homeNavBattleButton').click();
      await page.locator('#onlinePrivateMatchButton').click();
    }
    const [host, guest] = contexts.map(context => context.pages()[0]);
    await host.locator('#onlineCreateRoomButton').click();
    await expect.poll(() => host.evaluate(() => state.online.role)).toBe('host');
    await guest.locator('.private-code-entry > summary').click();
    await guest.locator('#onlineRoomInput').fill(await host.evaluate(() => state.online.roomCode));
    await guest.locator('#onlineJoinRoomButton').click();
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => state.online.connected)).toBe(true);
      await page.evaluate(() => {
        const counts = createAutoDeckCounts();
        const replaced = Object.keys(counts).find(id => counts[id] > 0);
        counts[replaced] -= 1;
        counts.mini_test_star = 1;
        state.deckBuilder.counts.player = counts;
        document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.locator('#onlineReadyButton').click();
    }
    await expect.poll(() => host.evaluate(() => state.online.remoteReady)).toBe(true);
    await host.locator('#onlineStartButton').click();
    await expect.poll(() => guest.evaluate(() => state.online.started)).toBe(true);
    const seq = await host.evaluate(() => {
      startCardTest('pa_student_pa');
      state.testMode = false;
      state.training.skipAnimations = true;
      state.currentSide = 'opponent';
      state.players.opponent.board.seats.fill(null);
      state.players.player.board.seats.fill(null);
      state.players.opponent.board.seats[4] = makeBoardCard(createCardFromBase('mini_test_star', 'opponent'));
      state.players.opponent.board.seats[7] = makeBoardCard(createCardFromBase('pa_student_pa', 'opponent'));
      state.players.player.board.seats[4] = makeBoardCard(createCardFromBase('aggro_student', 'player'));
      state.players.opponent.lazinessNextDamage = 1;
      state.players.opponent.hand.push(createCardFromBase('aki_helper', 'opponent'));
      render();
      return state.online.lastSnapshotSeq;
    });
    await expect.poll(() => guest.evaluate(() => state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);
    await idle(guest);
    await slot(guest, 'player', 4).locator('.board-card').click();
    await guest.locator('#ashigaruMoveButton').click();
    await choose(guest, slot(guest, 'player', 5), 'movement_destination');
    await expect.poll(() => guest.evaluate(() => state.players.player.board.seats[5]?.attack)).toBe(2);
    expect(await host.evaluate(() => state.players.opponent.board.seats[5]?.attack)).toBe(2);
    await expect.poll(() => guest.evaluate(() => battleNewActionBlocked())).toBe(false);
    await slot(guest, 'player', 7).locator('.board-card').click();
    await slot(guest, 'opponent', 4).locator('.board-card').click();
    await choose(guest, slot(guest, 'opponent', 5), 'movement_destination');
    await expect.poll(() => guest.evaluate(() => state.players.opponent.board.seats[4])).toBe(null);
    expect(await host.evaluate(() => state.players.opponent.lazinessNextDamage)).toBe(2);
    await expect.poll(() => guest.evaluate(() => battleNewActionBlocked())).toBe(false);
    await guest.locator('#playerHand [data-base-id="aki_helper"]').click();
    await slot(guest, 'player', 2).click();
    await choose(guest, slot(guest, 'player', 5).locator('.board-card'), 'movement_source');
    await choose(guest, slot(guest, 'player', 8), 'movement_destination');
    await expect.poll(() => guest.evaluate(() => state.players.player.board.seats[8]?.attack)).toBe(2);
    expect(await host.evaluate(() => state.players.opponent.board.seats[8]?.attack)).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    server.kill('SIGTERM');
  }
});
