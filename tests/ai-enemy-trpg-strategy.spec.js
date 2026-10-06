const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.preBattleToken += 1000;
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.actionTurn = 9;
    api.state.firstSide = "player";
    api.state.environment = null;
    api.state.gameOver = false;
    api.state.aiLethalForcedTargetId = null;
    api.state.dungeon.active = false;
    window.__aiEnemyTest = {
      reset(side) {
        api.state.currentSide = side;
        api.state.gameOver = false;
        for (const owner of ["player", "opponent"]) {
          Object.assign(api.state.players[owner], {
            life: 20,
            will: 10,
            maxWill: 10,
            hand: [],
            deck: [],
            trash: [],
            late: [],
            turnsTaken: 5,
            originalDeckCounts: {},
            board: { teacher: null, seats: Array(9).fill(null) }
          });
        }
      },
      put(baseId, owner, index = 0, changes = {}) {
        const card = api.makeBoardCard(api.createCardFromBase(baseId, owner));
        Object.assign(card, { playedOnTurn: 0 }, changes);
        if (changes.maxHp !== undefined && changes.baseMaxHp === undefined) card.baseMaxHp = changes.maxHp;
        if (index === null) api.state.players[owner].board.teacher = card;
        else api.state.players[owner].board.seats[index] = card;
        return card;
      },
      target(side, attacker) {
        return side === "opponent"
          ? api.findAiAttackTarget(attacker)
          : api.findTrainingAiAttackTarget(side, attacker);
      }
    };
  });
});

test("左右のCPUは敵の攻撃力+5を維持し、最後のTRPGを倒す代わりに本体を攻撃する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const fixture = window.__aiEnemyTest;
    return ["player", "opponent"].map((side) => {
      fixture.reset(side);
      const targetSide = side === "player" ? "opponent" : "player";
      const enemy = fixture.put("enemy_student", side);
      fixture.put("trpg_member", targetSide);
      api.applyBoardAuras();
      const target = fixture.target(side, enemy);
      api.state.selectedAttacker = { owner: side, zone: "seat", index: 0 };
      return {
        side,
        attack: enemy.attack,
        target: target?.index ?? null,
        faceAllowed: api.canSelectedAttackerTargetLife(targetSide)
      };
    });
  });
  expect(result).toEqual([
    { side: "player", attack: 6, target: null, faceAllowed: true },
    { side: "opponent", attack: 6, target: null, faceAllowed: true }
  ]);
});

test("注目のTRPGが本体攻撃を阻んでいる場合は、攻撃力+5を失っても処理する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const fixture = window.__aiEnemyTest;
    return ["player", "opponent"].map((side) => {
      fixture.reset(side);
      const targetSide = side === "player" ? "opponent" : "player";
      const enemy = fixture.put("enemy_student", side);
      fixture.put("trpg_member", targetSide, 3, { keywords: ["注目"] });
      api.applyBoardAuras();
      const target = fixture.target(side, enemy);
      return { side, target: target?.index ?? null };
    });
  });
  expect(result).toEqual([
    { side: "player", target: 3 },
    { side: "opponent", target: 3 }
  ]);
});

test("敵の攻撃力+5が有効なら、弱い学生を殴るより本体への6ダメージを優先する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const fixture = window.__aiEnemyTest;
    return ["player", "opponent"].map((side) => {
      fixture.reset(side);
      const targetSide = side === "player" ? "opponent" : "player";
      const enemy = fixture.put("enemy_student", side);
      fixture.put("trpg_member", targetSide);
      fixture.put("general_student", targetSide, 1, {
        attack: 1, baseAttack: 1, currentHp: 1, maxHp: 1
      });
      api.applyBoardAuras();
      const target = fixture.target(side, enemy);
      return { side, attack: enemy.attack, target: target?.index ?? null };
    });
  });
  expect(result).toEqual([
    { side: "player", attack: 6, target: null },
    { side: "opponent", attack: 6, target: null }
  ]);
});

test("TRPGが複数いる場合も本体を攻撃し、敵の攻撃力+5を維持する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const fixture = window.__aiEnemyTest;
    return ["player", "opponent"].map((side) => {
      fixture.reset(side);
      const targetSide = side === "player" ? "opponent" : "player";
      const enemy = fixture.put("enemy_student", side, 0, { currentHp: 10, maxHp: 10 });
      fixture.put("trpg_member", targetSide, 3, { attack: 9, baseAttack: 9 });
      fixture.put("trpg_member", targetSide, 4);
      api.applyBoardAuras();
      const target = fixture.target(side, enemy);
      return { side, attack: enemy.attack, target: target?.index ?? null };
    });
  });
  expect(result).toEqual([
    { side: "player", attack: 6, target: null },
    { side: "opponent", attack: 6, target: null }
  ]);
});

test("左右のCPUは最後のTRPGを講義で倒して敵の攻撃力を落とさない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const fixture = window.__aiEnemyTest;
    return ["player", "opponent"].map((side) => {
      fixture.reset(side);
      const targetSide = side === "player" ? "opponent" : "player";
      fixture.put("enemy_student", side);
      const teacher = fixture.put("general_teacher", side, null);
      fixture.put("trpg_member", targetSide, 0, { currentHp: 1 });
      api.applyBoardAuras();
      const ref = { owner: side, zone: "teacher", index: null };
      const single = api.shouldAiUseLecture(ref, teacher, side);
      const secondTrpg = fixture.put("trpg_member", targetSide, 1, { currentHp: 1 });
      const all = api.shouldAiUseLecture(ref, teacher, side);
      secondTrpg.currentHp = 2;
      return {
        side,
        single,
        all,
        oneOfTwo: api.shouldAiUseLecture(ref, teacher, side)
      };
    });
  });
  expect(result).toEqual([
    { side: "player", single: false, all: false, oneOfTwo: true },
    { side: "opponent", single: false, all: false, oneOfTwo: true }
  ]);
});

test("定規で最後のTRPGを倒せても、敵の攻撃力を保って本体へダメージを与える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const fixture = window.__aiEnemyTest;
    fixture.reset("opponent");
    const enemy = fixture.put("enemy_student", "opponent");
    fixture.put("trpg_member", "player", 0, { currentHp: 1 });
    api.applyBoardAuras();
    const ruler = api.createCardFromBase("ruler", "opponent");
    api.state.players.opponent.hand = [ruler];
    const used = api.useAiItem(ruler);
    return {
      used,
      targetRemains: api.state.players.player.board.seats[0]?.baseId,
      life: api.state.players.player.life,
      attack: enemy.attack
    };
  });
  expect(result).toEqual({ used: true, targetRemains: "trpg_member", life: 19, attack: 6 });
});

test("左右のCPUの確定破壊は、最後のTRPGより別の危険な出席者を優先する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const fixture = window.__aiEnemyTest;
    return ["player", "opponent"].map((side) => {
      fixture.reset(side);
      const targetSide = side === "player" ? "opponent" : "player";
      const enemy = fixture.put("enemy_student", side);
      fixture.put("trpg_member", targetSide, 0, { currentHp: 9, maxHp: 9 });
      fixture.put("general_student", targetSide, 1, { attack: 5, baseAttack: 5, currentHp: 2, maxHp: 2 });
      api.applyBoardAuras();
      const item = api.createCardFromBase("seriously_hit", side);
      api.state.players[side].hand = [item];
      const used = side === "opponent" ? api.useAiItem(item) : api.useTrainingYocchanItem(side, item);
      return {
        side,
        used,
        trpgRemains: Boolean(api.state.players[targetSide].board.seats[0]),
        dangerRemains: Boolean(api.state.players[targetSide].board.seats[1]),
        attack: enemy.attack
      };
    });
  });
  expect(result).toEqual([
    { side: "player", used: true, trpgRemains: true, dangerRemains: false, attack: 6 },
    { side: "opponent", used: true, trpgRemains: true, dangerRemains: false, attack: 6 }
  ]);
});

test("TRPGが次ターンの敗北原因になる場合は最後の1人でも処理する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const fixture = window.__aiEnemyTest;
    return ["player", "opponent"].map((side) => {
      fixture.reset(side);
      const targetSide = side === "player" ? "opponent" : "player";
      api.state.players[side].life = 8;
      const enemy = fixture.put("enemy_student", side, 0, { currentHp: 25, maxHp: 25 });
      fixture.put("trpg_member", targetSide, 2, { attack: 20, baseAttack: 20, currentHp: 1 });
      api.applyBoardAuras();
      const target = fixture.target(side, enemy);
      return { side, target: target?.index ?? null };
    });
  });
  expect(result).toEqual([
    { side: "player", target: 2 },
    { side: "opponent", target: 2 }
  ]);
});

test("キングギドラベッドはリーサルでなければ温存し、TRPGと敵の強化を維持する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const fixture = window.__aiEnemyTest;
    return ["player", "opponent"].map((side) => {
      fixture.reset(side);
      const targetSide = side === "player" ? "opponent" : "player";
      api.state.players[side].will = 7;
      const enemy = fixture.put("enemy_student", side);
      fixture.put("trpg_member", targetSide, 0, { currentHp: 1 });
      fixture.put("trpg_member", targetSide, 1, { currentHp: 1 });
      api.applyBoardAuras();
      const item = api.createCardFromBase("king_ghidorah_bed", side);
      api.state.players[side].hand = [item];
      const used = side === "opponent" ? api.useAiItem(item) : api.useTrainingYocchanItem(side, item);
      return {
        side,
        used,
        life: api.state.players[targetSide].life,
        trpgCount: api.state.players[targetSide].board.seats.filter((card) => card?.baseId === "trpg_member").length,
        attack: enemy.attack
      };
    });
  });
  expect(result).toEqual([
    { side: "player", used: false, life: 20, trpgCount: 2, attack: 6 },
    { side: "opponent", used: false, life: 20, trpgCount: 2, attack: 6 }
  ]);
});

test("手札の敵の出席評価にもTRPGによる攻撃力+5を織り込む", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const fixture = window.__aiEnemyTest;
    fixture.reset("opponent");
    const enemy = api.createCardFromBase("enemy_student", "opponent");
    api.state.players.opponent.hand = [enemy];
    const ordinary = api.scoreAiPlacement(enemy, "seat", 4);
    fixture.put("trpg_member", "player");
    api.applyBoardAuras();
    const boosted = api.scoreAiPlacement(enemy, "seat", 4);

    fixture.reset("player");
    fixture.put("trpg_member", "opponent");
    const leftEnemy = api.createCardFromBase("enemy_student", "player");
    const other = api.createCardFromBase("protein_drinker", "player");
    api.state.players.player.hand = [other, leftEnemy];
    const leftMove = api.findTrainingAiPlayMove("player");
    return { ordinary, boosted, leftMove: leftMove?.card.baseId };
  });
  expect(result.boosted).toBeGreaterThan(result.ordinary + 5);
  expect(result.leftMove).toBe("enemy_student");
});
