const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("enemy_student");
    api.state.screen = "battle";
    api.state.phase = "battle";
    for (const side of ["player", "opponent"]) {
      api.state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
  });
});

test("敵の表示テキストに攻撃力+5と陽気を表示する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const enemy = api.createCardFromBase("enemy_student", "player");
    return {
      text: api.cardRulesText(enemy),
      markup: api.battleCardRulesMarkup(enemy)
    };
  });

  expect(result.text).toBe("相手の講義室に「TRPGサークルメンバー」がいる場合、このカードの攻撃力を+5し、[陽気]を持つ。");
  expect(result.markup).toContain('data-preview-term="陽気"');
});

test("相手のTRPGサークルメンバーにより席マスの敵は攻撃力7になり陽気を持ち、条件が外れると戻る", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const enemy = api.makeBoardCard(api.createCardFromBase("enemy_student", "player"));
    const trpg = api.makeBoardCard(api.createCardFromBase("trpg_member", "opponent"));
    api.state.players.player.board.seats[0] = enemy;
    api.state.players.opponent.board.seats[0] = trpg;
    api.applyBoardAuras();
    const active = {
      attack: enemy.attack,
      cheerful: api.hasKeyword(enemy, "陽気"),
      currentEffects: api.battleCardCurrentEffectsTemplate(enemy).markup
    };

    api.state.players.opponent.board.seats[0] = null;
    api.applyBoardAuras();
    const inactive = {
      attack: enemy.attack,
      cheerful: api.hasKeyword(enemy, "陽気")
    };
    return { active, inactive };
  });

  expect(result.active.attack).toBe(7);
  expect(result.active.cheerful).toBe(true);
  expect(result.active.currentEffects).toContain("TRPGサークルメンバー");
  expect(result.inactive).toEqual({ attack: 2, cheerful: false });
});

test("教卓マスにいる敵にも攻撃力+5と陽気を適用する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const enemy = api.makeBoardCard(api.createCardFromBase("enemy_student", "player"));
    api.state.players.player.board.teacher = enemy;
    api.state.players.opponent.board.teacher = api.makeBoardCard(api.createCardFromBase("trpg_member", "opponent"));
    api.applyBoardAuras();
    return {
      attack: enemy.attack,
      cheerful: api.hasKeyword(enemy, "陽気")
    };
  });

  expect(result).toEqual({ attack: 7, cheerful: true });
});
