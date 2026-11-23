const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let server, gameUrl;
test.beforeAll(async () => {
  const port = await new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
  gameUrl = pathToFileURL(path.join(__dirname, '..', 'index.html'));
  gameUrl.searchParams.set('ws', `ws://127.0.0.1:${port}`);
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 5000);
    server.stdout.on('data', chunk => {
      if (String(chunk).includes('listening')) { clearTimeout(timer); resolve(); }
    });
    server.once('error', reject);
  });
});
test.afterAll(() => server?.kill('SIGTERM'));

async function pair(browser) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
  for (const page of [host, guest]) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(gameUrl.href);
    await page.locator('#homeNavBattleButton').click();
    await page.locator('#onlinePrivateMatchButton').click();
  }
  await host.locator('#onlineCreateRoomButton').click();
  await expect.poll(() => host.evaluate(() => state.online.role)).toBe('host');
  await guest.locator('.private-code-entry > summary').click();
  await guest.locator('#onlineRoomInput').fill(await host.evaluate(() => state.online.roomCode));
  await guest.locator('#onlineJoinRoomButton').click();
  for (const page of [host, guest]) {
    await expect.poll(() => page.evaluate(() => state.online.connected)).toBe(true);
    await page.evaluate(() => {
      state.deckBuilder.counts.player = createAutoDeckCounts();
      document.getElementById('onlineDeckSelect').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#onlineReadyButton').click();
  }
  await expect.poll(() => host.evaluate(() => state.online.remoteReady)).toBe(true);
  await host.locator('#onlineStartButton').click();
  await expect.poll(() => guest.evaluate(() => state.online.started)).toBe(true);
  return { contexts, host, guest, errors };
}

async function idle(page) {
  await expect.poll(() => page.evaluate(() => !battlePresentationBusy() && !fusionTasksBusy()), { timeout: 15000 }).toBe(true);
}
async function choose(page, kind, baseId, zone) {
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.context?.kind), { timeout: 15000 }).toBe(kind);
  await page.evaluate(({ baseId, zone }) => {
    const card = state.pendingCardChoice.cards.find(card => (!baseId || card.baseId === baseId)
      && (!zone || card.choiceZone === zone));
    if (!card) throw new Error(`選択肢なし: ${baseId} ${zone}`);
    toggleCardChoiceCard(card.instanceId); confirmCardChoiceSelection();
  }, { baseId, zone });
}

for (const side of ['player', 'opponent']) {
  test(`トジリカとハバヨセ!の選択・公開・装備を実WebSocketで同期 ${side}`, async ({ browser }) => {
    test.setTimeout(120000);
    const { contexts, host, guest, errors } = await pair(browser);
    try {
      const actor = side === 'player' ? host : guest;
      const other = actor === host ? guest : host;
      const seq = await host.evaluate(side => {
        startCardTest('tojirika'); state.testMode = false; state.training.skipAnimations = true;
        state.currentSide = side; state.environment = null; state.actionTurn = 8;
        for (const owner of ['player', 'opponent']) Object.assign(state.players[owner], {
          board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [], late: [],
          will: 10, maxWill: 10, life: 20, pointScore: 0, pointSystemActive: false, submissionCounters: {}
        });
        state.players[side].hand = ['tojirika', 'cafeteria_lady', 'general_student', 'habayose', 'dark_yuta']
          .map(id => createCardFromBase(id, side));
        state.players[side].deck = ['yuta_umbrella', 'yuta', 'sexual_eye', 'red_happi', 'habayose'].map(id => createCardFromBase(id, side));
        state.players[oppositeSide(side)].board.seats[4] = makeBoardCard(createCardFromBase('strong_student', oppositeSide(side)));
        render(); return state.online.lastSnapshotSeq;
      }, side);
      await expect.poll(() => guest.evaluate(() => state.online.lastSnapshotSeq)).toBeGreaterThanOrEqual(seq);
      for (const page of [host, guest]) await idle(page);

      await actor.evaluate(() => beginItemUse(state.players.player.hand.find(card => card.baseId === 'tojirika')));
      await expect.poll(() => actor.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('tojirika_reveal');
      expect(await other.evaluate(() => state.pendingCardChoice)).toBeNull();
      expect(await actor.evaluate(() => state.pendingCardChoice.cards.map(card => card.baseId))).toEqual(['cafeteria_lady']);
      await choose(actor, 'tojirika_reveal', 'cafeteria_lady');
      await choose(actor, 'point_destroy', 'strong_student');
      for (const page of [host, guest]) await idle(page);
      for (const page of [host, guest]) {
        const own = page === host ? side : side === 'player' ? 'opponent' : 'player';
        await expect.poll(() => page.evaluate(own => [state.players[own].will, state.players[own].pointScore,
          listBoardRefs(oppositeSide(own)).length, state.players[own].hand.length], own)).toEqual([8, 1, 0, 5]);
      }
      expect(await actor.evaluate(() => state.players.player.hand.filter(card => card.baseId === 'cafeteria_lady').length)).toBe(1);
      expect(await guest.locator('#opponentHand').innerText()).not.toContain('一般学生');

      await actor.evaluate(() => beginItemUse(state.players.player.hand.find(card => card.baseId === 'habayose')));
      await expect.poll(() => actor.evaluate(() => state.pendingCardChoice?.context?.kind)).toBe('habayose_search');
      expect(await other.evaluate(() => state.pendingCardChoice)).toBeNull();
      expect(await actor.evaluate(() => state.pendingCardChoice.cards.map(card => card.baseId).sort())).toEqual(['yuta', 'yuta_umbrella']);
      await choose(actor, 'habayose_search', 'yuta_umbrella');
      await choose(actor, 'attendance_optional', 'dark_yuta');
      await choose(actor, 'attendance_seats', null, 'teacher');
      await choose(actor, 'habayose_equip', 'habayose');
      for (const page of [host, guest]) await idle(page);
      for (const page of [host, guest]) {
        const own = page === host ? side : side === 'player' ? 'opponent' : 'player';
        await expect.poll(() => page.evaluate(own => {
          const teacher = state.players[own].board.teacher;
          return [state.players[own].will, teacher?.baseId, teacher?.attack, teacher?.maxHp,
            equipmentEntriesForCard(teacher).map(card => card.baseId), state.players[own].trash.filter(card => card.baseId === 'habayose').length];
        }, own)).toEqual([3, 'dark_yuta', 5, 5, ['habayose'], 0]);
      }
      expect(errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map(context => context.close()));
    }
  });
}
