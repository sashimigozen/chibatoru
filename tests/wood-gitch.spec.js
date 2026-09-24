const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const rawRules = "このカードを手札から出席させたとき、自分の手札1枚を選び、「木っち（ぎっち）」に変化させる。このカードは講義を持たない。";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("wood_gitch");
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
    api.state.players.player.board.teacher = null;
  });
});

test("木っち（ぎっち）の定義と表示本文を揃える", async ({ page }) => {
  const definition = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("wood_gitch", "player");
    return {
      cost: card.cost,
      attack: card.attack,
      hp: card.hp,
      noLecture: card.noLecture,
      rules: api.cardRulesText(card)
    };
  });

  expect(definition).toEqual({
    cost: 3,
    attack: 1,
    hp: 1,
    noLecture: true,
    rules: [
      "このカードを手札から出席させたとき、自分の手札1枚を選び、「木っち（ぎっち）」に変化させる。",
      "このカードは[講義]を持たない。"
    ].join("\n")
  });

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const rulesSource = fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8");
  expect(indexSource).toContain(`wood_gitch: "${rawRules}"`);
  expect(rulesSource).toContain(`wood_gitch: "${rawRules}"`);
});

test("出席後に手札1枚を選び、同じ位置で木っちへ変化させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const source = player.hand.find((card) => card.baseId === "wood_gitch");
    const target = player.hand.find((card) => card.instanceId !== source.instanceId);
    const targetId = target.instanceId;
    const trashBefore = player.trash.length;
    const placed = api.placeCardFromHand("player", source.instanceId, "teacher", "player", null, false);
    const pending = {
      mode: api.state.pendingCardChoice?.mode || null,
      cards: api.state.pendingCardChoice?.cards.map((card) => card.instanceId) || []
    };
    api.state.pendingCardChoice.selectedIds = [targetId];
    api.confirmCardChoiceSelection();
    return {
      placed,
      pending,
      hand: player.hand.map((card) => ({ baseId: card.baseId, instanceId: card.instanceId })),
      trashDelta: player.trash.length - trashBefore
    };
  });

  expect(result).toEqual({
    placed: true,
    pending: { mode: "wood_gitch_transform", cards: [result.hand[0].instanceId] },
    hand: [{ baseId: "wood_gitch", instanceId: result.hand[0].instanceId }],
    trashDelta: 0
  });
});

test("出席後に手札がなければ生成せず効果を終える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const source = player.hand.find((card) => card.baseId === "wood_gitch");
    player.hand = [source];
    const placed = api.placeCardFromHand("player", source.instanceId, "teacher", "player", null, false);
    return {
      placed,
      handCount: player.hand.length,
      pendingChoice: api.state.pendingCardChoice,
      log: api.state.log.join("\n")
    };
  });

  expect(result.placed).toBe(true);
  expect(result.handCount).toBe(0);
  expect(result.pendingChoice).toBeNull();
  expect(result.log).toContain("変化させる手札がありません");
});

test("CPUは価値の低い手札を木っちへ変化させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const opponent = api.state.players.opponent;
    api.state.currentSide = "opponent";
    opponent.board.teacher = null;
    const source = api.createCardFromBase("wood_gitch", "opponent");
    const weak = api.createCardFromBase("general_student", "opponent");
    const strong = api.createCardFromBase("green_curry", "opponent");
    opponent.hand = [source, weak, strong];
    const weakId = weak.instanceId;
    const placed = api.placeCardFromHand("opponent", source.instanceId, "teacher", "opponent", null, false);
    return {
      placed,
      hand: opponent.hand.map((card) => ({ baseId: card.baseId, instanceId: card.instanceId })),
      weakId
    };
  });

  expect(result.placed).toBe(true);
  expect(result.hand).toContainEqual({ baseId: "wood_gitch", instanceId: result.weakId });
  expect(result.hand.some((card) => card.baseId === "green_curry")).toBe(true);
});

test("オンラインで使用者が事前に選んだ手札を変化させる", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const opponent = api.state.players.opponent;
    api.state.currentSide = "opponent";
    opponent.board.teacher = null;
    const source = api.createCardFromBase("wood_gitch", "opponent");
    const target = api.createCardFromBase("general_student", "opponent");
    opponent.hand = [source, target];
    const targetId = target.instanceId;
    const placed = api.placeCardFromHand("opponent", source.instanceId, "teacher", "opponent", null, false, {
      woodGitchTransformId: targetId
    });
    return {
      placed,
      hand: opponent.hand.map((card) => ({ baseId: card.baseId, instanceId: card.instanceId }))
    };
  });

  expect(result).toEqual({
    placed: true,
    hand: [{ baseId: "wood_gitch", instanceId: result.hand[0].instanceId }]
  });
});

test("オンラインのゲストは出席送信前に変化対象を選ぶ", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const player = api.state.players.player;
    const source = player.hand.find((card) => card.baseId === "wood_gitch");
    const target = player.hand.find((card) => card.instanceId !== source.instanceId);
    const sent = [];
    api.state.online.role = "guest";
    api.state.online.connected = true;
    api.state.online.started = true;
    api.state.online.isApplyingRemote = false;
    api.state.online.clientId = "guest-test";
    api.state.online.conn = {
      open: true,
      send(message) {
        sent.push(message);
      }
    };

    api.playCard(source.instanceId, "teacher", "player", null);
    const choice = {
      mode: api.state.pendingCardChoice?.mode || null,
      cards: api.state.pendingCardChoice?.cards.map((card) => card.instanceId) || []
    };
    api.state.pendingCardChoice.selectedIds = [target.instanceId];
    api.confirmCardChoiceSelection();
    const command = sent.find((message) => message.command?.type === "playCard")?.command || null;
    return { choice, targetId: target.instanceId, payload: command?.payload || null };
  });

  expect(result.choice).toEqual({ mode: "wood_gitch_online_play", cards: [result.targetId] });
  expect(result.payload).toMatchObject({
    zone: "teacher",
    owner: "player",
    index: null,
    woodGitchTransformId: result.targetId
  });
});
