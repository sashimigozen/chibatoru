const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
});

test("対象カードが手札になくても夏井先生の3種類の選択肢を表示する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("summer_teacher");
    const summer = api.state.players.player.hand.find((card) => card.baseId === "summer_teacher");
    const targetCardsInHand = api.state.players.player.hand
      .filter((card) => ["trendy_student", "kyoto_sound_i", "extra_people"].includes(card.baseId))
      .map((card) => card.baseId);

    const opened = api.placeCardFromHand("player", summer.instanceId, "seat", "player", 0, false);
    const choices = api.state.pendingCardChoice?.cards.map((card) => ({
      baseId: card.baseId,
      cost: api.effectiveCardCost(card),
      text: api.cardRulesText(card)
    })) || [];
    const trendyChoice = api.state.pendingCardChoice?.cards.find((card) => card.baseId === "trendy_student");
    if (trendyChoice) {
      api.state.pendingCardChoice.selectedIds = [trendyChoice.instanceId];
      api.confirmCardChoiceSelection();
    }
    return {
      opened,
      targetCardsInHand,
      choices,
      text: api.cardRulesText(summer),
      pendingGeneratedCard: api.state.pendingCopiedCard?.baseId || null,
      summerAttended: api.state.players.player.board.seats[0]?.baseId === "summer_teacher",
      handAfter: api.state.players.player.hand.map((card) => card.baseId)
    };
  });

  expect(result.opened).toBe(true);
  expect(result.targetCardsInHand).toEqual([]);
  expect(result.choices).toEqual([
    expect.objectContaining({ baseId: "trendy_student", cost: 4, text: expect.stringContaining("反撃を受けない") }),
    expect.objectContaining({ baseId: "kyoto_sound_i", cost: 6, text: expect.stringContaining("3ダメージ") }),
    expect.objectContaining({ baseId: "extra_people", cost: 9, text: expect.stringContaining("3人まで") })
  ]);
  expect(result.text).not.toContain("手札の「ミーハー学生」");
  expect(result.text).toContain("そのカードを生成して出席させる");
  expect(result.pendingGeneratedCard).toBe("trendy_student");
  expect(result.summerAttended).toBe(true);
  expect(result.handAfter).toEqual([]);
});

async function playSummerTeacherChoice(page, choiceBaseId, will) {
  return page.evaluate(async ({ choiceBaseId, will }) => {
    const api = window.__chibattle;
    api.startCardTest("summer_teacher");
    api.state.testMode = false;
    api.state.currentSide = "opponent";
    api.state.players.opponent.will = will;
    api.state.players.opponent.maxWill = Math.max(10, will);
    api.state.players.opponent.hand = [api.createCardFromBase("summer_teacher", "opponent")];
    api.state.players.opponent.board.seats = Array(9).fill(null);
    api.state.players.opponent.board.teacher = null;
    api.state.players.player.board.seats = Array(9).fill(null);
    api.state.players.player.board.teacher = null;

    const target = api.makeBoardCard(api.createCardFromBase("protein_drinker", "player"));
    api.state.players.player.board.seats[0] = target;

    const summer = api.state.players.opponent.hand[0];
    const played = api.placeCardFromHand("opponent", summer.instanceId, "seat", "opponent", 0, false, {
      summerTeacherChoiceBaseId: choiceBaseId
    });
    await api.waitForOrderedAttendance();

    const ownBoard = [
      ...api.state.players.opponent.board.seats.filter(Boolean),
      api.state.players.opponent.board.teacher
    ].filter(Boolean);
    const enemy = api.state.players.player.board.seats[0];
    return {
      played,
      will: api.state.players.opponent.will,
      hand: api.state.players.opponent.hand.map((card) => card.baseId),
      ownBoard: ownBoard.map((card) => ({
        baseId: card.baseId,
        attack: card.attack,
        hp: card.currentHp,
        cheerful: api.hasKeyword(card, "陽気"),
        noCounterAttack: Boolean(card.noCounterAttack)
      })),
      enemy: enemy ? { attack: enemy.attack, hp: enemy.currentHp } : null
    };
  }, { choiceBaseId, will });
}

test("ミーハー学生を手札から消費せず生成して出席させる", async ({ page }) => {
  const result = await playSummerTeacherChoice(page, "trendy_student", 10);
  const trendy = result.ownBoard.find((card) => card.baseId === "trendy_student");

  expect(result.played).toBe(true);
  expect(result.hand).toEqual([]);
  expect(result.will).toBe(6);
  expect(trendy).toMatchObject({ cheerful: true, noCounterAttack: true });
});

test("ネガティブトーカーは固有効果を重ねず夏井先生の3ダメージだけを処理する", async ({ page }) => {
  const result = await playSummerTeacherChoice(page, "kyoto_sound_i", 10);

  expect(result.played).toBe(true);
  expect(result.hand).toEqual([]);
  expect(result.will).toBe(4);
  expect(result.ownBoard.some((card) => card.baseId === "kyoto_sound_i")).toBe(true);
  expect(result.enemy).toEqual({ attack: 0, hp: 4 });
});

test("エキストラの皆さんは夏井先生の効果で強化済みトークンを3人だけ出席させる", async ({ page }) => {
  const result = await playSummerTeacherChoice(page, "extra_people", 10);
  const extras = result.ownBoard.filter((card) => card.baseId === "extra_student");

  expect(result.played).toBe(true);
  expect(result.hand).toEqual([]);
  expect(result.will).toBe(1);
  expect(result.ownBoard.some((card) => card.baseId === "extra_people")).toBe(true);
  expect(extras).toHaveLength(3);
  expect(extras.every((card) => card.attack === 2 && card.hp === 2)).toBe(true);
});
