const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
});

test("2枚を共通カードとして登録し、確定したカードテキストを表示する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    return ["cornering_lecturer", "scary_question"].map((baseId) => {
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
      baseId: "cornering_lecturer",
      name: "ガン詰め講師",
      type: "teacher",
      cost: 4,
      attack: 2,
      hp: 3,
      category: "common",
      text: "このカードを手札から教卓マスに出席させたとき、次の中から1つを選ぶ。\n1. 自分のデッキに「怖い質問」10枚を生成する。\n2. 自分の手札にある「怖い質問」すべてをデッキに戻してシャッフルする。その後、戻した枚数と同じ回数、「怖い質問」の効果を発動する。\n指名できる相手の出席者がいない場合、相手本体を対象としてその効果を発動する。"
    },
    {
      baseId: "scary_question",
      name: "怖い質問",
      type: "item",
      cost: 1,
      attack: null,
      hp: null,
      category: "common",
      text: "相手の出席者1人をランダムに指名し、1ダメージを与える。その後、自分のデッキからカードを1枚引く。"
    }
  ]);
});

test("怖い質問は生成専用で、どのデッキ形式の編成欄にも表示しない", async ({ page }) => {
  expect(await page.evaluate(() => window.__chibattle.CARD_BASES.scary_question.generated)).toBe(true);
  await page.locator("#homeNavDeckButton").click();
  await page.locator("[data-case-view=\"library\"]").click();
  for (const [format, button] of [
    ["normal", "#normalDeckFormatButton"],
    ["specialty", "#specialtyDeckFormatButton"],
    ["chaos", "#chaosDeckFormatButton"]
  ]) {
    await page.locator(button).click();
    await page.locator("#deckLibraryGrid .new-deck").click();
    if (format === "specialty") await page.locator("#deckSpecialtyChoice button").first().click();
    await expect(page.locator("#deckEditorView")).toBeVisible();
    await expect(page.locator('#deckEditorList [data-card-test="scary_question"]')).toHaveCount(0);
    await page.locator("#deckEditorBackButton").click();
  }
});

test("古いJSONに怖い質問があってもデッキへ取り込まない", async ({ page }) => {
  await page.locator("#homeNavDeckButton").click();
  await page.locator("[data-case-view=\"library\"]").click();
  await page.locator("#chaosDeckFormatButton").click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  await page.locator("#deckFileInput").setInputFiles({
    name: "old-deck.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ counts: { general_student: 40, scary_question: 3 } }))
  });
  await expect.poll(() => page.evaluate(() => {
    const counts = window.__chibattle.state.deckBuilder.counts.player;
    return { studentCount: counts.general_student, hasQuestion: Object.hasOwn(counts, "scary_question") };
  })).toEqual({ studentCount: 40, hasQuestion: false });
});

test("ガン詰め講師のカードテストは初期手札に2枚用意し、専用デッキをドローカード中心にする", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("cornering_lecturer");
    const hand = api.state.players.player.hand.map((card) => card.baseId);
    const deck = api.state.players.player.deck.map((card) => card.baseId);
    const drawCardIds = new Set(["onigiri_draw", "sage_legacy", "wet_meal_ticket", "scary_question"]);
    return {
      hand,
      deckCount: deck.length,
      lecturerCount: deck.filter((baseId) => baseId === "cornering_lecturer").length,
      drawCardCount: deck.filter((baseId) => drawCardIds.has(baseId)).length,
      otherCards: deck.filter((baseId) => baseId !== "cornering_lecturer" && !drawCardIds.has(baseId))
    };
  });

  expect(result).toEqual({
    hand: ["cornering_lecturer", "cornering_lecturer"],
    deckCount: 45,
    lecturerCount: 1,
    drawCardCount: 44,
    otherCards: []
  });
});

test("ガン詰め講師の効果1は自分のデッキに怖い質問を10枚生成する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.actionTurn = 1;
    state.players.player.will = 4;
    state.players.player.deck = [];
    state.players.player.hand = [api.createCardFromBase("cornering_lecturer", "player")];
    state.players.player.board.teacher = null;
    const lecturer = state.players.player.hand[0];
    const played = api.placeCardFromHand("player", lecturer.instanceId, "teacher", "player", null, false, {
      corneringLecturerChoiceId: "generate"
    });
    return {
      played,
      teacher: state.players.player.board.teacher?.baseId || null,
      questions: state.players.player.deck.filter((card) => card.baseId === "scary_question").length,
      will: state.players.player.will
    };
  });

  expect(result).toEqual({ played: true, teacher: "cornering_lecturer", questions: 10, will: 0 });
});

test("効果2は最初に手札の怖い質問をすべてデッキへ戻し、その枚数だけ効果を発動する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.actionTurn = 1;
    state.players.player.will = 4;
    state.players.player.deck = [
      api.createCardFromBase("scary_question", "player"),
      api.createCardFromBase("general_student", "player"),
      api.createCardFromBase("general_teacher", "player")
    ];
    state.players.player.hand = [
      api.createCardFromBase("cornering_lecturer", "player"),
      api.createCardFromBase("scary_question", "player"),
      api.createCardFromBase("scary_question", "player"),
      api.createCardFromBase("scary_question", "player")
    ];
    state.players.player.trash = [];
    state.players.player.board.teacher = null;
    state.players.opponent.board.seats.fill(null);
    state.players.opponent.board.teacher = null;
    state.players.opponent.life = 20;
    state.players.opponent.board.seats[0] = api.makeBoardCard({
      ...api.createCardFromBase("general_student", "opponent"),
      hp: 1
    });
    const lecturer = state.players.player.hand[0];
    const played = api.placeCardFromHand("player", lecturer.instanceId, "teacher", "player", null, false, {
      corneringLecturerChoiceId: "activate"
    });
    return {
      played,
      opponentSeat: state.players.opponent.board.seats[0],
      opponentLife: state.players.opponent.life,
      handCount: state.players.player.hand.length,
      trashQuestions: state.players.player.trash.filter((card) => card.baseId === "scary_question").length,
      deckCount: state.players.player.deck.length,
      remainingQuestions: [...state.players.player.hand, ...state.players.player.deck]
        .filter((card) => card.baseId === "scary_question").length
    };
  });

  expect(result).toEqual({
    played: true,
    opponentSeat: null,
    opponentLife: 18,
    handCount: 3,
    trashQuestions: 0,
    deckCount: 3,
    remainingQuestions: 4
  });
});

test("通常の怖い質問は相手の出席者がいる場合だけ使え、1ダメージ後に1枚引く", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.actionTurn = 1;
    state.players.player.will = 1;
    state.players.player.deck = [api.createCardFromBase("general_student", "player")];
    state.players.player.hand = [api.createCardFromBase("scary_question", "player")];
    state.players.player.trash = [];
    state.players.opponent.board.seats.fill(null);
    state.players.opponent.board.teacher = null;
    const item = state.players.player.hand[0];
    const withoutTarget = api.canUseItemNow(item);
    state.players.opponent.board.seats[0] = api.makeBoardCard(api.createCardFromBase("strong_student", "opponent"));
    const withTarget = api.canUseItemNow(item);
    const used = api.castImmediateItem("player", item, false);
    return {
      withoutTarget,
      withTarget,
      used,
      targetHp: state.players.opponent.board.seats[0]?.currentHp || null,
      hand: state.players.player.hand.map((card) => card.baseId),
      trash: state.players.player.trash.map((card) => card.baseId),
      will: state.players.player.will
    };
  });

  expect(result).toEqual({
    withoutTarget: false,
    withTarget: true,
    used: true,
    targetHp: 6,
    hand: ["general_student"],
    trash: ["scary_question"],
    will: 0
  });
});

test("ver.0.23.6の更新情報へ2枚を統合する", async ({ page }) => {
  await page.evaluate(() => {
    window.__chibattle.state.screen = "home";
    window.__chibattle.render();
  });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry", { hasText: "2026年9月26日" }).first();
  await expect(entry.locator("summary")).toContainText("ver.0.23.6");
  await entry.locator("summary").click();
  const lecturerChange = entry.locator("strong", { hasText: /^ガン詰め講師$/ }).locator("..").locator("..");
  await expect(lecturerChange).toContainText("戻した枚数と同じ回数");
  const scaryQuestionChange = entry.locator("strong", { hasText: /^怖い質問$/ }).locator("..").locator("..");
  await expect(scaryQuestionChange).toContainText("その後、自分のデッキからカードを1枚引く");
});
