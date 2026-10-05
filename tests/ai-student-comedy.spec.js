const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page, side) {
  await page.goto(gameUrl);
  await page.evaluate((owner) => {
    const api = window.__chibattle;
    const { state } = api;
    state.preBattleToken += 1000;
    Object.assign(state, { screen: "battle", phase: "battle", currentSide: owner,
      actionTurn: 9, firstSide: "player", environment: null, gameOver: false });
    Object.assign(state.training, { active: true, leftController: "ai", skipAnimations: true });
    for (const current of ["player", "opponent"]) {
      Object.assign(state.players[current], { life: 20, will: 5, maxWill: 10,
        hand: [], deck: [], trash: [], late: [], turnsTaken: 5, originalDeckCounts: {},
        board: { teacher: null, seats: Array(9).fill(null) } });
    }
    state.players[owner].hand = [api.createCardFromBase("student_comedy", owner)];
    window.comedyTest = {
      owner, enemy: owner === "player" ? "opponent" : "player",
      move: () => owner === "player" ? api.findTrainingAiPlayMove(owner) : api.findAiPlayMove(),
      add: (index, options = {}, current = owner, base = "general_student") => {
        const card = api.makeBoardCard(api.createCardFromBase(base, current));
        Object.assign(card, { playedOnTurn: state.actionTurn }, options);
        state.players[current].board.seats[index] = card;
        return card;
      }
    };
  }, side);
}

for (const side of ["player", "opponent"]) {
  test(`${side}: 通常は2行2列から学生8人を強化し、評価では盤面を変更しない`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(() => {
      const api = window.__chibattle;
      const t = window.comedyTest;
      for (const index of [0, 1, 2, 3, 5, 6, 7, 8]) t.add(index);
      const before = JSON.stringify(api.state);
      const move = t.move();
      const unchanged = before === JSON.stringify(api.state);
      api.placeCardFromHand(t.owner, move.card.instanceId, "seat", t.owner, move.index, false);
      return { index: move.index, unchanged,
        buffed: api.state.players[t.owner].board.seats.filter((card) => card.baseId !== "student_comedy")
          .every((card) => card.attack === 3 && card.currentHp === 3) };
    });
    expect(result).toEqual({ index: 4, unchanged: true, buffed: true });
  });

  for (const lethal of [false, true]) {
    test(`${side}: ${lethal ? "リーサル" : "即時の大ダメージ"}を待機中の学生の人数より優先する`, async ({ page }) => {
      await setup(page, side);
      const result = await page.evaluate((finish) => {
        const api = window.__chibattle;
        const t = window.comedyTest;
        t.add(0, { playedOnTurn: 0, attack: 4, baseAttack: 4 });
        t.add(4, {}, t.owner, "general_teacher");
        for (const index of [3, 5, 6, 8]) t.add(index);
        api.state.players[t.enemy].life = finish ? 5 : 20;
        const move = t.move();
        return { index: move.index, score: api.scoreAiStudentComedyPlacement(t.owner, move.card, move.index).score };
      }, lethal);
      expect([1, 2]).toContain(result.index);
      if (lethal) expect(result.score).toBeGreaterThan(1200);
    });
  }

  test(`${side}: 強化で相手の高打点を倒しリーサルを回避する`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(() => {
      const api = window.__chibattle;
      const t = window.comedyTest;
      t.add(0, { playedOnTurn: 0, attack: 2, baseAttack: 2 });
      t.add(4, {}, t.owner, "general_teacher");
      for (const index of [3, 5, 6, 8]) t.add(index);
      t.add(4, { playedOnTurn: 0, attack: 10, baseAttack: 10, currentHp: 3, maxHp: 3 }, t.enemy);
      api.state.players[t.owner].life = 8;
      const move = t.move();
      const value = api.scoreAiStudentComedyPlacement(t.owner, move.card, move.index);
      api.placeCardFromHand(t.owner, move.card.instanceId, "seat", t.owner, move.index, false);
      const attacker = api.state.players[t.owner].board.seats[0];
      const target = t.owner === "player" ? api.findTrainingAiAttackTarget(t.owner, attacker) : api.findAiAttackTarget(attacker);
      return { index: move.index, score: value.score, target: target?.ref?.index ?? target?.index };
    });
    expect([1, 2]).toContain(result.index);
    expect(result.score).toBeGreaterThan(900);
    expect(result.target).toBe(4);
  });

  test(`${side}: 注目・攻撃済み・出席直後を即時打点と誤認しない`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(() => {
      const api = window.__chibattle;
      const t = window.comedyTest;
      const attacker = t.add(0, { attack: 4, baseAttack: 4 });
      t.add(4, {}, t.owner, "general_teacher");
      for (const index of [3, 5, 6, 8]) t.add(index);
      api.state.players[t.enemy].life = 5;
      const fresh = t.move().index;
      attacker.playedOnTurn = 0;
      api.markCardAttackUsed(attacker);
      const used = t.move().index;
      attacker.attacksUsedThisTurn = 0;
      attacker.hasAttacked = false;
      t.add(4, { keywords: ["注目"], currentHp: 100, maxHp: 100, attack: 0 }, t.enemy);
      const blocked = t.move().index;
      return { fresh, used, blocked };
    });
    expect(result).toEqual({ fresh: 7, used: 7, blocked: 7 });
  });

  test(`${side}: 教師やヴァンパイアをバフ対象と誤認せず、効果なしなら加点しない`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(() => {
      const api = window.__chibattle;
      const t = window.comedyTest;
      for (const index of [0, 1, 2, 3]) t.add(index, {}, t.owner, "general_teacher");
      for (const index of [5, 6, 7, 8]) t.add(index, {}, t.owner, "vampire");
      const comedy = api.state.players[t.owner].hand[0];
      const empty = api.scoreAiStudentComedyPlacement(t.owner, comedy, 4).score;
      comedy.generatedWithoutEffects = true;
      const inactive = api.scoreAiStudentComedyPlacement(t.owner, comedy, 4).score;
      comedy.generatedWithoutEffects = false;
      api.state.players[t.owner].effectUseLockTurnsRemaining = 1;
      const suppressed = api.scoreAiStudentComedyPlacement(t.owner, comedy, 4).score;
      return { empty, inactive, suppressed };
    });
    expect(result).toEqual({ empty: 3, inactive: 0, suppressed: 0 });
  });

  test(`${side}: バフを急ぐ必要がなければ戦意を残して学生を先に展開する`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(() => {
      const api = window.__chibattle;
      const t = window.comedyTest;
      t.add(0);
      api.state.players[t.owner].will = 7;
      api.state.players[t.owner].hand.push(api.createCardFromBase("general_student", t.owner));
      const first = t.move();
      api.placeCardFromHand(t.owner, first.card.instanceId, "seat", t.owner, first.index, false);
      const second = t.move();
      return { first: first.card.baseId, second: second.card.baseId, index: second.index,
        will: api.state.players[t.owner].will };
    });
    expect(result).toEqual({ first: "general_student", second: "student_comedy", index: 4, will: 5 });
  });

  test(`${side}: 実際のAI行動でも学生お笑いで強化して勝利する`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(async () => {
      const api = window.__chibattle;
      const t = window.comedyTest;
      t.add(0, { playedOnTurn: 0, attack: 4, baseAttack: 4 });
      api.state.players[t.enemy].life = 5;
      api.state.players[t.owner].will = 7;
      api.state.players[t.owner].hand.push(api.createCardFromBase("general_student", t.owner));
      const first = t.move().card.baseId;
      if (t.owner === "player") await api.runTrainingLeftAI();
      else await api.runOpponentAI();
      return { first, victory: api.state.gameOver, life: api.state.players[t.enemy].life,
        comedy: api.state.players[t.owner].board.seats.some((card) => card?.baseId === "student_comedy") };
    });
    expect(result.first).toBe("student_comedy");
    expect(result.victory).toBeTruthy();
    expect(result.life).toBeLessThanOrEqual(0);
    expect(result.comedy).toBe(true);
  });

  test(`${side}: 実行フローでも強化後に高打点の相手を倒して敗北を防ぐ`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate(async () => {
      const api = window.__chibattle;
      const t = window.comedyTest;
      t.add(0, { playedOnTurn: 0, attack: 2, baseAttack: 2 });
      t.add(4, {}, t.owner, "general_teacher");
      for (const index of [3, 5, 6, 8]) t.add(index);
      t.add(4, { playedOnTurn: 0, attack: 10, baseAttack: 10, currentHp: 3, maxHp: 3 }, t.enemy);
      api.state.players[t.owner].life = 8;
      for (const current of [t.owner, t.enemy]) {
        api.state.players[current].deck = Array.from({ length: 10 }, () => api.createCardFromBase("general_student", current));
      }
      if (t.owner === "player") await api.runTrainingLeftAI();
      else await api.runOpponentAI();
      return { life: api.state.players[t.owner].life, enemy: Boolean(api.state.players[t.enemy].board.seats[4]),
        alive: !api.state.gameOver };
    });
    expect(result).toEqual({ life: 8, enemy: false, alive: true });
  });
}
