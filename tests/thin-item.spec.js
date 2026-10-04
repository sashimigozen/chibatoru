const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const thinText = "お互いの手札がそれぞれ10枚以下の場合にのみ使用できる。相手は手札が4枚になるように残すカードを選ぶ。選ばなかったカードをデッキに戻してシャッフルする。";
const displayText = thinText.replaceAll("。", "。\n").trim();

test.beforeEach(async ({ page }) => page.goto(gameUrl));

test("細いの本文・台帳・更新情報を合意した文面に揃え、カード詳細でも表示する", async ({ page }) => {
  for (const filename of ["index.html", "card_rules.txt", "カード管理台帳.html"]) {
    expect(fs.readFileSync(path.join(__dirname, "..", filename), "utf8")).toContain(thinText);
  }
  const setup = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("thin_item");
    const item = api.state.players.player.hand.find((card) => card.baseId === "thin_item");
    return { text: api.cardRulesText(item), cost: item.cost, usable: api.canUseHandCardNow(item) };
  });
  expect(setup).toEqual({ text: displayText, cost: 4, usable: true });
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  await page.locator('[data-card-test="thin_item"]').click();
  await expect(page.locator("#cardTestText .tooltip-effect")).toHaveText(`効果：${displayText}`);
  await page.screenshot({ path: test.info().outputPath("thin-item-detail.png") });
});

test("お互い10枚なら細い自身を含めて使用でき、相手が選んだ4枚を残す", async ({ page }) => {
  for (const side of ["player", "opponent"]) {
    const result = await page.evaluate((side) => {
      const api = window.__chibattle;
      api.startCardTest("thin_item");
      const targetSide = side === "player" ? "opponent" : "player";
      const own = api.state.players[side];
      const target = api.state.players[targetSide];
      const item = api.createCardFromBase("thin_item", side);
      own.hand = [item, ...Array.from({ length: 9 }, () => api.createCardFromBase("general_student", side))];
      target.hand = Array.from({ length: 10 }, () => api.createCardFromBase("general_student", targetSide));
      own.deck = [];
      target.deck = [];
      own.trash = [];
      target.trash = [];
      own.will = 10;
      const playerUsable = side === "player" ? api.canUseHandCardNow(item) : true;
      const used = api.castImmediateItem(side, item, false);
      const choiceOpened = api.state.pendingCardChoice?.mode === "thin_item_keep";
      const keepIds = target.hand.slice(0, 4).map((card) => card.instanceId);
      if (choiceOpened) {
        api.state.pendingCardChoice.selectedIds = keepIds;
        api.confirmCardChoiceSelection();
      }
      return {
        playerUsable, used, choiceOpened, ownHand: own.hand.length, will: own.will,
        targetHand: target.hand.length, targetDeck: target.deck.length,
        targetTrash: target.trash.length, itemInTrash: own.trash.some((card) => card.instanceId === item.instanceId),
        keptChosenCards: !choiceOpened || target.hand.every((card) => keepIds.includes(card.instanceId))
      };
    }, side);
    expect(result).toEqual({
      playerUsable: true, used: true, choiceOpened: side === "opponent", ownHand: 9, will: 6,
      targetHand: 4, targetDeck: 6, targetTrash: 0, itemInTrash: true, keptChosenCards: true
    });
  }
});

test("片方でも11枚以上なら双方の使用経路で戦意・手札・デッキを消費しない", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    const results = [];
    for (const side of ["player", "opponent"]) {
      for (const [ownCount, targetCount] of [[11, 10], [10, 11], [11, 11], [1, 11]]) {
        api.startCardTest("thin_item");
        const targetSide = side === "player" ? "opponent" : "player";
        const item = api.createCardFromBase("thin_item", side);
        const own = api.state.players[side];
        const target = api.state.players[targetSide];
        own.hand = [item, ...Array.from({ length: ownCount - 1 }, () => api.createCardFromBase("general_student", side))];
        target.hand = Array.from({ length: targetCount }, () => api.createCardFromBase("general_student", targetSide));
        own.will = 10;
        const before = JSON.stringify({ own, target });
        const usable = side === "player" ? api.canUseHandCardNow(item) : false;
        if (side === "player") api.beginItemUse(item);
        const used = api.castImmediateItem(side, item, false);
        results.push({ side, ownCount, targetCount, usable, used,
          unchanged: before === JSON.stringify({ own, target }), pending: Boolean(api.state.pendingCardChoice || api.state.pendingRemoteHandTrim) });
      }
    }
    return results;
  });
  for (const result of results) {
    expect(result, JSON.stringify(result)).toMatchObject({ usable: false, used: false, unchanged: true, pending: false });
  }
});

test("使用時効果が封じられていても手札枚数条件を無視できない", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    return [10, 11].map((count) => {
      api.startCardTest("thin_item");
      const item = api.createCardFromBase("thin_item", "player");
      const own = api.state.players.player;
      own.hand = [item, ...Array.from({ length: count - 1 }, () => api.createCardFromBase("general_student", "player"))];
      api.state.players.opponent.hand = Array.from({ length: 10 }, () => api.createCardFromBase("general_student", "opponent"));
      own.effectUseLockTurnsRemaining = 2;
      own.will = 10;
      const usable = api.canUseHandCardNow(item);
      const used = api.castImmediateItem("player", item, false);
      return { usable, used, will: own.will, hand: own.hand.length, targetHand: api.state.players.opponent.hand.length };
    });
  });
  expect(results).toEqual([
    { usable: true, used: true, will: 6, hand: 9, targetHand: 10 },
    { usable: false, used: false, will: 10, hand: 11, targetHand: 10 }
  ]);
});

test("通常AIとトレーニングAIも11枚以上では選ばず使用できない", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    return [[11, 10], [10, 11], [10, 10]].map(([ownCount, targetCount]) => {
      api.startCardTest("thin_item");
      const side = "opponent";
      const item = api.createCardFromBase("thin_item", side);
      const own = api.state.players[side];
      own.hand = [item, ...Array.from({ length: ownCount - 1 }, () => api.createCardFromBase("general_student", side))];
      api.state.players.player.hand = Array.from({ length: targetCount }, () => api.createCardFromBase("general_student", "player"));
      const score = api.scoreAiItem(item);
      const leftScore = api.scoreTrainingYocchanItem("player", api.createCardFromBase("thin_item", "player"));
      const used = ownCount > 10 ? api.useAiItem(item) : api.useTrainingYocchanItem(side, item);
      return { score, leftRejected: leftScore === -Infinity, used, remaining: own.hand.length };
    });
  });
  expect(results[0]).toEqual({ score: 0, leftRejected: true, used: false, remaining: 11 });
  expect(results[1]).toEqual({ score: 0, leftRejected: true, used: false, remaining: 10 });
  expect(results[2].score).toBeGreaterThan(0);
  expect(results[2].used).toBe(true);
  expect(results[2].remaining).toBe(9);
});
