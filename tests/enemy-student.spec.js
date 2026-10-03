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

  expect(result.text).toBe("このカードはデッキに4枚以上入れられる。\n相手の講義室に「TRPGサークルメンバー」がいるかぎり、このカードの攻撃力を+5し、[陽気]を持つ。");
  expect(result.markup).toContain('data-preview-term="陽気"');
});

test("相手のTRPGサークルメンバーにより席マスの敵は攻撃力6になり陽気を持ち、条件が外れると戻る", async ({ page }) => {
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

  expect(result.active.attack).toBe(6);
  expect(result.active.cheerful).toBe(true);
  expect(result.active.currentEffects).toContain("TRPGサークルメンバー");
  expect(result.inactive).toEqual({ attack: 1, cheerful: false });
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

  expect(result).toEqual({ attack: 6, cheerful: true });
});

for (const zone of ["seat", "teacher"]) {
  test(`敵に塩を使用した直後、${zone}の敵の攻撃力と表示が更新される`, async ({ page }) => {
    const result = await page.evaluate((zone) => {
      const api = window.__chibattle;
      const enemy = api.makeBoardCard(api.createCardFromBase("enemy_student", "player"));
      enemy.playedOnTurn = 0;
      if (zone === "teacher") api.state.players.player.board.teacher = enemy;
      else api.state.players.player.board.seats[0] = enemy;
      const salt = api.createCardFromBase("salt_to_enemy", "player");
      api.state.players.player.hand = [salt];
      const used = api.castCaptureOnSlot("player", salt, "opponent", "seat", 0, true);
      return {
        used,
        attack: enemy.attack,
        cheerful: api.hasKeyword(enemy, "陽気"),
        displayedAttack: document.querySelector(`[data-card-id="${enemy.instanceId}"] .field-stat.attack`).textContent
      };
    }, zone);
    expect(result).toEqual({ used: true, attack: 6, cheerful: true, displayedAttack: "6" });
  });
}

test("画面更新を行わないCPU側の敵に塩でも、全ての敵に強化を重複させず適用する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.currentSide = "opponent";
    const enemy = api.makeBoardCard(api.createCardFromBase("enemy_student", "opponent"));
    const buffed = api.makeBoardCard(api.createCardFromBase("enemy_student", "opponent"));
    // A previously granted +2 attack must survive the continuous +5 aura.
    buffed.baseAttack = buffed.attack = 3;
    api.state.players.opponent.board.seats[0] = enemy;
    api.state.players.opponent.board.teacher = buffed;
    api.state.players.opponent.hand = [0, 1].map(() => api.createCardFromBase("salt_to_enemy", "opponent"));
    const used = [];
    for (const index of [0, 1]) {
      const salt = api.state.players.opponent.hand[0];
      used.push(api.castCaptureOnSlot("opponent", salt, "player", "seat", index, false));
    }
    return {
      used,
      attack: enemy.attack,
      modifiedAttack: buffed.attack,
      hp: [enemy.currentHp, buffed.currentHp],
      cheerful: [enemy, buffed].map((card) => api.hasKeyword(card, "陽気"))
    };
  });
  expect(result).toEqual({ used: [true, true], attack: 6, modifiedAttack: 8, hp: [2, 2], cheerful: [true, true] });
});
