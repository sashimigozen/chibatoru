const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const thinText = "このカードの使用コストは、相手の手札の枚数から4を引いた値になる。最低4。相手は手札が4枚になるように残すカードを選ぶ。選ばなかったカードをデッキに戻してシャッフルする。";
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
  await page.locator("[data-case-view=\"library\"]").click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  await page.locator('[data-card-test="thin_item"]').click();
  await page.locator('#caseEditorTest').click();
  await expect(page.locator("#cardTestText .tooltip-effect")).toHaveText(`効果：${displayText}`);
  await page.screenshot({ path: test.info().outputPath("thin-item-detail.png") });
});

test("双方の動的戦意は相手の手札が8枚以下なら4、9枚以上なら手札枚数から4を引く", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    const results = [];
    for (const side of ["player", "opponent"]) {
      for (const count of [0, 3, 4, 7, 8, 9, 10, 11]) {
        api.startCardTest("thin_item");
        const targetSide = side === "player" ? "opponent" : "player";
        const item = api.createCardFromBase("thin_item", side);
        api.state.players[side].hand = [item];
        api.state.players[targetSide].hand = Array.from({ length: count }, () => api.createCardFromBase("general_student", targetSide));
        const cost = api.effectiveCardCost(item);
        item.handLoadLevel = 2;
        results.push({ side, count, cost, highLoadCost: api.effectiveCardCost(item) });
      }
    }
    return results;
  });
  for (const result of results) {
    expect(result.cost, JSON.stringify(result)).toBe(Math.max(4, result.count - 4));
    expect(result.highLoadCost, JSON.stringify(result)).toBe(result.cost + 1);
  }
});

test("双方とも戦意3では状態を変えず使用できず、戦意4で最低戦意を支払う", async ({ page }) => {
  const results = await page.evaluate(() => {
    const api = window.__chibattle;
    return ["player", "opponent"].map((side) => {
      api.startCardTest("thin_item");
      const targetSide = side === "player" ? "opponent" : "player";
      const item = api.createCardFromBase("thin_item", side);
      const own = api.state.players[side];
      const target = api.state.players[targetSide];
      own.hand = [item];
      target.hand = Array.from({ length: 8 }, () => api.createCardFromBase("general_student", targetSide));
      own.deck = [];
      target.deck = [];
      own.trash = [];
      target.trash = [];
      own.will = 3;
      const before = JSON.stringify({ own, target });
      const unusable = side === "player" ? !api.canUseHandCardNow(item) : true;
      const rejected = !api.castImmediateItem(side, item, false);
      const unchanged = before === JSON.stringify({ own, target });
      own.will = 4;
      const used = api.castImmediateItem(side, item, false);
      if (api.state.pendingCardChoice?.mode === "thin_item_keep") {
        api.state.pendingCardChoice.selectedIds = target.hand.slice(0, 4).map((card) => card.instanceId);
        api.confirmCardChoiceSelection();
      }
      return { unusable, rejected, unchanged, used, will: own.will, ownHand: own.hand.length,
        targetHand: target.hand.length, targetDeck: target.deck.length, itemInTrash: own.trash.includes(item) };
    });
  });
  expect(results).toEqual(Array.from({ length: 2 }, () => ({ unusable: true, rejected: true, unchanged: true,
    used: true, will: 0, ownHand: 0, targetHand: 4, targetDeck: 4, itemInTrash: true })));
});

test("相手の手札が10枚なら6戦意で使用でき、選んだ4枚を残す", async ({ page }) => {
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
      playerUsable: true, used: true, choiceOpened: side === "opponent", ownHand: 9, will: 4,
      targetHand: 4, targetDeck: 6, targetTrash: 0, itemInTrash: true, keptChosenCards: true
    });
  }
});

test("11枚以上でも双方の使用経路で使用できる", async ({ page }) => {
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
        let used;
        if (side === "player") {
          api.beginItemUse(item);
          used = own.trash.some((card) => card.instanceId === item.instanceId);
        } else {
          used = api.castImmediateItem(side, item, false);
        }
        results.push({ side, ownCount, targetCount, usable, used,
          unchanged: before === JSON.stringify({ own, target }), pending: Boolean(api.state.pendingCardChoice || api.state.pendingRemoteHandTrim) });
      }
    }
    return results;
  });
  for (const result of results) {
    expect(result, JSON.stringify(result)).toMatchObject({ used: true, unchanged: false });
    if (result.side === "player") expect(result.usable).toBe(true);
  }
});

test("使用時効果が封じられていても動的戦意を支払う", async ({ page }) => {
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
    { usable: true, used: true, will: 4, hand: 9, targetHand: 10 },
    { usable: true, used: true, will: 4, hand: 10, targetHand: 10 }
  ]);
});

test("通常AIとトレーニングAIも動的戦意を使う", async ({ page }) => {
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
  for (const [index, result] of results.entries()) {
    expect(result.score).toBeGreaterThan(0);
    expect(result.used).toBe(true);
    expect(result.remaining).toBe([10, 9, 9][index]);
  }
});
