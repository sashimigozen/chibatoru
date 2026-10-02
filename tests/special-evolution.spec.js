const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("single_cell");
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.gameOver = false;
    api.state.currentSide = "player";
    api.state.actionTurn = 5;
    api.state.environment = null;
    for (const side of ["player", "opponent"]) {
      const player = api.state.players[side];
      player.board = { teacher: null, seats: Array(9).fill(null) };
      player.hand = [];
      player.deck = [];
      player.trash = [];
      player.will = 20;
      player.maxWill = 20;
      player.life = 30;
      player.attendancesThisTurn = 0;
    }
  });
});

test("単細胞生物は先に出席した個体をミジンコへ特殊進化させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const first = api.makeBoardCard(api.createCardFromBase("single_cell", "player"));
    first.playedOnTurn = 1;
    first.baseMaxHp = 3;
    first.maxHp = 3;
    first.currentHp = 2;
    first.attacksUsedThisTurn = 1;
    first.hasAttacked = true;
    api.state.players.player.board.seats[0] = first;

    const enemy = api.makeBoardCard(api.createCardFromBase("strong_student", "opponent"));
    api.state.players.opponent.board.seats[0] = enemy;
    const second = api.makeBoardCard(api.createCardFromBase("single_cell", "player"));
    api.attendCard("player", second, "seat", 1, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });

    const evolved = api.state.players.player.board.seats[0];
    return {
      baseId: evolved?.baseId,
      sourceId: evolved?.evolvedFrom?.instanceId,
      expectedSourceId: first.instanceId,
      currentHp: evolved?.currentHp,
      maxHp: evolved?.maxHp,
      attacksUsed: api.cardAttacksUsedThisTurn(evolved),
      secondGone: api.state.players.player.board.seats[1] === null,
      enemyHp: enemy.currentHp,
      attendances: api.state.players.player.attendancesThisTurn,
      materialInTrash: api.state.players.player.trash.some((card) => card.instanceId === second.instanceId)
    };
  });

  expect(result).toEqual({
    baseId: "midge",
    sourceId: result.expectedSourceId,
    expectedSourceId: result.expectedSourceId,
    currentHp: 1,
    maxHp: 2,
    attacksUsed: 1,
    secondGone: true,
    enemyHp: 6,
    attendances: 1,
    materialInTrash: true
  });
});

test("特殊進化は連鎖し、ミジンコから生物への進化時効果も発動する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    for (let index = 0; index < 3; index += 1) {
      const cell = api.makeBoardCard(api.createCardFromBase("single_cell", "player"));
      cell.playedOnTurn = index + 1;
      api.state.players.player.board.seats[index] = cell;
    }
    const enemies = [0, 1].map((index) => {
      const enemy = api.makeBoardCard(api.createCardFromBase("strong_student", "opponent"));
      api.state.players.opponent.board.seats[index] = enemy;
      return enemy;
    });
    const fourth = api.makeBoardCard(api.createCardFromBase("single_cell", "player"));
    api.attendCard("player", fourth, "seat", 3, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });

    const organism = api.state.players.player.board.seats.find((card) => card?.baseId === "organism");
    return {
      baseId: organism?.baseId,
      evolutionChain: [organism?.evolvedFrom?.baseId, organism?.evolvedFrom?.evolvedFrom?.baseId],
      enemyHp: enemies.map((card) => card.currentHp),
      remainingSeats: api.state.players.player.board.seats.filter(Boolean).map((card) => card.baseId),
      attendances: api.state.players.player.attendancesThisTurn
    };
  });

  expect(result.baseId).toBe("organism");
  expect(result.evolutionChain).toEqual(["midge", "single_cell"]);
  expect(result.enemyHp.reduce((sum, hp) => sum + hp, 0)).toBe(8);
  expect(result.enemyHp.every((hp) => hp <= 5)).toBe(true);
  expect(result.remainingSeats).toEqual(["organism"]);
  expect(result.attendances).toBe(1);
});

test("生物を進化元にした完全変異体は素材だけを消費して進化時効果を発動する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const organism = api.makeBoardCard(api.createCardFromBase("organism", "player"));
    organism.playedOnTurn = 1;
    organism.currentHp = 5;
    organism.attacksUsedThisTurn = 1;
    organism.hasAttacked = true;
    api.state.players.player.board.seats[0] = organism;
    api.state.players.player.board.seats[1] = api.makeBoardCard(api.createCardFromBase("midge", "player"));
    api.state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("strong_student", "opponent"));
    api.state.players.opponent.board.seats[1] = api.makeBoardCard(api.createCardFromBase("general_teacher", "opponent"));

    const singleCell = api.makeBoardCard(api.createCardFromBase("single_cell", "player"));
    api.attendCard("player", singleCell, "seat", 2, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });

    const evolved = api.state.players.player.board.seats[0];
    return {
      baseId: evolved?.baseId,
      sourceId: evolved?.evolvedFrom?.instanceId,
      expectedSourceId: organism.instanceId,
      currentHp: evolved?.currentHp,
      attacksUsed: api.cardAttacksUsedThisTurn(evolved),
      materialsGone: api.state.players.player.board.seats[1] === null
        && api.state.players.player.board.seats[2] === null,
      enemiesGone: api.state.players.opponent.board.seats.every((card) => card === null)
        && api.state.players.opponent.board.teacher === null,
      attendances: api.state.players.player.attendancesThisTurn,
      singleCellInTrash: api.state.players.player.trash.some((card) => card.instanceId === singleCell.instanceId),
      midgeTokenInTrash: api.state.players.player.trash.some((card) => card.baseId === "midge")
    };
  });

  expect(result).toEqual({
    baseId: "perfect_mutant",
    sourceId: result.expectedSourceId,
    expectedSourceId: result.expectedSourceId,
    currentHp: 12,
    attacksUsed: 1,
    materialsGone: true,
    enemiesGone: true,
    attendances: 1,
    singleCellInTrash: true,
    midgeTokenInTrash: false
  });
});

test("病に臥すU太は新しい病を校外へ送り特殊進化する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const sick = api.makeBoardCard(api.createCardFromBase("sick_yuta", "player"));
    sick.playedOnTurn = 1;
    sick.currentHp = 3;
    sick.attacksUsedThisTurn = 1;
    sick.hasAttacked = true;
    api.state.players.player.board.seats[0] = sick;
    const enemy = api.makeBoardCard(api.createCardFromBase("strong_student", "opponent"));
    api.state.players.opponent.board.seats[0] = enemy;
    const illness = api.createCardFromBase("illness", "player");

    const equipped = api.equipIllness("player", sick, illness);
    const evolved = api.state.players.player.board.seats[0];
    return {
      equipped,
      baseId: evolved?.baseId,
      token: evolved?.token,
      sourceId: evolved?.evolvedFrom?.instanceId,
      expectedSourceId: sick.instanceId,
      currentHp: evolved?.currentHp,
      attacksUsed: api.cardAttacksUsedThisTurn(evolved),
      triggerIllnessInTrash: api.state.players.player.trash.some((card) => card.instanceId === illness.instanceId),
      enemyIllnesses: enemy.illnessEquipments?.length || 0,
      attendances: api.state.players.player.attendancesThisTurn
    };
  });

  expect(result).toEqual({
    equipped: true,
    baseId: "recovered_dark_yuta",
    token: true,
    sourceId: result.expectedSourceId,
    expectedSourceId: result.expectedSourceId,
    currentHp: 9,
    attacksUsed: 1,
    triggerIllnessInTrash: true,
    enemyIllnesses: 1,
    attendances: 0
  });
});

test("特殊進化カードはトークンとして進化元とカード文を持つ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const ids = ["midge", "organism", "perfect_mutant", "recovered_dark_yuta"];
    return {
      definitions: ids.map((id) => ({
        id,
        token: api.CARD_BASES[id].token,
        evolutionFrom: api.CARD_BASES[id].evolutionFrom,
        zones: api.CARD_BASES[id].allowedZones
      })),
      texts: ids.map((id) => api.cardRulesText(api.createCardFromBase(id, "player"))),
      sickText: api.cardRulesText(api.createCardFromBase("sick_yuta", "player"))
    };
  });

  expect(result.definitions).toEqual([
    { id: "midge", token: true, evolutionFrom: "single_cell", zones: ["evolution"] },
    { id: "organism", token: true, evolutionFrom: "midge", zones: ["evolution"] },
    { id: "perfect_mutant", token: true, evolutionFrom: "organism", zones: ["evolution"] },
    { id: "recovered_dark_yuta", token: true, evolutionFrom: "sick_yuta", zones: ["evolution"] }
  ]);
  expect(result.texts[0]).toContain("[進化]：「単細胞生物」");
  expect(result.texts[1]).toContain("[進化]：「ミジンコ」");
  expect(result.texts[2]).toContain("[進化]：「生物」");
  expect(result.texts[3]).toContain("[進化]：「病に臥すU太」");
  expect(result.sickText).toContain("その「病」を校外エリアへ送り");
  expect(result.sickText).toContain("[特殊進化]させる");
});

test("ver.0.23.9の更新情報に特殊進化の変更を統合して表示する", async ({ page }) => {
  await page.evaluate(() => {
    window.__chibattle.state.screen = "home";
    window.__chibattle.render();
  });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.23.9" }) });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("特殊進化");
  await expect(entry).toContainText("進化元が受けていたダメージと攻撃状態を引き継ぎ");
  await expect(entry).toContainText("その「病」を校外エリアへ送り");
});
