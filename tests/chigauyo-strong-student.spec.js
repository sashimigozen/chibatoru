const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const chigauyoText = "お互いのプレイヤーは手札をすべてデッキに戻してシャッフルする。その後、それぞれデッキからカードを4枚引く。";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
});

test("ちがうよの本文をデッキからカードを引く表記に揃える", async ({ page }) => {
  const displayed = await page.evaluate(() => {
    const api = window.__chibattle;
    return api.cardRulesText(api.createCardFromBase("chigauyo", "player"));
  });
  expect(displayed).toBe(chigauyoText);

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const rulesSource = fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8");
  const ledgerSource = fs.readFileSync(path.join(__dirname, "..", "カード管理台帳.html"), "utf8");
  for (const source of [indexSource, rulesSource, ledgerSource]) {
    expect(source).toContain(chigauyoText);
  }
});

test("ちがうよは両者の手札を戻してそれぞれ4枚引く", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("chigauyo");
    const state = api.state;
    state.phase = "battle";
    state.currentSide = "player";
    state.players.player.will = 10;
    const item = state.players.player.hand.find((card) => card.baseId === "chigauyo")
      || api.createCardFromBase("chigauyo", "player");
    state.players.player.hand = [item, api.createCardFromBase("general_student", "player")];
    state.players.opponent.hand = [api.createCardFromBase("general_teacher", "opponent")];
    state.players.player.deck = Array.from({ length: 8 }, () => api.createCardFromBase("strong_student", "player"));
    state.players.opponent.deck = Array.from({ length: 8 }, () => api.createCardFromBase("general_student", "opponent"));

    api.castImmediateItem("player", item);
    return {
      playerHand: state.players.player.hand.length,
      opponentHand: state.players.opponent.hand.length,
      playerDeck: state.players.player.deck.length,
      opponentDeck: state.players.opponent.deck.length,
      itemInTrash: state.players.player.trash.some((card) => card.baseId === "chigauyo")
    };
  });

  expect(result).toEqual({
    playerHand: 4,
    opponentHand: 4,
    playerDeck: 5,
    opponentDeck: 5,
    itemInTrash: true
  });
});

test("強靭な学生を共通カードの6戦意7/7として登録する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("strong_student", "player");
    return {
      name: card.name,
      type: card.type,
      cost: card.cost,
      attack: card.attack,
      hp: card.hp,
      zones: card.allowedZones,
      category: card.category,
      directDeck: api.specialtyAllowedCardIds("common").has("strong_student"),
      common: api.SPECIALTY_CARD_IDS.common.includes("strong_student"),
      text: api.cardRulesText(card)
    };
  });

  expect(result).toEqual({
    name: "強靭な学生",
    type: "student",
    cost: 6,
    attack: 7,
    hp: 7,
    zones: ["seat", "teacher"],
    category: "common",
    directDeck: true,
    common: true,
    text: "効果なし。"
  });
});

test("ver.0.23.6の更新情報に同日のカード変更を統合する", async ({ page }) => {
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.screen = "home";
    api.render();
  });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry", { hasText: "2026年9月26日" }).first();
  await expect(entry.locator("summary")).toContainText("ver.0.23.6");
  await entry.locator("summary").click();
  await expect(entry.locator(".update-change", { hasText: "ちがうよ" })).toContainText("デッキからカードを4枚引く");
  await expect(entry.locator(".update-change", { hasText: "強靭な学生" })).toContainText("戦意6／攻撃力7／体力7");
});
