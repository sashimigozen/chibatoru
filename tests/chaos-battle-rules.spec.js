const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("protein_drinker");
    const { state } = api;
    state.battleRuleId = "chaos";
    state.courseRegistration = null;
    state.environment = null;
    state.deckToHandLocks = [];
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], { hand: [], deck: [], trash: [], late: [], will: 0, maxWill: 1, turnsTaken: 0 });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
  });
});

test("全カード・増加コスト・選択コストを0にし、対戦外や通常ルールは元の数値を保つ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const costs = Object.keys(api.CARD_BASES).flatMap(id => ["player", "opponent"].map(side => api.effectiveCardCost(api.createCardFromBase(id, side))));
    const card = api.createCardFromBase("protein_drinker", "player");
    card.cost = 10;
    card.summerTeacherChoiceCost = 9;
    state.players.player.handCostTaxUntilActionTurn = 100;
    const modifiedCost = api.effectiveCardCost(card);
    state.players.player.will = 10;
    const ghidorah = api.effectiveCardCost(api.createCardFromBase("king_ghidorah_bed", "player"));
    state.screen = "home";
    const outside = api.effectiveCardCost(api.createCardFromBase("protein_drinker", "player"));
    state.screen = "battle";
    state.battleRuleId = "normal";
    delete state.players.player.handCostTaxUntilActionTurn;
    const normal = api.effectiveCardCost(api.createCardFromBase("protein_drinker", "player"));
    return { allZero: costs.every(cost => cost === 0), modifiedCost, ghidorah, outside, normal };
  });
  expect(result).toEqual({ allZero: true, modifiedCost: 0, ghidorah: 0, outside: 4, normal: 4 });
});

for (const count of [0, 2, 4, 5, 7]) {
  test(`カオスの手札${count}枚から不足分だけ補充する`, async ({ page }) => {
    const result = await page.evaluate((handCount) => {
      const api = window.__chibattle;
      const player = api.state.players.player;
      player.turnsTaken = 1;
      player.hand = Array.from({ length: handCount }, () => api.createCardFromBase("general_student", "player"));
      player.deck = Array.from({ length: 10 }, () => api.createCardFromBase("general_student", "player"));
      api.startTurn("player");
      return { hand: player.hand.length, deck: player.deck.length, gameOver: api.state.gameOver };
    }, count);
    expect(result).toEqual({ hand: Math.max(5, count), deck: 10 - Math.max(0, 5 - count), gameOver: false });
  });
}

test("戦意0で学生・持ち物・環境を使用でき、カードの丸には0だけを表示する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const card = api.createCardFromBase("protein_drinker", "player");
    const item = api.createCardFromBase("aggro_army", "player");
    const env = api.createCardFromBase("classroom", "player");
    player.hand = [card, item, env];
    api.render();
    const displayedZero = document.querySelector("#playerHand .stat-cost")?.textContent;
    const placed = api.placeCardFromHand("player", card.instanceId, "seat", "player", 0, false);
    const used = api.castImmediateItem("player", item, false);
    const environment = api.placeCardFromHand("player", env.instanceId, "environment", "player", null, false);
    api.showBattleCardPreview(card);
    return { placed, used, environment, will: player.will, displayedZero };
  });
  expect(result).toEqual({ placed: true, used: true, environment: true, will: 0, displayedZero: "0" });
  await expect(page.locator("#battleCardPreview .card-header .stat-cost")).toHaveText("0");
  await expect(page.locator("#battleCardPreview .card-header .stat-cost")).toHaveAttribute("aria-label", "戦意0");
});

test("戦意10のスモール小俣も変化を維持しつつ消費戦意0になる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    player.will = 10;
    const card = api.createCardFromBase("small_omata", "player");
    player.hand = [card];
    const used = api.placeCardFromHand("player", card.instanceId, "teacher", "player", null, false);
    return { used, will: player.will, big: player.board.seats.some(card => card?.baseId === "big_omata") };
  });
  expect(result).toEqual({ used: true, will: 10, big: true });
});

test("通常・専攻は1枚ドローのままで、カオスでもドロー禁止と履修登録の置き換えを保つ", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    return ["normal", "specialty", "blocked", "registration"].map(mode => {
      state.battleRuleId = ["normal", "specialty"].includes(mode) ? mode : "chaos";
      state.players.player.hand = [];
      state.players.player.turnsTaken = 1;
      state.players.player.deck = Array.from({ length: 10 }, () => api.createCardFromBase("general_student", "player"));
      state.deckToHandLocks = mode === "blocked" ? [{ owner: "opponent", releaseAtActionTurn: 999 }] : [];
      state.courseRegistration = mode === "registration" ? {
        remainingTurns: { player: 5, opponent: 5 },
        drawQueues: { player: [api.createCardFromBase("protein_drinker", "player")], opponent: [] }
      } : null;
      api.startTurn("player");
      return { hand: state.players.player.hand.map(card => card.baseId), deck: state.players.player.deck.length };
    });
  });
  expect(results).toEqual([
    { hand: ["general_student"], deck: 9 }, { hand: ["general_student"], deck: 9 },
    { hand: [], deck: 10 }, { hand: ["protein_drinker"], deck: 10 }
  ]);
});

test("先攻は初回だけ引かず、後攻の初回と先攻の次のターンは引く", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    return ["normal", "chaos"].flatMap((rule) => ["player", "opponent"].map((firstSide) => {
      state.battleRuleId = rule;
      state.firstSide = firstSide;
      state.gameOver = false;
      state.courseRegistration = null;
      for (const side of ["player", "opponent"]) {
        const owner = state.players[side];
        owner.turnsTaken = 0;
        owner.hand = Array.from({ length: 2 }, () => api.createCardFromBase("general_student", side));
        owner.deck = Array.from({ length: 10 }, () => api.createCardFromBase("general_student", side));
      }
      const secondSide = firstSide === "player" ? "opponent" : "player";
      state.currentSide = firstSide;
      api.startTurn(firstSide);
      const first = { hand: state.players[firstSide].hand.length, deck: state.players[firstSide].deck.length };
      state.currentSide = secondSide;
      api.startTurn(secondSide);
      const second = { hand: state.players[secondSide].hand.length, deck: state.players[secondSide].deck.length };
      state.currentSide = firstSide;
      api.startTurn(firstSide);
      const next = { hand: state.players[firstSide].hand.length, deck: state.players[firstSide].deck.length };
      return { rule, firstSide, first, second, next };
    }));
  });
  for (const { rule, firstSide, first, second, next } of results) {
    const expectedDrawnHand = rule === "chaos" ? 5 : 3;
    const expectedDeck = rule === "chaos" ? 7 : 9;
    expect({ rule, firstSide, first, second, next }).toEqual({
      rule, firstSide,
      first: { hand: 2, deck: 10 },
      second: { hand: expectedDrawnHand, deck: expectedDeck },
      next: { hand: expectedDrawnHand, deck: expectedDeck }
    });
  }
});

test("先攻初回は履修登録の代替ドローを消費せず、山札切れでも敗北しない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const player = state.players.player;
    state.battleRuleId = "normal";
    state.firstSide = "player";
    player.hand = [];
    player.deck = [];
    const reserved = api.createCardFromBase("protein_drinker", "player");
    state.courseRegistration = {
      remainingTurns: { player: 5, opponent: 5 },
      drawQueues: { player: [reserved], opponent: [] }
    };
    api.startTurn("player");
    const first = {
      hand: player.hand.length,
      reserved: state.courseRegistration.drawQueues.player.length,
      gameOver: state.gameOver
    };
    api.startTurn("player");
    return {
      first,
      second: {
        hand: player.hand.map((card) => card.baseId),
        reserved: state.courseRegistration.drawQueues.player.length,
        gameOver: state.gameOver
      }
    };
  });
  expect(result).toEqual({
    first: { hand: 0, reserved: 1, gameOver: false },
    second: { hand: ["protein_drinker"], reserved: 0, gameOver: false }
  });
});

test("補充できずデッキ切れなら敗北、手札5枚以上で引かないなら敗北しない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    player.hand = Array.from({ length: 5 }, () => api.createCardFromBase("general_student", "player"));
    api.startTurn("player");
    const fullHandSurvived = !api.state.gameOver;
    player.hand = [];
    player.deck = [api.createCardFromBase("general_student", "player")];
    api.startTurn("player");
    return { fullHandSurvived, gameOver: api.state.gameOver, winner: api.state.gameWinner };
  });
  expect(result).toEqual({ fullHandSurvived: true, gameOver: true, winner: "opponent" });
});
