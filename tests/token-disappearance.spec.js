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
  expect(result.ids).toHaveLength(8);
  expect(result.ids).toContain("grudge");
  expect(result.ids).toContain("recovered_dark_yuta");
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
    const ordinary = Array.from({ length: 5 }, () => api.createCardFromBase("general_student", "player"));
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
  expect(result.returned).toBe(true);
  expect(result.restored).toBe(false);
  expect(result.will).toBe(8);
  expect(result.picked).toBe(1);
  expect(result.hand).toEqual(["key"]);
  expect(result.playerTrash).toEqual(["go_away"]);
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

test("行かれてはいかがですかは通常カードを必ず5枚選ぶ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const cases = [0, 1, 3, 4, 5, 6].map((count) => {
      const player = api.state.players.player;
      player.deck = [];
      player.trash = Array.from({ length: count }, () => api.createCardFromBase("general_student", "player"));
      const item = api.createCardFromBase("go_away", "player");
      player.hand = [item];
      player.will = 10;
      const success = api.resolveGoAwayChoice("player", item, player.trash.map((card) => card.instanceId), false);
      return {
        count,
        success,
        will: player.will,
        deck: player.deck.length,
        hand: player.hand.length,
        trash: player.trash.length
      };
    });
    return {
      text: api.cardRulesText(api.createCardFromBase("go_away", "player")),
      cases
    };
  });

  expect(result.text).toBe("自分の校外エリアにある学生・教師・ヴァンパイアを合計5枚指名する。\nそれらを自分のデッキに戻してシャッフルし、カードを2枚引く。");
  expect(result.cases).toEqual([
      { count: 0, success: false, will: 10, deck: 0, hand: 1, trash: 0 },
      { count: 1, success: false, will: 10, deck: 0, hand: 1, trash: 1 },
      { count: 3, success: false, will: 10, deck: 0, hand: 1, trash: 3 },
      { count: 4, success: false, will: 10, deck: 0, hand: 1, trash: 4 },
      { count: 5, success: true, will: 8, deck: 3, hand: 2, trash: 1 },
      { count: 6, success: false, will: 10, deck: 0, hand: 1, trash: 6 }
    ]);
});

test("5枚未満なら使用不可、選択UIは5枚を選ぶまで確定不可", async ({ page }) => {
  const prepare = count => page.evaluate(count => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    player.trash = Array.from({ length: count }, () => api.createCardFromBase("general_student", "player"));
    // 持ち物は必要な5枚に含めない。
    player.trash.push(api.createCardFromBase("ruler", "player"));
    const item = api.createCardFromBase("go_away", "player");
    player.hand = [item];
    const usable = canUseItemNow(item);
    api.beginItemUse(item);
    return { usable, choice: Boolean(api.state.pendingCardChoice), will: player.will, hand: player.hand.length };
  }, count);
  expect(await prepare(4)).toEqual({ usable: false, choice: false, will: 10, hand: 1 });
  expect(await prepare(6)).toEqual({ usable: true, choice: true, will: 10, hand: 1 });
  await expect(page.locator("#threeGesturesMessage")).toContainText("5枚選んでください");
  await expect(page.locator("#threeGesturesHand .card")).toHaveCount(6);
  const select = index => page.locator("#threeGesturesHand .card").nth(index).click();
  for (let index = 0; index < 4; index++) await select(index);
  await expect(page.locator("#threeGesturesConfirmButton")).toBeDisabled();
  await select(4);
  await expect(page.locator("#threeGesturesConfirmButton")).toBeEnabled();
  await select(5);
  expect(await page.evaluate(() => window.__chibattle.state.pendingCardChoice.selectedIds.length)).toBe(5);
  await page.locator("#threeGesturesConfirmButton").click();
  expect(await page.evaluate(() => {
    const player = window.__chibattle.state.players.player;
    return { will: player.will, deck: player.deck.length, hand: player.hand.length,
      trash: player.trash.map(card => card.baseId) };
  })).toEqual({ will: 8, deck: 3, hand: 2, trash: ["general_student", "ruler", "go_away"] });
});

test("AIの自動選択とオンライン用の相手側処理も必ず5枚に揃う", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    const results = [];
    for (const side of ["player", "opponent"]) {
      for (const count of [4, 5, 6]) {
        const player = api.state.players[side];
        player.will = 10;
        player.deck = [];
        player.trash = Array.from({ length: count }, () => api.createCardFromBase("general_student", side));
        const item = api.createCardFromBase("go_away", side);
        player.hand = [item];
        const score = side === "player" ? scoreTrainingYocchanItem(side, item) : scoreAiItem(item);
        const success = castImmediateItem(side, item, false);
        results.push({ side, count, success, will: player.will, deck: player.deck.length,
          hand: player.hand.length, remaining: player.trash.filter(card => card.baseId !== "go_away").length,
          unavailableScore: count === 4 ? score <= 0 : true });
      }
      const player = api.state.players[side];
      player.will = 10;
      player.deck = [];
      player.trash = Array.from({ length: 6 }, () => api.createCardFromBase("general_student", side));
      const item = api.createCardFromBase("go_away", side);
      player.hand = [item];
      const ids = player.trash.map(card => card.instanceId);
      results.push({ side, rejectedFour: !api.resolveGoAwayChoice(side, item, ids.slice(0, 4), false),
        rejectedSix: !api.resolveGoAwayChoice(side, item, ids, false),
        acceptedFive: api.resolveGoAwayChoice(side, item, ids.slice(0, 5), false) });
    }
    return results;
  });
  for (const side of ["player", "opponent"]) {
    expect(results.filter(result => result.side === side)).toEqual([
      { side, count: 4, success: false, will: 10, deck: 0, hand: 1, remaining: 4, unavailableScore: true },
      { side, count: 5, success: true, will: 8, deck: 3, hand: 2, remaining: 0, unavailableScore: true },
      { side, count: 6, success: true, will: 8, deck: 3, hand: 2, remaining: 1, unavailableScore: true },
      { side, rejectedFour: true, rejectedSix: true, acceptedFive: true }
    ]);
  }
});

test("今回の更新情報を表示し、一度読んだら未読表示が消える", async ({ page }) => {
  await page.goto(gameUrl);
  await expect(page.locator("#homeUpdatesDot")).toBeVisible();
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ hasText: "ver.0.22.1" });
  await expect(entry).toContainText("ver.0.22.1");
  await entry.locator("summary").click();
  await expect(entry).toContainText("校外には置かず消滅する");
  await expect(entry).not.toHaveClass(/unread/);
  await page.reload();
  await expect(page.locator("#homeUpdatesDot")).toBeHidden();
  await page.locator("#homeUpdatesButton").click();
  await expect(page.locator(".update-entry").first()).not.toHaveClass(/unread/);
});
