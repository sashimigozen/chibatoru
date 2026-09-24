const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const chenText = "このカードを手札から出席させたとき、相手の席マスにいる出席者1人をランダムに指名し、破壊する。環境が「食堂」であるかぎり、このカードの戦意を-2する。";
const highNoteText = "このカードを手札から出席させたとき、相手の出席者1人をランダムに指名し、その攻撃力を-2、体力を-1する。環境が「食堂」である場合、このカードの戦意を-3し、この効果の対象は相手の出席者すべてになる。";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("chen_san");
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
    api.state.environment = null;
    for (const side of ["player", "opponent"]) {
      api.state.players[side].board.seats = Array(9).fill(null);
      api.state.players[side].board.teacher = null;
    }
  });
});

test("2枚の表示テキストを手札からの出席時効果として揃える", async ({ page }) => {
  const texts = await page.evaluate(() => {
    const api = window.__chibattle;
    return {
      chen: api.cardRulesText(api.createCardFromBase("chen_san", "player")),
      highNote: api.cardRulesText(api.createCardFromBase("impossible_high_note", "player"))
    };
  });

  expect(texts).toEqual({
    chen: chenText.replace("。環境が", "。\n環境が"),
    highNote: highNoteText.replace("。環境が", "。\n環境が")
  });

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const rulesSource = fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8");
  const ledgerSource = fs.readFileSync(path.join(__dirname, "..", "カード管理台帳.html"), "utf8");
  for (const source of [indexSource, rulesSource, ledgerSource]) {
    expect(source).toContain(chenText);
    expect(source).toContain(highNoteText);
  }
});

test("陳さんの破壊効果は手札から出席させた場合だけ発動する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const target = () => api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    const chen = () => api.makeBoardCard(api.createCardFromBase("chen_san", "player"));

    state.players.opponent.board.seats[0] = target();
    api.attendCard("player", chen(), "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.GENERATED });
    const generatedKeptTarget = state.players.opponent.board.seats[0]?.baseId === "general_student";

    state.players.player.board.seats = Array(9).fill(null);
    state.players.opponent.board.seats = Array(9).fill(null);
    state.players.opponent.board.seats[0] = target();
    api.attendCard("player", chen(), "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const handDestroyedTarget = state.players.opponent.board.seats[0] === null;

    return { generatedKeptTarget, handDestroyedTarget };
  });

  expect(result).toEqual({ generatedKeptTarget: true, handDestroyedTarget: true });
});

test("ありえない高音は手札出席時だけ発動し、食堂では相手全員を弱体化する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const target = () => api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    const highNote = () => api.makeBoardCard(api.createCardFromBase("impossible_high_note", "player"));
    const targetStats = () => state.players.opponent.board.seats.slice(0, 2).map((card) => ({
      attack: card?.attack,
      hp: card?.currentHp
    }));

    state.players.opponent.board.seats[0] = target();
    state.players.opponent.board.seats[1] = target();
    api.attendCard("player", highNote(), "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.GENERATED });
    const generatedStats = targetStats();

    state.players.player.board.seats = Array(9).fill(null);
    state.players.opponent.board.seats = Array(9).fill(null);
    state.players.opponent.board.seats[0] = target();
    state.players.opponent.board.seats[1] = target();
    state.environment = api.createCardFromBase("cafeteria", "player");
    const discountedCost = api.effectiveCardCost(api.createCardFromBase("impossible_high_note", "player"));
    api.attendCard("player", highNote(), "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const cafeteriaStats = targetStats();

    return { generatedStats, cafeteriaStats, discountedCost };
  });

  expect(result).toEqual({
    generatedStats: [{ attack: 2, hp: 2 }, { attack: 2, hp: 2 }],
    cafeteriaStats: [{ attack: 0, hp: 1 }, { attack: 0, hp: 1 }],
    discountedCost: 5
  });
});
