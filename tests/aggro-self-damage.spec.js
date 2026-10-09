const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page, side = "player") {
  await page.goto(gameUrl);
  await page.evaluate(side => {
    const api = window.__chibattle, s = api.state;
    api.startCardTest("aggro_walk");
    s.preBattleToken += 1000;
    Object.assign(s, { screen: "battle", phase: "battle", currentSide: side, actionTurn: 8,
      gameOver: false, gameWinner: null, noAttackUntilActionTurn: 0, testMode: false, environment: null });
    Object.assign(s.training, { active: true, leftController: "human", speed: 4,
      paused: false, skipAnimations: true });
    for (const owner of ["player", "opponent"]) {
      Object.assign(s.players[owner], { life: 20, will: 10, maxWill: 10, hand: [], trash: [], late: [],
        attendancesThisTurn: 0, lifeShieldUntilTurn: 0, lifeShieldUntilSide: null, lifeFloorShields: [],
        deck: Array.from({ length: 10 }, () => api.createCardFromBase("suspicious_document", owner)),
        board: { teacher: null, seats: Array(9).fill(null) } });
    }
  }, side);
}

test("2枚の表示本文・台帳・更新情報が合意した文章と一致する", async ({ page }) => {
  await setup(page);
  const texts = await page.evaluate(() => {
    const api = window.__chibattle;
    return ["aggro_walk", "aggro_princess"].map(id => api.cardRulesText(api.createCardFromBase(id, "player")));
  });
  expect(texts).toEqual([
    "自分の講義室にいる「アグロ」とつく出席者1人を指名し、その攻撃力を+2する。その後、自分本体に2ダメージを与える。",
    "[超陽気]\nこのカードが相手本体を攻撃したとき、自分本体に1ダメージを与える。"
  ]);
  const ledger = fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8");
  for (const text of texts) expect(ledger).toContain(text.replace("[超陽気]\n", "超陽気を持つ。").replaceAll("\n", ""));
  await page.evaluate(() => {
    window.__chibattle.state.screen = "home";
    window.__chibattle.render();
  });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.23.17" }) });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("相手本体への攻撃ダメージを与える前に敗北");
});

for (const side of ["player", "opponent"]) {
  test(`${side}: アグロ散歩は攻撃力のみ永続強化してから自傷する`, async ({ page }) => {
    await setup(page, side);
    expect(await page.evaluate(side => {
      const api = window.__chibattle, own = api.state.players[side];
      const target = api.makeBoardCard(api.createCardFromBase("aggro_princess", side));
      const other = api.makeBoardCard(api.createCardFromBase("aggro_student", side));
      own.board.seats[0] = target; own.board.seats[1] = other;
      const item = api.createCardFromBase("aggro_walk", side); own.hand = [item];
      const ok = api.castItemOnCard(side, item, side, "seat", 0, false);
      api.applyBoardAuras();
      api.state.actionTurn += 2;
      api.applyBoardAuras();
      return { ok, attack: target.attack, hp: target.currentHp, maxHp: target.maxHp,
        otherAttack: other.attack, life: own.life, will: own.will, hand: own.hand.length,
        trash: own.trash.map(c => c.baseId) };
    }, side)).toEqual({ ok: true, attack: 3, hp: 1, maxHp: 1, otherAttack: 1,
      life: 18, will: 8, hand: 0, trash: ["aggro_walk"] });
  });

  test(`${side}: 自傷で敗北する場合もアグロ散歩の強化・使用済み処理は完了する`, async ({ page }) => {
    await setup(page, side);
    expect(await page.evaluate(side => {
      const api = window.__chibattle, s = api.state, own = s.players[side];
      own.life = 2;
      const target = api.makeBoardCard(api.createCardFromBase("aggro_princess", side));
      own.board.seats[0] = target;
      const item = api.createCardFromBase("aggro_walk", side); own.hand = [item];
      api.castItemOnCard(side, item, side, "seat", 0, false);
      return { attack: target.attack, life: own.life, over: s.gameOver, winner: s.gameWinner,
        hand: own.hand.length, trash: own.trash.some(c => c.baseId === "aggro_walk") };
    }, side)).toEqual({ attack: 3, life: 0, over: true, winner: side === "player" ? "opponent" : "player", hand: 0, trash: true });
  });

  test(`${side}: AIは自傷で敗北する散歩とプリンセスの本体攻撃を選ばない`, async ({ page }) => {
    await setup(page, side);
    expect(await page.evaluate(async side => {
      const api = window.__chibattle, s = api.state, own = s.players[side];
      const target = api.makeBoardCard(api.createCardFromBase("aggro_princess", side));
      target.playedOnTurn = 0; own.board.seats[0] = target; own.life = 1;
      const item = api.createCardFromBase("aggro_walk", side);
      const score = side === "opponent" ? api.scoreAiItem(item) : api.scoreTrainingYocchanItem(side, item);
      own.will = 0;
      if (side === "opponent") await api.aiAttackWithReadyCards();
      else { s.training.leftController = "ai"; await api.runTrainingLeftAI(); }
      return { rejected: score <= 0, used: target.hasAttacked, life: own.life, over: s.gameOver };
    }, side)).toEqual({ rejected: true, used: false, life: 1, over: false });
  });
}

test("アグロでない出席者・相手のアグロは指名できず、対象なしでは使えない", async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(() => {
    const api = window.__chibattle, own = api.state.players.player;
    own.board.seats[0] = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    api.state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("aggro_princess", "opponent"));
    const item = api.createCardFromBase("aggro_walk", "player"); own.hand = [item];
    return { usable: api.canUseItemNow(item),
      normal: api.castItemOnCard("player", item, "player", "seat", 0, false),
      enemy: api.castItemOnCard("player", item, "opponent", "seat", 0, false),
      missing: api.castItemOnCard("player", item, "player", "seat", 1, false),
      life: own.life, will: own.will, hand: own.hand.length };
  })).toEqual({ usable: false, normal: false, enemy: false, missing: false, life: 20, will: 10, hand: 1 });
});

for (const life of [1, 2]) {
  test(`プリンセスは自分の気力${life}で本体攻撃したとき、自傷を先に処理する`, async ({ page }) => {
    await setup(page);
    await page.evaluate(life => {
      const api = window.__chibattle, s = api.state;
      s.players.player.life = life; s.players.opponent.life = 1;
      const card = api.makeBoardCard(api.createCardFromBase("aggro_princess", "player"));
      card.playedOnTurn = 0; s.players.player.board.seats[0] = card;
      s.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
      api.render();
      document.querySelector("#opponentLifeTarget").click();
    }, life);
    await expect.poll(() => page.evaluate(() => window.__chibattle.state.gameOver)).toBe(true);
    expect(await page.evaluate(() => {
      const s = window.__chibattle.state;
      return { life: s.players.player.life, enemyLife: s.players.opponent.life, winner: s.gameWinner };
    })).toEqual(life === 1 ? { life: 0, enemyLife: 1, winner: "opponent" }
      : { life: 1, enemyLife: 0, winner: "player" });
  });
}

test("プリンセスの出席者への攻撃では自傷しない", async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(async () => {
    const api = window.__chibattle, s = api.state;
    const card = api.makeBoardCard(api.createCardFromBase("aggro_princess", "player"));
    card.playedOnTurn = 0; s.players.player.board.seats[0] = card; s.players.player.life = 1;
    s.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("ae_student", "opponent"));
    s.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
    await api.attackCard("opponent", "seat", 0);
    return { life: s.players.player.life, used: card.hasAttacked, over: s.gameOver };
  })).toEqual({ life: 1, used: true, over: false });
});

test("相手本体へのダメージが無効でも、プリンセスの攻撃ごとに自傷する", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const api = window.__chibattle, s = api.state;
    const card = api.makeBoardCard(api.createCardFromBase("aggro_princess", "player"));
    card.playedOnTurn = 0; s.players.player.board.seats[0] = card;
    Object.assign(s.players.opponent, { lifeShieldUntilTurn: 8, lifeShieldUntilSide: "player" });
    s.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
    api.render();
    document.querySelector("#opponentLifeTarget").click();
  });
  await expect.poll(() => page.evaluate(() => window.__chibattle.state.players.player.life)).toBe(19);
  await page.evaluate(() => {
    const api = window.__chibattle, s = api.state;
    api.resetAttackFlags("player");
    s.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
    document.querySelector("#opponentLifeTarget").click();
  });
  await expect.poll(() => page.evaluate(() => window.__chibattle.state.players.player.life)).toBe(18);
  expect(await page.evaluate(() => window.__chibattle.state.players.opponent.life)).toBe(20);
});

for (const mode of ["enemyShield", "selfShield", "floorShield", "noEffects"]) {
  test(`プリンセスの本体攻撃: ${mode}も既存の効果に従う`, async ({ page }) => {
    await setup(page);
    expect(await page.evaluate(mode => {
      const api = window.__chibattle, s = api.state;
      const card = api.makeBoardCard(api.createCardFromBase("aggro_princess", "player"));
      card.playedOnTurn = 0; s.players.player.board.seats[0] = card; s.players.player.life = 1;
      if (mode === "selfShield") Object.assign(s.players.player, { lifeShieldUntilTurn: 8, lifeShieldUntilSide: "player" });
      if (mode === "enemyShield") Object.assign(s.players.opponent, { lifeShieldUntilTurn: 8, lifeShieldUntilSide: "player" });
      if (mode === "floorShield") s.players.player.lifeFloorShields = [{ untilActionTurn: 8, againstSide: "player" }];
      if (mode === "noEffects") card.generatedWithoutEffects = true;
      api.markCardAttackUsed(card, "opponent");
      return { life: s.players.player.life, over: s.gameOver, enemyLife: s.players.opponent.life,
        floor: s.players.player.lifeFloorShields.length };
    }, mode)).toEqual({ life: mode === "enemyShield" ? 0 : 1, over: mode === "enemyShield", enemyLife: 20, floor: 0 });
  });
}
