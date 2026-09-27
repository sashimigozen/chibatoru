const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
});

test("純粋の破壊をバカでかい型の持ち物として登録する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("pure_destruction", "player");
    return {
      name: card.name,
      type: card.type,
      cost: card.cost,
      category: card.category,
      text: api.cardRulesText(card)
    };
  });

  expect(result).toEqual({
    name: "純粋の破壊",
    type: "item",
    cost: 3,
    category: "big",
    text: "自分の講義室に戦意6以上の学生がいるなら、このカードの戦意は0になる。\n環境マスにある環境カードを校外エリアへ送る。その後、自分のデッキから戦意6以上の学生カード1枚をランダムに手札へ加える。"
  });
});

test("純粋の破壊は環境カードを校外へ送り、戦意6以上の学生を手札へ加える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.actionTurn = 1;
    state.players.player.will = 3;
    state.players.player.hand = [api.createCardFromBase("pure_destruction", "player")];
    state.players.player.deck = [
      api.createCardFromBase("general_student", "player"),
      api.createCardFromBase("strong_student", "player")
    ];
    state.players.player.trash = [];
    state.players.opponent.trash = [];
    state.environment = api.makeBoardCard(api.createCardFromBase("cafeteria", "opponent"));

    const used = api.castImmediateItem("player", state.players.player.hand[0], false);
    return {
      used,
      will: state.players.player.will,
      environment: state.environment,
      hand: state.players.player.hand.map((card) => card.baseId),
      deck: state.players.player.deck.map((card) => card.baseId),
      ownTrash: state.players.player.trash.map((card) => card.baseId),
      enemyTrash: state.players.opponent.trash.map((card) => card.baseId)
    };
  });

  expect(result).toEqual({
    used: true,
    will: 0,
    environment: null,
    hand: ["strong_student"],
    deck: ["general_student"],
    ownTrash: ["pure_destruction"],
    enemyTrash: ["cafeteria"]
  });
});

test("戦意6以上の学生がいれば戦意0になり、環境がなくても学生を手札へ加える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.actionTurn = 1;
    state.players.player.will = 0;
    state.players.player.hand = [api.createCardFromBase("pure_destruction", "player")];
    state.players.player.deck = [
      api.createCardFromBase("general_student", "player"),
      api.createCardFromBase("loud_student", "player")
    ];
    state.players.player.board.seats.fill(null);
    state.players.player.board.seats[0] = api.makeBoardCard(api.createCardFromBase("strong_student", "player"));
    state.players.player.trash = [];
    state.environment = null;
    const item = state.players.player.hand[0];
    const displayedCost = api.effectiveCardCost(item);
    api.render();
    const displayedBadge = document.querySelector('#playerHand [data-base-id="pure_destruction"] .card-header .stat-cost')?.textContent || "";

    const used = api.castImmediateItem("player", item, false);
    return {
      displayedCost,
      displayedBadge,
      used,
      will: state.players.player.will,
      hand: state.players.player.hand.map((card) => card.baseId),
      deck: state.players.player.deck.map((card) => card.baseId)
    };
  });

  expect(result).toEqual({
    displayedCost: 0,
    displayedBadge: "0",
    used: true,
    will: 0,
    hand: ["loud_student"],
    deck: ["general_student"]
  });
});

test("ver.0.23.6の更新情報に純粋の破壊を統合する", async ({ page }) => {
  await page.evaluate(() => {
    window.__chibattle.state.screen = "home";
    window.__chibattle.render();
  });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry", { hasText: "2026年9月26日" }).first();
  await expect(entry.locator("summary")).toContainText("ver.0.23.6");
  await entry.locator("summary").click();
  await expect(entry.locator(".update-change", { hasText: "純粋の破壊" })).toBeVisible();
});
