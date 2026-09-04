const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const { state } = window.__chibattle;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.gameOver = false;
    state.aiThinking = false;
    state.actionTurn = 2;
    state.environment = null;
    state.recentBoardTrash = [];
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], {
        life: 20, will: 10, hand: [], deck: [], trash: [], late: [],
        board: { seats: Array(9).fill(null), teacher: null }
      });
    }
  });
});

test("全トークンは両プレイヤーの破壊・手札破棄で消滅し、校外や復活履歴に残らない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const ids = Object.keys(api.CARD_BASES).filter(id => api.CARD_BASES[id].token);
    const checks = [];
    for (const side of ["player", "opponent"]) {
      for (const id of ids) {
        const card = api.makeBoardCard(api.createCardFromBase(id, side));
        state.players[side].board.seats[0] = card;
        const removed = api.destroyBoardCard({ owner: side, zone: "seat", index: 0 }, { reason: "体力0", showDestroyFeedback: false });
        checks.push(removed === card && card.tokenVanished && !state.players[side].board.seats[0]);
        const handCard = api.createCardFromBase(id, side);
        state.players[side].hand = [handCard];
        api.moveHandCardToTrash(side, handCard);
        checks.push(state.players[side].hand.length === 0 && handCard.tokenVanished);
      }
    }
    const snapshot = api.onlineCreateSnapshot();
    return { ids, checks, trash: [state.players.player.trash.length, state.players.opponent.trash.length], history: state.recentBoardTrash.length,
      snapshotHasVanishedCard: JSON.stringify(snapshot.state.players).includes('"tokenVanished":true') };
  });
  expect(result.ids).toHaveLength(6);
  expect(result.checks.every(Boolean)).toBe(true);
  expect(result.trash).toEqual([0, 0]);
  expect(result.history).toBe(0);
  expect(result.snapshotHasVanishedCard).toBe(false);
});

test("通常カードのコピーと生成専用カードは消滅せず、トークンの装備も校外へ送る", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    for (const id of ["general_student", "key", "dry_meal_ticket"]) {
      api.moveToTrash("player", { ...api.createCardFromBase(id, "player") });
    }
    const token = api.makeBoardCard(api.createCardFromBase("extra_student", "player"));
    token.padlockEquipment = api.createCardFromBase("padlock", "opponent");
    token.earphoneEquipment = api.createCardFromBase("earphones", "player");
    state.players.player.board.seats[0] = token;
    api.destroyBoardCard({ owner: "player", zone: "seat", index: 0 }, { reason: "体力0", showDestroyFeedback: false });
    return { player: state.players.player.trash.map(c => c.baseId), opponent: state.players.opponent.trash.map(c => c.baseId) };
  });
  expect(result.player).toEqual(["general_student", "key", "dry_meal_ticket", "earphones"]);
  expect(result.opponent).toEqual(["padlock"]);
});

test("旧データのトークンも回収・デッキ戻し・逆行の対象外になり表示時に校外から消える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const token = api.createCardFromBase("extra_student", "player");
    delete token.token; // 古いデータでもカード定義から判定する。
    const ordinary = Array.from({ length: 4 }, () => api.createCardFromBase("general_student", "player"));
    state.players.player.trash = [token, ...ordinary];
    const item = api.createCardFromBase("go_away", "player");
    state.players.player.hand = [item];
    const returned = api.resolveGoAwayChoice("player", item, state.players.player.trash.map(c => c.instanceId), false);
    state.recentBoardTrash = [{ owner: "player", zone: "seat", index: 0, actionTurn: 1, card: { ...token, lastDamageSource: { baseId: "general_student" } } }];
    const restored = api.restoreRecentBoardCard("player");
    state.players.opponent.trash = [api.createCardFromBase("ta", "opponent"), api.createCardFromBase("key", "opponent")];
    const picked = api.pickCardsFromDeckAndTrash("opponent", 3);
    api.render();
    return { returned, restored, picked, will: state.players.player.will,
      playerTrash: state.players.player.trash.map(c => c.baseId), opponentTrash: state.players.opponent.trash.length,
      hand: state.players.opponent.hand.map(c => c.baseId), history: state.recentBoardTrash.length };
  });
  expect(result.returned).toBe(false);
  expect(result.restored).toBe(false);
  expect(result.will).toBe(10);
  expect(result.picked).toBe(1);
  expect(result.hand).toEqual(["key"]);
  expect(result.playerTrash).toEqual(Array(4).fill("general_student"));
  expect(result.opponentTrash).toBe(0);
  expect(result.history).toBe(0);
});

test("幸せの青い鳥はトークン消滅では増殖せず通常の校外送りでは増殖する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const results = [];
    for (const id of ["extra_student", "general_student"]) {
      const bird = api.makeBoardCard(api.createCardFromBase("happy_blue_bird", "player"));
      state.players.player.board.seats[0] = bird;
      state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase(id, "opponent"));
      results.push(api.resolveCardAttackWithBoardCleanup(bird, { owner: "opponent", zone: "seat", index: 0 }));
    }
    return results;
  });
  expect(result).toEqual([{ targetDefeated: true, birdSummoned: false }, { targetDefeated: true, birdSummoned: true }]);
});

test("通常カード5枚のデッキ戻しとドローは引き続き使える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    player.trash = Array.from({ length: 5 }, () => api.createCardFromBase("general_student", "player"));
    const item = api.createCardFromBase("go_away", "player");
    player.hand = [item];
    const success = api.resolveGoAwayChoice("player", item, player.trash.map(c => c.instanceId), false);
    return { success, deck: player.deck.length, hand: player.hand.length, trash: player.trash.map(c => c.baseId) };
  });
  expect(result).toEqual({ success: true, deck: 3, hand: 2, trash: ["go_away"] });
});

test("今回の更新情報を表示し、一度読んだら未読表示が消える", async ({ page }) => {
  await page.goto(gameUrl);
  await expect(page.locator("#homeUpdatesDot")).toBeVisible();
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").first();
  await expect(entry).toContainText("ver.0.22.1");
  await entry.locator("summary").click();
  await expect(entry).toContainText("校外には置かず消滅する");
  await expect(entry).not.toHaveClass(/unread/);
  await page.reload();
  await expect(page.locator("#homeUpdatesDot")).toBeHidden();
  await page.locator("#homeUpdatesButton").click();
  await expect(page.locator(".update-entry").first()).not.toHaveClass(/unread/);
});
