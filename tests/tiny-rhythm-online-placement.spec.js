const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test('ゲストがコピー元を選び、3人を実際に配置して操作ロックが解除される', async ({ page: host, browser }) => {
  const guest = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await host.goto(url); await guest.goto(url);
  for (const [page, role] of [[host, 'host'], [guest, 'guest']]) await page.evaluate(role => {
    startCardTest('tiny_rhythm_student'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.environment = null;
    for (const side of ['player', 'opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [], late: [], life: 20, will: 10
    });
    Object.assign(state.online, { role, started: true, connected: true, conn: {} });
    window.outbox = []; onlineSend = message => { outbox.push(JSON.parse(JSON.stringify(message))); return true; };
  }, role);
  await expect.poll(() => host.evaluate(() => battlePresentationBusy())).toBe(false);
  const initial = await host.evaluate(() => {
    state.currentSide = 'opponent';
    state.players.opponent.hand = ['tiny_rhythm_student', 'umaibo', 'umaibo', 'maibo_bone'].map(id => createCardFromBase(id, 'opponent'));
    return onlineCreateSnapshot();
  });
  await guest.evaluate(snapshot => onlineHandleMessage({ type: 'gameState', protocol: ONLINE_PROTOCOL_VERSION, snapshot }), initial);
  async function relay(from, to) {
    const messages = await from.evaluate(() => outbox.splice(0));
    for (const message of messages) await to.evaluate(message => onlineHandleMessage({ ...message,
      type: message.command ? 'command' : message.type, protocol: ONLINE_PROTOCOL_VERSION }), message);
  }
  await guest.evaluate(() => onlineSendCommand('playCard', { instanceId: state.players.player.hand[0].instanceId,
    zone: 'seat', owner: 'player', index: 0 }));
  await relay(guest, host);
  await expect.poll(() => host.evaluate(() => outbox.some(message => message.privateChoiceKind === 'fusion_effect_choice'))).toBe(true);
  await relay(host, guest);
  const choices = guest.locator('#threeGesturesHand button.card');
  await expect(choices).toHaveCount(3);
  await expect.poll(() => guest.evaluate(() => battlePresentationBusy({ ignoreFusionTasks: true }))).toBe(false);
  for (let i = 0; i < 3; i++) await choices.nth(i).click();
  await expect.poll(() => guest.evaluate(() => state.pendingCardChoice?.selectedIds.length)).toBe(3);
  await guest.locator('#threeGesturesConfirmButton').click();
  await relay(guest, host);
  await expect.poll(() => host.evaluate(() => Boolean(state.pendingCopiedCard))).toBe(true);
  await relay(host, guest);
  for (let index = 1; index <= 3; index++) {
    await expect.poll(() => guest.evaluate(() => Boolean(state.pendingCopiedCard))).toBe(true);
    await expect.poll(() => guest.evaluate(() => battlePresentationBusy({ ignoreFusionTasks: true }))).toBe(false);
    expect(await guest.evaluate(index => ({ allowed: battleActionInputAllowed(document.querySelector(`.slot[data-owner="player"][data-zone="seat"][data-index="${index}"]`)),
      legal: isPendingCopiedCardPlacementLegal('player', 'seat', 'player', index), peek: hasPeekableSelectionOverlay(),
      pending: state.pendingCopiedCard, side: state.currentSide, choice: state.pendingCardChoice, ai: state.aiThinking }), index)).toMatchObject({ allowed: true, legal: true, peek: false, side: 'player' });
    await guest.locator(`.slot[data-owner="player"][data-zone="seat"][data-index="${index}"]`).click();
    expect(await guest.evaluate(() => outbox.some(message => message.command?.type === 'placeCopy'))).toBe(true);
    await relay(guest, host);
    await expect.poll(() => host.evaluate(() => state.players.opponent.board.seats.filter(Boolean).length)).toBe(index + 1);
    await relay(host, guest);
  }
  await expect.poll(() => host.evaluate(() => fusionTasksBusy())).toBe(false);
  await relay(host, guest);
  await expect.poll(() => guest.evaluate(() => [state.remoteResolutionPending, Boolean(state.pendingCopiedCard), battleActionInputAllowed(elements.endTurnButton)]))
    .toEqual([false, false, true]);
  expect(await guest.evaluate(() => [state.players.player.hand.length, state.players.player.board.seats.filter(Boolean).length,
    state.online.pendingTurnCommandId, state.players.player.will])).toEqual([3, 4, '', 3]);
  await guest.close();
});
