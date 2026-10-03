const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const paiaText = "このカードを手札から席マスに出席させたとき、右隣の空いている席マスにこのカードのコピーを1人出席させる。環境が「食堂」であるかぎり、このカードの戦意を-2する。";
const obonText = "自分の校外エリアにヴァンパイアが5枚以上ある場合にのみ使用できる。自分の手札にあるヴァンパイアすべての戦意を-2する。";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("fifty_ninth_paia");
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
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
    }
  });
});

test("食堂の2枚を既存データとカード文に登録する", async ({ page }) => {
  const cards = await page.evaluate(() => {
    const api = window.__chibattle;
    return ["obon_mac", "fifty_ninth_paia"].map((baseId) => {
      const card = api.createCardFromBase(baseId, "player");
      return {
        baseId,
        name: card.name,
        type: card.type,
        cost: card.cost,
        attack: card.attack,
        hp: card.hp,
        category: card.category,
        rules: api.cardRulesText(card)
      };
    });
  });

  expect(cards).toEqual([
    {
      baseId: "obon_mac", name: "お盆mac", type: "item", cost: 4,
      attack: undefined, hp: undefined, category: "cafeteria",
      rules: "自分の校外エリアにヴァンパイアが5枚以上ある場合にのみ使用できる。\n自分の手札にあるヴァンパイアすべての戦意を-2する。"
    },
    {
      baseId: "fifty_ninth_paia", name: "59番パイア", type: "vampire", cost: 10,
      attack: 5, hp: 9, category: "cafeteria",
      rules: `[注目]\nこのカードを手札から席マスに出席させたとき、右隣の空いている席マスにこのカードのコピーを1人出席させる。\n環境が「食堂」であるかぎり、このカードの戦意を-2する。`
    }
  ]);

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const rulesSource = fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8");
  const ledgerSource = fs.readFileSync(path.join(__dirname, "..", "カード管理台帳.html"), "utf8");
  for (const source of [indexSource, rulesSource]) {
    expect(source).toContain(`fifty_ninth_paia: "${paiaText}"`);
    expect(source).toContain(`obon_mac: "${obonText}"`);
  }
  expect(ledgerSource).toContain('"id":"fifty_ninth_paia","name":"59番パイア"');
  expect(ledgerSource).toContain('"id":"obon_mac","name":"お盆mac"');
});

test("お盆macはヴァンパイア5枚以上が校外にいる場合だけ使用でき、手札のヴァンパイアだけ戦意を下げる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const item = api.createCardFromBase("obon_mac", "player");
    const vampire = api.createCardFromBase("apprentice_vampire", "player");
    vampire.cost = 1;
    const vampireTwo = api.createCardFromBase("fifty_ninth_paia", "player");
    const student = api.createCardFromBase("general_student", "player");
    const futureVampire = api.createCardFromBase("chen_san", "player");
    player.hand = [item, vampire, vampireTwo, student];
    player.trash = Array.from({ length: 4 }, () => api.createCardFromBase("chen_san", "player"));
    const blocked = {
      canUse: api.canUseHandCardNow(item),
      used: api.castImmediateItem("player", item, false),
      itemKept: player.hand.some((card) => card.instanceId === item.instanceId)
    };
    player.trash.push(api.createCardFromBase("vampire", "player"));
    const allowed = api.canUseHandCardNow(item);
    const used = api.castImmediateItem("player", item, false);
    player.hand.push(futureVampire);
    return {
      blocked,
      allowed,
      used,
      vampireCosts: [vampire.cost, vampireTwo.cost, futureVampire.cost],
      studentCost: student.cost,
      itemInTrash: player.trash.some((card) => card.instanceId === item.instanceId)
    };
  });

  expect(result).toEqual({
    blocked: { canUse: false, used: false, itemKept: true },
    allowed: true,
    used: true,
    vampireCosts: [0, 8, 7],
    studentCost: 2,
    itemInTrash: true
  });
});

test("59番パイアは手札から席に出たとき右隣にだけコピーし、教卓・行末・埋まった右隣では本体だけ出席する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const state = api.state;
    const makePaia = () => api.makeBoardCard(api.createCardFromBase("fifty_ninth_paia", "player"));
    const target = () => api.makeBoardCard(api.createCardFromBase("general_student", "player"));

    api.state.environment = api.createCardFromBase("cafeteria", "player");
    const cafeteriaCost = api.effectiveCardCost(api.createCardFromBase("fifty_ninth_paia", "player"));
    const original = makePaia();
    const handCopyTriggered = Boolean(api.attendCard("player", original, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND }));
    const adjacent = state.players.player.board.seats.slice(0, 3).map((card) => card?.baseId || null);

    state.players.player.board = { teacher: null, seats: Array(9).fill(null) };
    const rowEnd = makePaia();
    api.attendCard("player", rowEnd, "seat", 2, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    const noWrap = state.players.player.board.seats.map((card) => card?.baseId || null);

    state.players.player.board = { teacher: null, seats: Array(9).fill(null) };
    state.players.player.board.seats[1] = target();
    const blockedRight = makePaia();
    const blockedRightAttended = Boolean(api.attendCard("player", blockedRight, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND }));
    const occupiedRight = state.players.player.board.seats.slice(0, 3).map((card) => card?.baseId || null);

    state.players.player.board = { teacher: null, seats: Array(9).fill(null) };
    const teacher = makePaia();
    const teacherAttended = Boolean(api.attendCard("player", teacher, "teacher", null, { attendanceSource: api.ATTENDANCE_SOURCE.HAND }));
    const teacherOnly = {
      teacher: state.players.player.board.teacher?.baseId || null,
      seats: state.players.player.board.seats.filter(Boolean).length
    };

    state.players.player.board = { teacher: null, seats: Array(9).fill(null) };
    const generated = makePaia();
    api.attendCard("player", generated, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.GENERATED });
    const generatedOnly = state.players.player.board.seats.slice(0, 2).map((card) => card?.baseId || null);

    return { cafeteriaCost, handCopyTriggered, adjacent, noWrap, blockedRightAttended, occupiedRight,
      teacherAttended, teacherOnly, generatedOnly };
  });

  expect(result).toEqual({
    cafeteriaCost: 8,
    handCopyTriggered: true,
    adjacent: ["fifty_ninth_paia", "fifty_ninth_paia", null],
    noWrap: [null, null, "fifty_ninth_paia", null, null, null, null, null, null],
    blockedRightAttended: true,
    occupiedRight: ["fifty_ninth_paia", "general_student", null],
    teacherAttended: true,
    teacherOnly: { teacher: "fifty_ninth_paia", seats: 0 },
    generatedOnly: ["fifty_ninth_paia", null]
  });
});

test("AIはお盆macを使えない条件では保留し、手札のヴァンパイアがいると評価する", async ({ page }) => {
  const scores = await page.evaluate(() => {
    const api = window.__chibattle;
    const item = api.createCardFromBase("obon_mac", "opponent");
    const opponent = api.state.players.opponent;
    opponent.hand = [item, api.createCardFromBase("apprentice_vampire", "opponent")];
    opponent.trash = Array.from({ length: 4 }, () => api.createCardFromBase("chen_san", "opponent"));
    const belowThreshold = api.scoreAiItem(item);
    opponent.trash.push(api.createCardFromBase("vampire", "opponent"));
    const aboveThreshold = api.scoreAiItem(item);
    return { belowThreshold, aboveThreshold };
  });

  expect(scores.belowThreshold).toBe(0);
  expect(scores.aboveThreshold).toBeGreaterThan(0);
});
