const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("general_student");
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
    for (const side of ["player", "opponent"]) {
      const player = api.state.players[side];
      player.board = { teacher: null, seats: Array(9).fill(null) };
      player.hand = [];
      player.deck = [];
      player.trash = [];
      player.will = 20;
      player.maxWill = 20;
      player.attendancesThisTurn = 0;
    }
  });
});

test("複数マスの出席者へダブルダイヤモンドクロスをドラッグできる", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const api = window.__chibattle;
    const target = api.makeBoardCard(api.createCardFromBase("plump_student", "opponent"));
    api.attendCard("opponent", target, "seat", 0);
    const item = api.createCardFromBase("double_diamond", "player");
    api.state.players.player.hand.push(item);
    api.render();
    return { targetId: target.instanceId, itemId: item.instanceId };
  });

  await page.locator(`.player-hand .hand-card[data-card-id="${ids.itemId}"]`)
    .dragTo(page.locator(`.multi-seat-board-card[data-card-id="${ids.targetId}"]`));

  const result = await page.evaluate(({ targetId, itemId }) => {
    const api = window.__chibattle;
    return {
      targetHp: api.state.players.opponent.board.seats[0]?.currentHp,
      sameTargetAcrossSeats: api.state.players.opponent.board.seats[1]?.instanceId === targetId,
      itemInHand: api.state.players.player.hand.some((card) => card.instanceId === itemId)
    };
  }, ids);
  expect(result).toEqual({ targetHp: 1, sameTargetAcrossSeats: true, itemInHand: false });
});

test("スマホ幅でも複数マスの出席者を単体対象としてタップできる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ids = await page.evaluate(() => {
    const api = window.__chibattle;
    const target = api.makeBoardCard(api.createCardFromBase("plump_student", "opponent"));
    api.attendCard("opponent", target, "seat", 0);
    const item = api.createCardFromBase("double_diamond", "player");
    api.state.players.player.hand.push(item);
    api.state.selectedHandId = item.instanceId;
    api.render();
    return { targetId: target.instanceId, itemId: item.instanceId };
  });
  const target = page.locator(`.multi-seat-board-card[data-card-id="${ids.targetId}"]`);
  await expect(target).toHaveClass(/click-ready/);
  await target.click();
  expect(await page.evaluate(() => window.__chibattle.state.players.opponent.board.seats[0]?.currentHp)).toBe(1);
});

test("追加ダメージは複数マスの同じ出席者ではなく隣の別の出席者へ与える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const target = api.makeBoardCard(api.createCardFromBase("plump_student", "opponent"));
    api.attendCard("opponent", target, "seat", 0);
    const neighbor = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    api.state.players.opponent.board.seats[2] = neighbor;
    const item = api.createCardFromBase("double_diamond", "player");
    api.state.players.player.hand.push(item);
    const used = api.castItemOnCard("player", item, "opponent", "seat", 0, false);
    return {
      used,
      targetHp: api.state.players.opponent.board.seats[0]?.currentHp,
      sameTargetAcrossSeats: api.state.players.opponent.board.seats[1]?.instanceId === target.instanceId,
      neighborDestroyed: api.state.players.opponent.board.seats[2] === null
    };
  });
  expect(result).toEqual({ used: true, targetHp: 1, sameTargetAcrossSeats: true, neighborDestroyed: true });
});

test("単体を場から移す持ち物は複数マスの占有を残さない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const target = api.makeBoardCard(api.createCardFromBase("plump_student", "player"));
    api.attendCard("player", target, "seat", 0);
    const item = api.createCardFromBase("go_home", "player");
    api.state.players.player.hand.push(item);
    const used = api.castItemOnCard("player", item, "player", "seat", 0, false);
    return {
      used,
      occupied: api.state.players.player.board.seats.filter(Boolean).length,
      returned: api.state.players.player.hand.some((card) => card.baseId === "plump_student")
    };
  });
  expect(result).toEqual({ used: true, occupied: 0, returned: true });
});

test("単体を変化・移動・破壊する効果は複数マス全体を処理する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const opponent = api.state.players.opponent;

    const suited = api.makeBoardCard(api.createCardFromBase("plump_student", "opponent"));
    api.attendCard("opponent", suited, "seat", 0);
    const suit = api.createCardFromBase("bust_suit", "player");
    player.hand.push(suit);
    const transformed = api.castItemOnCard("player", suit, "opponent", "seat", 0, false);
    const suitSeats = opponent.board.seats.slice(0, 2).map((card) => card?.baseId || null);

    const moved = api.makeBoardCard(api.createCardFromBase("plump_student", "opponent"));
    api.attendCard("opponent", moved, "seat", 3);
    const vampirization = api.createCardFromBase("vampirization", "player");
    player.hand.push(vampirization);
    const vampirized = api.castItemOnCard("player", vampirization, "opponent", "seat", 3, false);
    const moveSeats = opponent.board.seats.slice(3, 5).map((card) => card?.baseId || null);
    const pendingId = api.state.pendingCopiedCard?.instanceId;

    opponent.board.seats = Array(9).fill(null);
    const big = api.makeBoardCard(api.createCardFromBase("big_omata", "opponent"));
    api.attendCard("opponent", big, "seat", 0);
    const removal = api.createCardFromBase("seriously_hit", "player");
    player.hand.push(removal);
    const destroyed = api.castItemOnCard("player", removal, "opponent", "seat", 0, false);
    return {
      transformed, suitSeats, vampirized, moveSeats,
      pendingMatches: pendingId === moved.instanceId,
      destroyed, remainingBigSeats: opponent.board.seats.filter((card) => card?.instanceId === big.instanceId).length
    };
  });
  expect(result).toEqual({
    transformed: true, suitSeats: ["suit_student", null],
    vampirized: true, moveSeats: [null, null], pendingMatches: true,
    destroyed: true, remainingBigSeats: 0
  });
});
