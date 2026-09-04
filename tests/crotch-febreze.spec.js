const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page) {
  await page.goto(gameUrl);
  return page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("crotch_febreze");
    api.hidePlayReveal();
    const { state } = api;
    state.online.role = "host";
    state.online.started = true;
    state.online.connected = false;
    const item = state.players.player.hand.find((card) => card.baseId === "crotch_febreze");
    const own = state.players.player.board.seats[0];
    own.currentHp = 4;
    own.maxHp = 4;
    own.baseMaxHp = 4;
    const enemy = state.players.opponent.board.teacher;
    api.beginItemUse(item);
    return { own: own.instanceId, enemy: enemy.instanceId, own2: state.players.player.board.seats[8].instanceId, will: state.players.player.will };
  });
}
const boardCard = (page, id) => page.locator(`.board-card[data-card-id="${id}"]`);

test("講義室を直接クリックし、両段階ともターン終了が指名するに変わる", async ({ page }) => {
  const ids = await setup(page);
  const confirm = page.locator("#endTurnButton");
  await expect(confirm).toHaveText("指名する");
  await expect(confirm).toBeDisabled();
  await expect(page.locator("#itemTargetConfirmButton")).toBeHidden();
  await boardCard(page, ids.enemy).click(); // wrong side during own selection
  await expect(confirm).toBeDisabled();
  await boardCard(page, ids.own).click();
  await expect(confirm).toBeEnabled();
  await boardCard(page, ids.own).click(); // toggle off
  await expect(confirm).toBeDisabled();
  await boardCard(page, ids.own).click();
  await confirm.click();
  await expect(confirm).toHaveText("指名する");
  await expect(confirm).toBeEnabled(); // up to N: zero is legal
  await boardCard(page, ids.enemy).click();
  await confirm.click();
  const before = await page.evaluate(() => {
    const { state } = window.__chibattle;
    return {
      hp: state.players.player.board.seats[0].currentHp,
      will: state.players.player.will,
      ownHand: state.players.player.hand.map((card) => card.instanceId),
      enemyHand: state.players.opponent.hand.map((card) => card.instanceId),
      choice: state.pendingCardChoice?.cards.map((card) => card.instanceId),
      mode: state.pendingCardChoice?.mode,
      sourceOwner: state.players.opponent.board.teacher.owner,
      trash: state.players.player.trash.map((card) => card.baseId)
    };
  });
  expect(before.hp).toBe(1);
  expect(before.will).toBe(ids.will - 2);
  expect(before.mode).toBe("logic_hunter");
  expect(before.choice).toEqual(before.enemyHand);
  expect(before.sourceOwner).toBe("opponent");
  expect(before.trash).toContain("crotch_febreze");
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.pendingCardChoice.selectedIds = [api.state.pendingCardChoice.cards[1].instanceId];
    api.confirmCardChoiceSelection();
  });
  const after = await page.evaluate(() => {
    const { state } = window.__chibattle;
    return { ownHand: state.players.player.hand.map((card) => card.instanceId), enemyHand: state.players.opponent.hand.map((card) => card.instanceId), trash: state.players.opponent.trash.map((card) => card.instanceId) };
  });
  expect(after.ownHand).toEqual(before.ownHand);
  expect(after.enemyHand).toEqual(before.enemyHand.filter((id) => id !== before.enemyHand[1]));
  expect(after.trash).toContain(before.enemyHand[1]);
  await expect(confirm).toHaveText("ターン終了");
});

test("教師0人でも確定でき、選べる教師はあえーの人数まで", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.handleBoardCardClick("player", "seat", 0);
    api.confirmSelectedItemTargets();
    api.handleBoardCardClick("opponent", "teacher", null);
    api.handleBoardCardClick("opponent", "seat", 1);
    const count = api.state.pendingMultiItem.targets.length;
    api.handleBoardCardClick("opponent", "teacher", null);
    api.confirmSelectedItemTargets();
    return { count, pending: api.state.pendingMultiItem, hp: api.state.players.player.board.seats[0].currentHp, choice: api.state.pendingCardChoice };
  });
  expect(result).toEqual({ count: 1, pending: null, hp: 1, choice: null });
});

test("複数教師の手札選択は選んだ順に行い、席にいる教師の効果も使える", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.players.opponent.board.seats[1] = api.makeBoardCard(api.createCardFromBase("logic_hunter", "opponent"));
    api.handleBoardCardClick("player", "seat", 0);
    api.handleBoardCardClick("player", "seat", 8);
    api.confirmSelectedItemTargets();
    api.handleBoardCardClick("opponent", "seat", 1);
    api.handleBoardCardClick("opponent", "teacher", null);
    api.confirmSelectedItemTargets();
    const expectedOrder = [state.players.opponent.board.seats[1].instanceId, state.players.opponent.board.teacher.instanceId];
    const actualOrder = [];
    const before = state.players.opponent.hand.length;
    const choices = [];
    for (let i = 0; i < 2; i++) {
      choices.push(state.pendingCardChoice?.cards.length);
      actualOrder.push(state.pendingCardChoice.context.sourceCard.instanceId);
      state.pendingCardChoice.selectedIds = [state.pendingCardChoice.cards[0].instanceId];
      api.confirmCardChoiceSelection();
    }
    return { choices, expectedOrder, actualOrder, before, after: state.players.opponent.hand.length, queue: state.pendingCrotchFebrezeEffects, pending: state.pendingCardChoice };
  });
  expect(result.choices).toEqual([result.before, result.before - 1]);
  expect(result.actualOrder).toEqual(result.expectedOrder);
  expect(result.after).toBe(result.before - 2);
  expect(result.queue).toBeNull();
  expect(result.pending).toBeNull();
});

test("教師の右上に選択順を表示し、解除・再選択で番号を振り直す", async ({ page }) => {
  const ids = await setup(page);
  const seatTeacher = await page.evaluate(() => {
    const api = window.__chibattle;
    api.handleBoardCardClick("player", "seat", 0);
    api.handleBoardCardClick("player", "seat", 8);
    api.confirmSelectedItemTargets();
    return api.state.players.opponent.board.seats[7].instanceId;
  });
  const first = boardCard(page, seatTeacher);
  const second = boardCard(page, ids.enemy);
  await first.click();
  await second.click();
  await expect(first.locator(".board-effect-order-badge")).toHaveText("1");
  await expect(second.locator(".board-effect-order-badge")).toHaveText("2");
  const bounds = await first.evaluate((card) => {
    const badge = card.querySelector(".board-effect-order-badge");
    const parentBox = card.getBoundingClientRect();
    const badgeBox = badge.getBoundingClientRect();
    return { top: badgeBox.top - parentBox.top, right: parentBox.right - badgeBox.right, size: badgeBox.width };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeLessThan(10);
  expect(bounds.right).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThan(10);
  expect(bounds.size).toBeGreaterThan(15);
  await first.click();
  await expect(first.locator(".board-effect-order-badge")).toHaveCount(0);
  await expect(second.locator(".board-effect-order-badge")).toHaveText("1");
  await first.click();
  await expect(first.locator(".board-effect-order-badge")).toHaveText("2");
  await page.locator("#endTurnButton").click();
  await expect(page.locator(".board-effect-order-badge")).toHaveCount(0);
});

test("コピーした教師が盤面指名を要求しても、効果元を保持して相手へ使う", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const teacher = api.makeBoardCard(api.createCardFromBase("kansai_voice_t", "opponent"));
    state.players.opponent.board.teacher = teacher;
    const item = state.players.player.hand.find((card) => card.baseId === "crotch_febreze");
    api.resolveCrotchFebreze("player", item, [state.players.player.board.seats[0].instanceId], [teacher.instanceId]);
    const owner = state.pendingAttendTarget?.owner;
    const resolved = api.resolveAttendTargetChoice("player", { owner: "opponent", zone: "seat", index: 1 });
    return { owner, resolved, locked: state.players.opponent.board.seats[1].attackLockedPermanently, teacherOwner: teacher.owner };
  });
  expect(result).toEqual({ owner: "player", resolved: true, locked: true, teacherOwner: "opponent" });
});

test("ゲスト使用時はホストの手札をゲストに提示し、応答でホストの1枚だけを送る", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const sent = [];
    state.online.connected = true;
    state.online.conn = { open: true, send: (message) => sent.push(message) };
    state.online.activeRemoteCommandId = "febreze-guest";
    state.currentSide = "opponent";
    state.pendingMultiItem = null;
    const ae = api.makeBoardCard(api.createCardFromBase("ae_student", "opponent"));
    state.players.opponent.board.seats[0] = ae;
    const teacher = api.makeBoardCard(api.createCardFromBase("logic_hunter", "player"));
    state.players.player.board.teacher = teacher;
    const item = api.createCardFromBase("crotch_febreze", "opponent");
    state.players.opponent.hand.push(item);
    state.players.opponent.will = 2;
    const ownHand = state.players.player.hand.map((card) => card.instanceId);
    api.resolveCrotchFebreze("opponent", item, [ae.instanceId], [teacher.instanceId]);
    const request = sent.find((message) => message.type === "logicHunterChoiceRequest");
    const pending = { ...state.pendingRemoteHandTrim };
    const guestHand = state.players.opponent.hand.map((card) => card.instanceId);
    api.onlineResolveLogicHunterChoiceResponse(request.requestId, ownHand[0]);
    return {
      requested: request.cards.map((card) => card.instanceId), ownHand, pending,
      ownAfter: state.players.player.hand.map((card) => card.instanceId),
      guestHand, guestAfter: state.players.opponent.hand.map((card) => card.instanceId),
      hp: ae.currentHp, teacherOwner: teacher.owner,
      trash: state.players.player.trash.map((card) => card.instanceId)
    };
  });
  expect(result.requested).toEqual(result.ownHand);
  expect(result.pending).toMatchObject({ sourceSide: "opponent", targetSide: "player", commandId: "febreze-guest" });
  expect(result.ownAfter).toEqual(result.ownHand.slice(1));
  expect(result.guestAfter).toEqual(result.guestHand);
  expect(result.trash).toContain(result.ownHand[0]);
  expect(result.hp).toBe(1);
  expect(result.teacherOwner).toBe("player");
});

for (const sourceSide of ["player", "opponent"]) {
  test(`オンライン2画面：${sourceSide === "player" ? "ホスト" : "ゲスト"}の盤面指名から手札選択・同期まで`, async ({ page: host, context }) => {
    const guest = await context.newPage();
    await setup(host);
    await setup(guest);
    await host.evaluate((side) => {
      const api = window.__chibattle;
      const { state } = api;
      state.pendingMultiItem = null;
      state.selectedHandId = null;
      state.currentSide = side;
      state.players[side].will = 10;
      const other = side === "player" ? "opponent" : "player";
      state.players[side].board.seats[0] = api.makeBoardCard(api.createCardFromBase("ae_student", side));
      state.players[side].board.seats[8] = api.makeBoardCard(api.createCardFromBase("super_ae_student", side));
      state.players[side].hand = [api.createCardFromBase("crotch_febreze", side)];
      state.players[other].board.teacher = api.makeBoardCard(api.createCardFromBase("logic_hunter", other));
      state.players[other].board.seats[7] = api.makeBoardCard(api.createCardFromBase("ninety_three_teacher", other));
      state.players[other].life = 20;
      state.players[other].hand = ["water_2l", "general_student"].map((id) => api.createCardFromBase(id, other));
    }, sourceSide);
    for (const [page, role] of [[host, "host"], [guest, "guest"]]) {
      await page.evaluate((role) => {
        const { state } = window.__chibattle;
        window.testOutbox = [];
        state.online.role = role;
        state.online.clientId = role;
        state.online.remoteClientId = role === "host" ? "guest" : "host";
        state.online.roomSessionId = "febreze-test";
        state.online.connected = true;
        state.online.started = true;
        state.online.conn = { open: true, send: (message) => window.testOutbox.push(JSON.parse(JSON.stringify(message))) };
      }, role);
    }
    // Relay the real message envelopes between isolated browser pages, without
    // creating a public room or contacting the production matchmaking server.
    async function pump() {
      for (let i = 0; i < 20; i++) {
        let count = 0;
        for (const [from, to] of [[host, guest], [guest, host]]) {
          const messages = await from.evaluate(() => window.testOutbox.splice(0));
          count += messages.length;
          for (const message of messages) {
            // The room server forwards gameAction/playCard/endTurn as command.
            if (["gameAction", "playCard", "endTurn"].includes(message.type)) message.type = "command";
            await to.evaluate((message) => window.__chibattle.onlineHandleMessage(message), message);
          }
        }
        if (!count) return;
      }
      throw new Error("message relay did not settle");
    }
    await host.evaluate(() => window.__chibattle.onlineBroadcastState(true));
    await pump();
    const actor = sourceSide === "player" ? host : guest;
    const ids = await actor.evaluate(() => {
      const api = window.__chibattle;
      api.beginItemUse(api.state.players.player.hand[0]);
      return { own: api.state.players.player.board.seats[0].instanceId, own2: api.state.players.player.board.seats[8].instanceId, firstTeacher: api.state.players.opponent.board.seats[7].instanceId, enemy: api.state.players.opponent.board.teacher.instanceId };
    });
    await boardCard(actor, ids.own).click();
    await boardCard(actor, ids.own2).click();
    await host.evaluate(() => window.__chibattle.onlineBroadcastState(true));
    await pump();
    await expect(actor.locator("#endTurnButton")).toHaveText("指名する");
    await expect(actor.locator("#endTurnButton")).toBeEnabled();
    await actor.locator("#endTurnButton").click();
    await boardCard(actor, ids.firstTeacher).click();
    await boardCard(actor, ids.enemy).click();
    await host.evaluate(() => window.__chibattle.onlineBroadcastState(true));
    await pump();
    await expect(boardCard(actor, ids.firstTeacher).locator(".board-effect-order-badge")).toHaveText("1");
    await expect(boardCard(actor, ids.enemy).locator(".board-effect-order-badge")).toHaveText("2");
    await actor.locator("#endTurnButton").click();
    await pump();
    expect(await host.evaluate((side) => window.__chibattle.state.players[side === "player" ? "opponent" : "player"].life, sourceSide)).toBe(17);
    const selectionState = await actor.evaluate(() => ({ mode: window.__chibattle.state.pendingCardChoice?.mode, message: window.__chibattle.state.message, log: window.__chibattle.state.log.slice(0, 3) }));
    const hostState = await host.evaluate(() => ({ pending: window.__chibattle.state.pendingRemoteHandTrim, message: window.__chibattle.state.message, hand: window.__chibattle.state.players.opponent.hand.map((card) => card.baseId), log: window.__chibattle.state.log.slice(0, 5) }));
    expect(selectionState, JSON.stringify({ selectionState, hostState })).toMatchObject({ mode: sourceSide === "player" ? "logic_hunter" : "logic_hunter_online_response" });
    await host.evaluate(() => window.__chibattle.onlineBroadcastState(true));
    await pump();
    const chosen = await actor.evaluate(() => {
      const api = window.__chibattle;
      const choice = api.state.pendingCardChoice;
      if (!choice) throw new Error("手札選択画面が消えました");
      const card = choice.cards.find((card) => card.baseId === "water_2l");
      choice.selectedIds = [card.instanceId];
      api.confirmCardChoiceSelection();
      return card.instanceId;
    });
    await pump();
    const result = await host.evaluate(({ sourceSide, chosen }) => {
      const { state } = window.__chibattle;
      const other = sourceSide === "player" ? "opponent" : "player";
      return { hp: state.players[sourceSide].board.seats[0].currentHp, discarded: state.players[other].trash.some((card) => card.instanceId === chosen), ownHand: state.players[sourceSide].hand.length, pending: state.pendingRemoteHandTrim };
    }, { sourceSide, chosen });
    expect(result).toEqual({ hp: 1, discarded: true, ownHand: 0, pending: null });
    expect(await actor.evaluate(() => window.__chibattle.state.players.opponent.hand.map((card) => card.baseId))).toEqual(sourceSide === "player" ? ["general_student"] : [undefined]);
    expect(await actor.evaluate(() => window.__chibattle.state.online.pendingTurnCommandId)).toBe("");
  });
}
