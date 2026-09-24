const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const rawRules = "このカードは教卓マスにのみ出席できる。このカードを手札から出席させたとき、相手の出席者1人を指名する。その出席者は1ターン攻撃できない。このカードを戦意10で手札から出席させたとき、このカードと自分の席マスにいる出席者すべてを破壊する。その後、自分の席マスすべてを使って「ビッグ小俣」を出席させる。";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("small_omata");
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
    api.state.battleRuleId = "normal";
  });
});

test("スモール小俣の本文を効果が変わることが分かるチバトル文体に揃える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("small_omata", "player");
    return api.cardRulesText(card);
  });

  expect(result).toBe([
    "このカードは教卓マスにのみ出席できる。",
    "このカードを手札から出席させたとき、相手の出席者1人を指名する。",
    "その出席者は1ターン攻撃できない。",
    "このカードを戦意10で手札から出席させたとき、このカードと自分の席マスにいる出席者すべてを破壊する。その後、自分の席マスすべてを使って「ビッグ小俣」を出席させる。"
  ].join("\n"));

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const rulesSource = fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8");
  expect(indexSource).toContain(`small_omata: "${rawRules}"`);
  expect(rulesSource).toContain(`small_omata: "${rawRules}"`);
});

test("手札の戦意表示は現在戦意9以下なら4、戦意10なら10になる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const card = player.hand.find((entry) => entry.baseId === "small_omata");
    player.hand = [card];
    player.will = 9;
    api.render();
    const belowTen = {
      cost: api.effectiveCardCost(card),
      display: document.querySelector('#playerHand [data-base-id="small_omata"] .stat-cost')?.textContent || ""
    };
    player.will = 10;
    api.render();
    const atTen = {
      cost: api.effectiveCardCost(card),
      display: document.querySelector('#playerHand [data-base-id="small_omata"] .stat-cost')?.textContent || ""
    };
    return { belowTen, atTen };
  });

  expect(result).toEqual({
    belowTen: { cost: 4, display: "4" },
    atTen: { cost: 10, display: "10" }
  });
});

test("戦意10では単体指名を行わず、戦意10を使ってビッグ小俣へ変わる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const opponent = api.state.players.opponent;
    player.will = 10;
    player.board.teacher = null;
    opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("protein_drinker", "opponent"));
    const card = player.hand.find((entry) => entry.baseId === "small_omata");
    player.hand = [card];
    const placed = api.placeCardFromHand("player", card.instanceId, "teacher", "player", null, false);
    const big = player.board.seats.find((entry) => entry?.baseId === "big_omata") || null;
    return {
      placed,
      will: player.will,
      pendingTarget: api.state.pendingAttendTarget,
      teacher: player.board.teacher?.baseId || null,
      big: big?.baseId || null,
      occupiedSeats: player.board.seats.filter((entry) => entry?.baseId === "big_omata").length,
      opponentLocked: opponent.board.seats[0]?.attackLockedUntilOwnerTurnsTaken === opponent.turnsTaken + 1
    };
  });

  expect(result).toEqual({
    placed: true,
    will: 0,
    pendingTarget: null,
    teacher: null,
    big: "big_omata",
    occupiedSeats: 9,
    opponentLocked: true
  });
});

test("ver.0.23.5の更新情報にカード2枚の変更を統合する", async ({ page }) => {
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.screen = "home";
    api.render();
  });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry", { hasText: "2026年9月24日" }).first();
  await expect(entry.locator("summary")).toContainText("ver.0.23.5");
  await entry.locator("summary").click();
  await expect(entry.locator(".update-change", { hasText: "「絶対」女" })).toContainText("1ターンに3回まで攻撃できる");
  await expect(entry.locator(".update-change", { hasText: "スモール小俣" })).toContainText("10なら手札で戦意10と表示する");
});
