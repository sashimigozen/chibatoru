const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const chigauyoText = "お互いの最大戦意がそれぞれ10の場合にのみ使用できる。お互いのプレイヤーは手札をすべてデッキに戻してシャッフルする。その後、それぞれデッキからカードを4枚引く。";
const chigauyoDisplay = chigauyoText.replace("使用できる。", "使用できる。\n");

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
});

test("ちがうよの本文をデッキからカードを引く表記に揃える", async ({ page }) => {
  const displayed = await page.evaluate(() => {
    const api = window.__chibattle;
    return api.cardRulesText(api.createCardFromBase("chigauyo", "player"));
  });
  expect(displayed).toBe(chigauyoDisplay);

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const rulesSource = fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8");
  const ledgerSource = fs.readFileSync(path.join(__dirname, "..", "カード管理台帳.html"), "utf8");
  for (const source of [indexSource, rulesSource, ledgerSource]) {
    expect(source).toContain(chigauyoText);
  }
});

test("デッキ詳細の本文・戦意表示と同日ver.0.23.12の更新情報を揃える", async ({ page }) => {
  const cards = [
    { id: "chigauyo", text: chigauyoDisplay, cost: "3", title: "ちがうよ" },
    { id: "annoying_na", cost: "5", title: "煩わしいなぁ",
      text: "自分のターン開始時にのみ使用できる。\nお互いのプレイヤーがそれぞれ1回ターンを終了するまで、お互いは出席時効果、持ち物カードの使用時効果、環境カードを環境マスに置いたときの効果を使用できない。" }
  ];
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  for (const card of cards) {
    await page.locator(`[data-card-test="${card.id}"]`).click();
    await expect(page.locator("#cardTestText .tooltip-effect")).toHaveText(`効果：${card.text}`);
    await expect(page.locator("#cardTestCard .card-header .stat-cost")).toHaveText(card.cost);
    await page.screenshot({ path: test.info().outputPath(`${card.id}-detail.png`) });
    await page.locator("#cardTestCancelButton").click();
  }
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry", { hasText: "2026年10月4日" });
  await expect(entry).toHaveCount(1);
  await expect(entry.locator("summary")).toContainText("ver.0.23.12");
  await entry.locator("summary").click();
  for (const card of cards) {
    await expect(entry.locator(".update-change", { hasText: card.title })).toContainText(card.text.replaceAll("\n", ""));
  }
});

test("ちがうよは両者の最大戦意が10のときだけ使え、残り戦意では判定しない", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    return ["player", "opponent"].flatMap((side) => [[9, 10], [10, 9], [11, 10], [10, 11], [10, 10]].map(([ownMax, otherMax]) => {
      api.startCardTest("chigauyo");
      const other = side === "player" ? "opponent" : "player";
      const own = api.state.players[side];
      const target = api.state.players[other];
      const item = api.createCardFromBase("chigauyo", side);
      own.maxWill = ownMax;
      target.maxWill = otherMax;
      own.will = 3;
      target.will = 0;
      own.hand = [item];
      const usable = side === "player" ? api.canUseHandCardNow(item) : ownMax === 10 && otherMax === 10;
      const before = JSON.stringify(api.state.players);
      if (side === "player" && (ownMax !== 10 || otherMax !== 10)) api.beginItemUse(item);
      const used = api.castImmediateItem(side, item, false);
      return { ownMax, otherMax, usable, used, will: own.will,
        unchanged: before === JSON.stringify(api.state.players),
        hands: [own.hand.length, target.hand.length] };
    }));
  });
  for (const result of results) {
    const allowed = result.ownMax === 10 && result.otherMax === 10;
    expect(result).toMatchObject({ usable: allowed, used: allowed, will: allowed ? 0 : 3, unchanged: !allowed });
    if (allowed) expect(result.hands).toEqual([4, 4]);
  }
});

test("ちがうよの最大戦意条件は効果封印中・通常AI・トレーニングAIでも有効", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    return [false, true].flatMap((suppressed) => [[9, 10], [10, 9], [10, 10]].map(([ownMax, otherMax]) => {
      api.startCardTest("chigauyo");
      const own = api.state.players.opponent;
      const other = api.state.players.player;
      own.maxWill = ownMax;
      other.maxWill = otherMax;
      own.will = 3;
      own.hand = [api.createCardFromBase("chigauyo", "opponent")];
      other.hand = Array.from({ length: 6 }, () => api.createCardFromBase("general_student", "player"));
      if (suppressed) own.effectUseLockTurnsRemaining = 1;
      const item = own.hand[0];
      const score = api.scoreAiItem(item);
      const trainingRejected = api.scoreTrainingYocchanItem("opponent", item) === -Infinity;
      const before = JSON.stringify(api.state.players);
      const used = suppressed ? api.useAiItem(item) : api.useTrainingYocchanItem("opponent", item);
      return { ownMax, otherMax, suppressed, score, trainingRejected, used,
        unchanged: before === JSON.stringify(api.state.players), will: own.will, otherHand: other.hand.length };
    }));
  });
  for (const result of results) {
    const allowed = result.ownMax === 10 && result.otherMax === 10;
    expect(result).toMatchObject({ used: allowed, unchanged: !allowed, will: allowed ? 0 : 3 });
    if (!allowed) expect(result).toMatchObject({ score: 0, trainingRejected: true });
    if (allowed && result.suppressed) expect(result.otherHand).toBe(6);
  }
});

test("ちがうよは両者の手札を戻してそれぞれ4枚引く", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("chigauyo");
    const state = api.state;
    state.phase = "battle";
    state.currentSide = "player";
    state.players.player.will = 10;
    const item = state.players.player.hand.find((card) => card.baseId === "chigauyo")
      || api.createCardFromBase("chigauyo", "player");
    state.players.player.hand = [item, api.createCardFromBase("general_student", "player")];
    state.players.opponent.hand = [api.createCardFromBase("general_teacher", "opponent")];
    state.players.player.deck = Array.from({ length: 8 }, () => api.createCardFromBase("strong_student", "player"));
    state.players.opponent.deck = Array.from({ length: 8 }, () => api.createCardFromBase("general_student", "opponent"));

    api.castImmediateItem("player", item);
    return {
      playerHand: state.players.player.hand.length,
      opponentHand: state.players.opponent.hand.length,
      playerDeck: state.players.player.deck.length,
      opponentDeck: state.players.opponent.deck.length,
      itemInTrash: state.players.player.trash.some((card) => card.baseId === "chigauyo")
    };
  });

  expect(result).toEqual({
    playerHand: 4,
    opponentHand: 4,
    playerDeck: 5,
    opponentDeck: 5,
    itemInTrash: true
  });
});

test("強靭な学生を共通カードの6戦意7/7として登録する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.createCardFromBase("strong_student", "player");
    return {
      name: card.name,
      type: card.type,
      cost: card.cost,
      attack: card.attack,
      hp: card.hp,
      zones: card.allowedZones,
      category: card.category,
      directDeck: api.specialtyAllowedCardIds("common").has("strong_student"),
      common: api.SPECIALTY_CARD_IDS.common.includes("strong_student"),
      text: api.cardRulesText(card)
    };
  });

  expect(result).toEqual({
    name: "強靭な学生",
    type: "student",
    cost: 6,
    attack: 7,
    hp: 7,
    zones: ["seat", "teacher"],
    category: "common",
    directDeck: true,
    common: true,
    text: "効果なし。"
  });
});

test("ver.0.23.6の更新情報に同日のカード変更を統合する", async ({ page }) => {
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.screen = "home";
    api.render();
  });
  await page.locator("#homeUpdatesButton").click();
  const entry = page.locator(".update-entry", { hasText: "2026年9月26日" }).first();
  await expect(entry.locator("summary")).toContainText("ver.0.23.6");
  await entry.locator("summary").click();
  await expect(entry.locator(".update-change", { hasText: "ちがうよ" })).toContainText("デッキからカードを4枚引く");
  await expect(entry.locator(".update-change", { hasText: "強靭な学生" })).toContainText("戦意6／攻撃力7／体力7");
});
