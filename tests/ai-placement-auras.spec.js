const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page, owner) {
  await page.goto(gameUrl);
  await page.evaluate((side) => {
    const api = window.__chibattle;
    const { state } = api;
    state.preBattleToken += 1000;
    Object.assign(state, { screen: "battle", phase: "battle", currentSide: side,
      actionTurn: 9, firstSide: "player", environment: null, gameOver: false,
      noAttackUntilActionTurn: 0 });
    Object.assign(state.training, { active: true, leftController: "ai", skipAnimations: true });
    for (const current of ["player", "opponent"]) {
      Object.assign(state.players[current], { life: 20, will: 10, maxWill: 10,
        hand: [], deck: [], trash: [], late: [], turnsTaken: 5, originalDeckCounts: {},
        board: { teacher: null, seats: Array(9).fill(null) } });
    }
    window.auraTest = {
      side,
      hand: (id) => {
        const card = api.createCardFromBase(id, side);
        state.players[side].hand = [card];
        return card;
      },
      put: (id, index, options = {}) => {
        const card = api.makeBoardCard(api.createCardFromBase(id, side));
        Object.assign(card, options);
        state.players[side].board.seats[index] = card;
        return card;
      },
      move: () => side === "player" ? api.findTrainingAiPlayMove(side) : api.findAiPlayMove(),
      score: (card, index) => api.scoreAiPlacementAuras(side, card, "seat", index),
      environment: (id) => { state.environment = api.makeBoardCard(api.createCardFromBase(id, side)); }
    };
  }, owner);
}

for (const side of ["player", "opponent"]) {
  test(`${side}: 雁木囲いの強化マスへ出席し、評価は実盤面を変更しない`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(() => {
      const api = window.__chibattle;
      const t = window.auraTest;
      t.environment("gangi_fortress");
      const card = t.hand("general_student");
      const originalPlayers = api.state.players;
      const before = JSON.stringify(api.state);
      const buff = t.score(card, 4);
      const plain = t.score(card, 0);
      const move = t.move();
      const unchanged = before === JSON.stringify(api.state) && originalPlayers === api.state.players;
      api.placeCardFromHand(t.side, card.instanceId, move.zone, t.side, move.index, false);
      const placed = api.state.players[t.side].board.seats[move.index];
      return { index: move.index, buff, plain, unchanged, hp: placed.currentHp, base: placed.baseMaxHp };
    });
    expect([3, 4, 6, 7]).toContain(result.index);
    expect(result.buff).toBeGreaterThan(result.plain);
    expect(result.unchanged).toBe(true);
    expect(result.hp).toBe(result.base + 2);
  });
  test(`${side}: 狼の周囲を避け、味方の強化と残り体力を守る`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(() => {
      const api = window.__chibattle;
      const t = window.auraTest;
      const wolf = t.put("lone_wolf", 0);
      api.applyBoardAuras();
      wolf.currentHp = 2;
      const card = t.hand("general_student");
      const before = JSON.stringify(api.state);
      const bad = t.score(card, 4);
      const safe = t.score(card, 8);
      const move = t.move();
      const unchanged = before === JSON.stringify(api.state);
      api.placeCardFromHand(t.side, card.instanceId, move.zone, t.side, move.index, false);
      return { index: move.index, bad, safe, unchanged, attack: wolf.attack, hp: wolf.currentHp };
    });
    expect([1, 3, 4]).not.toContain(result.index);
    expect(result.bad).toBeLessThan(result.safe);
    expect(result).toMatchObject({ unchanged: true, attack: 5, hp: 2 });
  });
  test(`${side}: ベストフレンドの隣でバカでかいカードの隣接強化を受ける`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(() => {
      const api = window.__chibattle;
      const t = window.auraTest;
      const friend = t.put("best_friend", 0);
      const card = t.hand("loud_student");
      const near = t.score(card, 1);
      const far = t.score(card, 8);
      const move = t.move();
      api.placeCardFromHand(t.side, card.instanceId, move.zone, t.side, move.index, false);
      return { index: move.index, near, far, attack: friend.attack, hp: friend.currentHp };
    });
    expect([1, 3]).toContain(result.index);
    expect(result.near).toBeGreaterThan(result.far);
    expect(result).toMatchObject({ attack: 3, hp: 4 });
  });
  test(`${side}: 学長の眠気を受けて即時攻撃できない配置を低く評価する`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(() => {
      const api = window.__chibattle;
      const t = window.auraTest;
      const card = t.hand("general_teacher");
      const plain = t.score(card, 0);
      api.state.players[t.side === "player" ? "opponent" : "player"].board.teacher =
        api.makeBoardCard(api.createCardFromBase("president", t.side === "player" ? "opponent" : "player"));
      const sleepy = t.score(card, 0);
      return { plain, sleepy };
    });
    expect(result.sleepy).toBeLessThan(result.plain);
  });
  test(`${side}: 複数マスの同じ出席者参照を維持して評価し、手札・ログも変えない`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(() => {
      const api = window.__chibattle;
      const t = window.auraTest;
      t.environment("gangi_fortress");
      const existing = t.put("loud_members", 0);
      for (const index of [1, 3, 4]) api.state.players[t.side].board.seats[index] = existing;
      api.applyBoardAuras();
      const card = t.hand("general_student");
      const before = JSON.stringify(api.state);
      t.score(card, 8);
      return before === JSON.stringify(api.state) && api.state.players[t.side].board.seats[0] === existing
        && api.state.players[t.side].board.seats[4] === existing;
    });
    expect(result).toBe(true);
  });
}
