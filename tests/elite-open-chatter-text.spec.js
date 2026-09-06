const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("エリートオープンチャッターはデッキを3枚引く表記で実際に3枚ドローさせる", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.preBattleToken += 1000;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.firstSide = "player";
    state.actionTurn = 4;
    state.testMode = false;
    state.gameOver = false;
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], {
        life: 20,
        will: 10,
        maxWill: 10,
        hand: [],
        deck: [],
        trash: [],
        late: [],
        turnsTaken: 3
      });
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
    const card = api.createCardFromBase("elite_open_chatter", "player");
    state.players.player.hand = [card];
    state.players.opponent.deck = Array.from({ length: 3 }, () => api.createCardFromBase("general_student", "opponent"));
    const text = api.cardRulesText(card);
    const placed = api.placeCardFromHand("player", card.instanceId, "seat", "player", 0, false);
    return {
      text,
      placed,
      opponentHand: state.players.opponent.hand.length,
      opponentDeck: state.players.opponent.deck.length
    };
  });
  expect(result).toEqual({
    text: "席マスにのみ出席できる。このカードを手札から出席させたとき、相手はデッキを3枚引く。",
    placed: true,
    opponentHand: 3,
    opponentDeck: 0
  });
});

test("同日の更新情報にカード修正形式で記載する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();
  const latest = page.locator(".update-entry").first();
  await latest.locator("summary").click();
  await expect(latest).toContainText("エリートオープンチャッター");
  await expect(latest).toContainText("学生／妨害／戦意4／攻撃力3／体力6");
  await expect(latest).toContainText("相手はデッキを3枚引く。");
});
