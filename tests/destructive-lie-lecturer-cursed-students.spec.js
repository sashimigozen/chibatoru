const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
});

test("3枚を指定カテゴリ・能力・既存文体で登録する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    return ["destructive_lie", "leaving_on_time_lecturer", "cursed_students"].map((baseId) => {
      const card = api.createCardFromBase(baseId, "player");
      return {
        baseId,
        name: card.name,
        type: card.type,
        cost: card.cost,
        attack: card.attack ?? null,
        hp: card.hp ?? null,
        category: card.category,
        text: api.cardRulesText(card)
      };
    });
  });

  expect(result).toEqual([
    {
      baseId: "destructive_lie",
      name: "破壊させる嘘",
      type: "item",
      cost: 2,
      attack: null,
      hp: null,
      category: "big",
      text: "自分の講義室にいる出席者1人を指名し、破壊する。その後、自分のデッキからカードを2枚引く。"
    },
    {
      baseId: "leaving_on_time_lecturer",
      name: "定時帰りの講師",
      type: "teacher",
      cost: 4,
      attack: 1,
      hp: 8,
      category: "common",
      text: "[陽気]\nこのカードを出席させた後、自分が2回ターンを終了したとき、このカードを校外エリアへ送る。"
    },
    {
      baseId: "cursed_students",
      name: "呪われた学生たち",
      type: "student",
      cost: 3,
      attack: 0,
      hp: 0,
      category: "common",
      text: "このカードを手札から出席させたとき、自分の講義室の空いている席マスを3つ選ぶ。\nそれぞれに「アグロ大学生」1人を出席させる。"
    }
  ]);
});

test("破壊させる嘘は自分の出席者を破壊した後に2枚引く", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.actionTurn = 1;
    state.players.player.will = 2;
    state.players.player.hand = [api.createCardFromBase("destructive_lie", "player")];
    state.players.player.deck = [
      api.createCardFromBase("general_student", "player"),
      api.createCardFromBase("general_teacher", "player")
    ];
    state.players.player.trash = [];
    state.players.player.board.seats.fill(null);
    state.players.player.board.teacher = null;
    state.players.player.board.seats[0] = api.makeBoardCard(api.createCardFromBase("strong_student", "player"));

    const item = state.players.player.hand[0];
    const used = api.castItemOnCard("player", item, "player", "seat", 0, false);
    return {
      used,
      will: state.players.player.will,
      seat: state.players.player.board.seats[0],
      hand: state.players.player.hand.map((card) => card.baseId).sort(),
      trash: state.players.player.trash.map((card) => card.baseId).sort()
    };
  });

  expect(result).toEqual({
    used: true,
    will: 0,
    seat: null,
    hand: ["general_student", "general_teacher"],
    trash: ["destructive_lie", "strong_student"]
  });
});

test("定時帰りの講師は自分がターンを2回終了した時点で校外へ送られる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.actionTurn = 1;
    state.players.player.board.seats.fill(null);
    state.players.player.board.teacher = null;
    state.players.player.trash = [];
    const lecturer = api.makeBoardCard(api.createCardFromBase("leaving_on_time_lecturer", "player"));
    api.attendCard("player", lecturer, "teacher", null, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });

    api.resolveEndTurnEffects("opponent");
    const afterOpponentTurn = lecturer.ownerTurnsUntilLeave;
    api.resolveEndTurnEffects("player");
    const afterFirstOwnTurn = {
      remaining: lecturer.ownerTurnsUntilLeave,
      onBoard: state.players.player.board.teacher?.baseId || null
    };
    api.resolveEndTurnEffects("opponent");
    api.resolveEndTurnEffects("player");
    return {
      afterOpponentTurn,
      afterFirstOwnTurn,
      afterSecondOwnTurn: state.players.player.board.teacher?.baseId || null,
      trash: state.players.player.trash.map((card) => card.baseId)
    };
  });

  expect(result).toEqual({
    afterOpponentTurn: 2,
    afterFirstOwnTurn: { remaining: 1, onBoard: "leaving_on_time_lecturer" },
    afterSecondOwnTurn: null,
    trash: ["leaving_on_time_lecturer"]
  });
});

test("呪われた学生たちは空き席をちょうど3つ選べる場合だけ出席できる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.actionTurn = 1;
    state.players.player.will = 3;
    state.players.player.board.teacher = null;
    state.players.player.board.seats.fill(null);
    for (let index = 0; index < 6; index += 1) {
      state.players.player.board.seats[index] = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    }
    const cursed = api.createCardFromBase("cursed_students", "player");
    state.players.player.hand = [cursed];
    const canUseWithThree = api.canPlaceCard("player", cursed, "teacher", "player", null);
    state.players.player.board.seats[6] = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    const canUseWithTwo = api.canPlaceCard("player", cursed, "teacher", "player", null);
    state.players.player.board.seats[6] = null;

    const played = api.placeCardFromHand
      ? api.placeCardFromHand("player", cursed.instanceId, "teacher", "player", null, false)
      : false;
    const selectedSeats = [6, 7, 8];
    const pendingSequence = [];
    selectedSeats.forEach((index) => {
      pendingSequence.push(api.state.pendingCopiedCard?.baseId || null);
      api.placePendingCopiedCardForSide("player", "seat", "player", index);
    });
    return {
      canUseWithThree,
      canUseWithTwo,
      played,
      pendingSequence,
      summoned: selectedSeats.map((index) => state.players.player.board.seats[index]?.baseId || null),
      pendingAfter: state.pendingCopiedCard,
      cursedInTrash: state.players.player.trash.some((card) => card.baseId === "cursed_students")
    };
  });

  expect(result).toEqual({
    canUseWithThree: true,
    canUseWithTwo: false,
    played: true,
    pendingSequence: ["aggro_student", "aggro_student", "aggro_student"],
    summoned: ["aggro_student", "aggro_student", "aggro_student"],
    pendingAfter: null,
    cursedInTrash: true
  });
});

test("CPUは呪われた学生たちのアグロ大学生3人を席マスへ出席させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "opponent";
    state.actionTurn = 2;
    state.players.opponent.will = 3;
    state.players.opponent.board.teacher = null;
    state.players.opponent.board.seats.fill(null);
    for (let index = 0; index < 6; index += 1) {
      state.players.opponent.board.seats[index] = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    }
    const cursed = api.createCardFromBase("cursed_students", "opponent");
    state.players.opponent.hand = [cursed];

    const played = api.placeCardFromHand("opponent", cursed.instanceId, "teacher", "opponent", null, false);
    return {
      played,
      summoned: state.players.opponent.board.seats.filter((card) => card?.baseId === "aggro_student").length,
      teacher: state.players.opponent.board.teacher,
      pending: state.pendingCopiedCard
    };
  });

  expect(result).toEqual({ played: true, summoned: 3, teacher: null, pending: null });
});

test("ver.0.23.6の更新情報へ3枚を統合する", async ({ page }) => {
  await page.evaluate(() => {
    window.__chibattle.state.screen = "home";
    window.__chibattle.render();
  });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry", { hasText: "2026年9月26日" }).first();
  await expect(entry.locator("summary")).toContainText("ver.0.23.6");
  await entry.locator("summary").click();
  await expect(entry.locator(".update-change", { hasText: "破壊させる嘘" })).toBeVisible();
  await expect(entry.locator(".update-change", { hasText: "定時帰りの講師" })).toContainText("[陽気]");
  await expect(entry.locator(".update-change", { hasText: "呪われた学生たち" })).toContainText("空いている席マスを3つ選ぶ");
});
