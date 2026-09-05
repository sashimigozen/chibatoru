const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function setup(page, side = "player", actionTurn = 3) {
  await page.goto(gameUrl);
  await page.evaluate(({ side, actionTurn }) => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = side;
    state.firstSide = "player";
    state.gameOver = false;
    state.actionTurn = actionTurn;
    state.environment = null;
    state.effectFeedbackEvents = [];
    state.online.role = "host";
    state.online.started = true;
    state.online.connected = false;
    ["player", "opponent"].forEach((owner) => {
      const player = state.players[owner];
      player.board.seats = Array(9).fill(null);
      player.board.teacher = null;
      player.hand = [];
      player.trash = [];
      player.late = [];
      player.will = 2;
      player.maxWill = 2;
    });
    state.players[side].hand = [api.createCardFromBase("yabe", side)];
    api.render();
  }, { side, actionTurn });
}

for (const side of ["player", "opponent"]) {
  test(`やべー！！は${side}側から異なる2人に1ダメージを席順で与える`, async ({ page }) => {
    await setup(page, side);
    const result = await page.evaluate((side) => {
      const api = window.__chibattle;
      const { state } = api;
      const other = side === "player" ? "opponent" : "player";
      const teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", other));
      const student = api.makeBoardCard(api.createCardFromBase("general_student", other));
      state.players[other].board.teacher = teacher;
      state.players[other].board.seats[8] = student;
      api.render();
      const item = state.players[side].hand[0];
      const before = [teacher.currentHp, student.currentHp];
      const used = api.castImmediateItem(side, item, true);
      return {
        used, loss: [before[0] - teacher.currentHp, before[1] - student.currentHp],
        ids: [teacher.instanceId, student.instanceId],
        events: state.effectFeedbackEvents.filter((event) => event.target === "card"),
        will: state.players[side].will,
        trash: state.players[side].trash.map((card) => card.baseId),
        hand: state.players[side].hand.length
      };
    }, side);
    expect(result.used).toBe(true);
    expect(result.loss).toEqual([1, 1]);
    expect(result.events.map((event) => event.instanceId)).toEqual(result.ids);
    expect(result.events.every((event) => event.text === "-1")).toBe(true);
    expect(result.events[1].occurredAt + result.events[1].delayMs - result.events[0].occurredAt - result.events[0].delayMs).toBeGreaterThanOrEqual(90);
    expect(result.will).toBe(0);
    expect(result.trash).toContain("yabe");
    expect(result.hand).toBe(0);
  });
}

for (const [side, actionTurn] of [["opponent", 14], ["player", 15]]) {
  test(`やべー！！は後攻7ターン目以降、${side}側から異なる2人に2ダメージを席順で与える`, async ({ page }) => {
    await setup(page, side, actionTurn);
    const result = await page.evaluate((side) => {
      const api = window.__chibattle;
      const { state } = api;
      state.players.opponent.turnsTaken = 7;
      const other = side === "player" ? "opponent" : "player";
      const teacher = api.makeBoardCard(api.createCardFromBase("bird_a", other));
      const student = api.makeBoardCard(api.createCardFromBase("protein_drinker", other));
      state.players[other].board.teacher = teacher;
      state.players[other].board.seats[8] = student;
      api.render();
      const before = [teacher.currentHp, student.currentHp];
      const used = api.castImmediateItem(side, state.players[side].hand[0], true);
      return {
        used,
        loss: [before[0] - teacher.currentHp, before[1] - student.currentHp],
        ids: [teacher.instanceId, student.instanceId],
        events: state.effectFeedbackEvents.filter((event) => event.target === "card")
      };
    }, side);
    expect(result.used).toBe(true);
    expect(result.loss).toEqual([2, 2]);
    expect(result.events.map((event) => event.instanceId)).toEqual(result.ids);
    expect(result.events.every((event) => event.text === "-2")).toBe(true);
    expect(result.events[1].occurredAt + result.events[1].delayMs - result.events[0].occurredAt - result.events[0].delayMs).toBeGreaterThanOrEqual(90);
  });
}

test("やべー！！の強化は先攻7ターン目ではまだ始まらない", async ({ page }) => {
  await setup(page, "player", 13);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.players.player.turnsTaken = 7;
    state.players.opponent.turnsTaken = 6;
    const target = api.makeBoardCard(api.createCardFromBase("protein_drinker", "opponent"));
    state.players.opponent.board.seats[0] = target;
    api.render();
    const before = target.currentHp;
    const used = api.castImmediateItem("player", state.players.player.hand[0], true);
    return {
      used,
      damage: before - target.currentHp,
      feedback: state.effectFeedbackEvents.filter((event) => event.target === "card").map((event) => event.text)
    };
  });
  expect(result).toEqual({ used: true, damage: 1, feedback: ["-1"] });
});

test("やべー！！は1人なら1回だけ、0人なら戦意を消費せず使用不可", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const item = state.players.player.hand[0];
    const empty = { canUse: api.canUseItemNow(item), used: api.castImmediateItem("player", item, true), will: state.players.player.will };
    const target = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    target.currentHp = 1;
    state.players.opponent.board.seats[6] = target;
    api.render();
    const used = api.castImmediateItem("player", item, true);
    return { empty, used, hits: state.effectFeedbackEvents.filter((event) => event.kind === "damage").length, dead: state.players.opponent.trash.some((card) => card.instanceId === target.instanceId) };
  });
  expect(result).toEqual({ empty: { canUse: false, used: false, will: 2 }, used: true, hits: 1, dead: true });
});

test("やべー！！は対象を重複させず、抽選順ではなく教卓・席順にダメージを表示する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    [0, 4, 8].forEach((index) => {
      state.players.opponent.board.seats[index] = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    });
    api.render();
    const random = Math.random;
    Math.random = () => 0;
    try { api.castImmediateItem("player", state.players.player.hand[0], true); }
    finally { Math.random = random; }
    const cards = state.players.opponent.board.seats;
    return {
      hits: state.effectFeedbackEvents.filter((event) => event.kind === "damage").map((event) => cards.findIndex((card) => card?.instanceId === event.instanceId)),
      losses: cards.filter(Boolean).map((card) => 2 - card.currentHp)
    };
  });
  expect(result.hits).toHaveLength(2);
  expect(new Set(result.hits).size).toBe(2);
  expect(result.hits).toEqual([...result.hits].sort((a, b) => a - b));
  expect(result.losses.sort()).toEqual([0, 1, 1]);
});

test("既存の全体ダメージも防御を含め順次表示し、再描画後のカードに演出を付ける", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const teacher = api.makeBoardCard(api.createCardFromBase("president", "player"));
    [0, 4, 8].forEach((index) => {
      const target = api.makeBoardCard(api.createCardFromBase("vampire", "opponent"));
      if (index === 0) target.defense = 3;
      state.players.opponent.board.seats[index] = target;
    });
    api.render();
    api.resolveAttendEffects("player", teacher, "teacher", null, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    api.render();
    return { events: state.effectFeedbackEvents, lastId: state.players.opponent.board.seats[8].instanceId };
  });
  expect(result.events.map((event) => event.text)).toEqual(["防御", "-3", "-3"]);
  for (let i = 1; i < result.events.length; i++) {
    const prev = result.events[i - 1];
    const next = result.events[i];
    expect(next.occurredAt + next.delayMs - prev.occurredAt - prev.delayMs).toBeGreaterThanOrEqual(90);
  }
  await expect(page.locator(`[data-card-id="${result.lastId}"]`)).toHaveClass(/damage-impact/);
});

test("やべー！！をデッキ・専攻・カードテスト・更新情報へ登録する", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("yabe", "player");
    api.startCardTest("yabe");
    return {
      name: card.name, cost: card.cost, type: card.type, category: card.category,
      specialty: api.SPECIALTY_CARD_IDS.big.includes("yabe"),
      text: api.cardRulesText(card),
      inTestHand: api.state.players.player.hand.some((entry) => entry.baseId === "yabe"),
      targets: api.state.players.opponent.board.seats.filter(Boolean).length + Number(Boolean(api.state.players.opponent.board.teacher))
    };
  });
  expect(result).toMatchObject({ name: "やべー！！", cost: 2, type: "item", category: "big", specialty: true, inTestHand: true });
  expect(result.text).toBe("相手の講義室にいる出席者を2人までランダムに指名し、それぞれに1ダメージを与える。後攻7ターン目以降、1ダメージではなく2ダメージを与える。");
  expect(result.targets).toBeGreaterThanOrEqual(2);
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry").filter({ has: page.locator("summary", { hasText: "ver.0.22.2" }) });
  await entry.locator("summary").click();
  await expect(entry).toContainText("「やべー！！」\n持ち物／バカでかい型／戦意2");
  await expect(entry).toContainText("後攻7ターン目以降、1ダメージではなく2ダメージを与える。");
});
