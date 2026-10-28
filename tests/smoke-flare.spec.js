const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const catalog = require("../server/card-catalog.json");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const rules = "自分のデッキから1枚引く。この効果で引いたカードのコストを1減らす。ただし、1未満にはならない。";

async function prepareBattle(page) {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    startCardTest("smoke_flare");
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.environment = null;
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], {
        hand: [], deck: [], trash: [], board: { teacher: null, seats: Array(9).fill(null) },
        will: 10, maxWill: 10
      });
    }
  });
}

test("本文・3枚制限・エースぺ解除・サーバー登録・お知らせが一致する", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const card = createCardFromBase("smoke_flare", "player");
    return {
      cost: card.cost, text: cardRulesText(card).replaceAll("\n", ""), ace: isAceCard(card),
      limit: maxCopiesForCard(card.baseId), allowed: canAddAceCard({ smoke_flare: 2 }, card.baseId, 0),
      valid: hasValidAceCounts({ smoke_flare: 3 }, ALL_DECK_IDS, 0),
      aceIds: [...ACE_CARD_IDS].sort(), order: getDeckEditorIds(""),
      update: UPDATE_HISTORY[0].changes.find(change => change.title === card.name)
    };
  });
  expect(result).toMatchObject({ cost: 2, text: rules, ace: false, limit: 3, allowed: true, valid: true });
  expect(result.aceIds).toEqual([...catalog.aces].sort());
  expect(result.order).toEqual(catalog.deckOrder);
  expect(catalog.direct).toContain("smoke_flare");
  expect(catalog.specialties.big).toContain("smoke_flare");
  expect(catalog.aces).not.toContain("smoke_flare");
  expect(result.update.after).toBe("持ち物／バカでかい型／戦意2／攻撃力0／体力0／デッキ投入上限3枚\n" + rules);
  expect(result.update.before).toContain("自分の戦意最大値を+2する。");
  expect(result.update.beforeHighlights).toContain("エースぺ");
  expect(result.update.afterHighlights).toContain("デッキ投入上限3枚");
  expect(fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8")).toContain(`smoke_flare: "${rules}"`);
});

for (const side of ["player", "opponent"]) {
  test(`引いた1枚だけを軽減し、最大戦意は変えない ${side}`, async ({ page }) => {
    await prepareBattle(page);
    const result = await page.evaluate(side => {
      const own = state.players[side];
      const item = createCardFromBase("smoke_flare", side);
      const existing = createCardFromBase("general_teacher", side);
      const drawn = createCardFromBase("general_teacher", side);
      const next = createCardFromBase("general_teacher", side);
      own.maxWill = 3;
      own.will = 3;
      own.hand = [item, existing];
      own.deck = [drawn, next];
      castImmediateItem(side, item, false);
      return {
        maxWill: own.maxWill, will: own.will, hand: own.hand.map(card => effectiveCardCost(card)),
        deck: own.deck.map(card => effectiveCardCost(card)), trash: own.trash.map(card => card.baseId),
        snapshot: onlineTransformSnapshotForGuest(onlineCreateSnapshot().state).players[oppositeSide(side)].hand
          .find(card => card.instanceId === drawn.instanceId)?.smokeFlareCostReduction
      };
    }, side);
    expect(result).toEqual({ maxWill: 3, will: 1, hand: [3, 2], deck: [3], trash: ["smoke_flare"], snapshot: side === "opponent" ? 1 : undefined });
  });
}

test("0・1は増やさず、2以上だけを下限1で軽減する", async ({ page }) => {
  await prepareBattle(page);
  expect(await page.evaluate(() => {
    return [0, 1, 2, 3, 10].map(cost => {
      const own = state.players.player;
      own.will = 10;
      const item = createCardFromBase("smoke_flare", "player");
      const drawn = createCardFromBase("general_student", "player");
      drawn.cost = cost;
      own.hand = [item]; own.deck = [drawn];
      castImmediateItem("player", item, false);
      return effectiveCardCost(drawn);
    });
  })).toEqual([0, 1, 1, 2, 9]);
});

test("空の山札・ドロー禁止・使用時効果禁止では既存の手札を軽減しない", async ({ page }) => {
  await prepareBattle(page);
  expect(await page.evaluate(() => {
    return ["empty", "locked", "suppressed"].map(mode => {
      const own = state.players.player;
      const existing = createCardFromBase("general_teacher", "player");
      const next = createCardFromBase("general_student", "player");
      const item = createCardFromBase("smoke_flare", "player");
      own.will = 10; own.hand = [item, existing]; own.deck = mode === "empty" ? [] : [next];
      own.effectUseLockTurnsRemaining = mode === "suppressed" ? 1 : 0;
      state.deckToHandLocks = [];
      if (mode === "locked") addDeckToHandLock("opponent");
      castImmediateItem("player", item, false);
      return { hand: own.hand.map(card => effectiveCardCost(card)), deck: own.deck.length, will: own.will };
    });
  })).toEqual([
    { hand: [3], deck: 0, will: 8 },
    { hand: [3], deck: 1, will: 8 },
    { hand: [3], deck: 1, will: 8 }
  ]);
});

test("条件で変わるコスト・複数回の軽減・高負荷でも表示と支払額が一致する", async ({ page }) => {
  await prepareBattle(page);
  expect(await page.evaluate(() => {
    const own = state.players.player;
    const item = createCardFromBase("smoke_flare", "player");
    const target = createCardFromBase("hat_man", "player");
    own.hand = [item]; own.deck = [target];
    castImmediateItem("player", item, false);
    const costs = [effectiveCardCost(target)];
    [0, 3].forEach(index => { state.players.opponent.board.seats[index] = makeBoardCard(createCardFromBase("general_student", "opponent")); });
    costs.push(effectiveCardCost(target, "seat", 0), effectiveCardCost(target, "seat", 1));
    target.smokeFlareCostReduction += 1;
    costs.push(effectiveCardCost(target, "seat", 0));
    target.handLoadLevel = 2;
    costs.push(effectiveCardCost(target, "seat", 0));
    own.will = 10;
    const used = placeCardFromHand("player", target.instanceId, "seat", "player", 0, false);
    return { costs, used, will: own.will };
  })).toEqual({ costs: [4, 1, 4, 1, 1], used: true, will: 9 });
});

test("AIは山札・ドロー禁止を考慮し最大戦意10でも利用を評価する", async ({ page }) => {
  await prepareBattle(page);
  expect(await page.evaluate(() => {
    const item = createCardFromBase("smoke_flare", "opponent");
    const own = state.players.opponent;
    own.hand = [item];
    const empty = planAiUtilityItem("opponent", item).score;
    own.deck = [createCardFromBase("general_student", "opponent")];
    const available = planAiUtilityItem("opponent", item).score;
    addDeckToHandLock("player");
    return [empty, available, planAiUtilityItem("opponent", item).score];
  })).toEqual([0, 4, 0]);
});

test("ゲストの使用コマンドと軽減後の出席コストをホストで解決し同期する", async ({ page: host, browser }) => {
  const guest = await browser.newPage();
  try {
    await prepareBattle(host);
    await prepareBattle(guest);
    for (const [page, role] of [[host, "host"], [guest, "guest"]]) {
      await page.evaluate(role => {
        Object.assign(state.online, { role, started: true, connected: true, conn: {} });
        window.outbox = [];
        onlineSend = message => { outbox.push(JSON.parse(JSON.stringify(message))); return true; };
      }, role);
    }
    await expect.poll(() => host.evaluate(() => battlePresentationBusy())).toBe(false);
    const snapshot = await host.evaluate(() => {
      state.currentSide = "opponent";
      state.players.opponent.hand = [createCardFromBase("smoke_flare", "opponent")];
      state.players.opponent.deck = [createCardFromBase("general_student", "opponent")];
      render();
      return onlineCreateSnapshot();
    });
    await guest.evaluate(snapshot => onlineHandleMessage({ type: "gameState", protocol: ONLINE_PROTOCOL_VERSION, snapshot }), snapshot);
    await expect.poll(() => guest.evaluate(() => battlePresentationBusy())).toBe(false);
    await guest.evaluate(() => beginItemUse(state.players.player.hand[0]));
    const useCommand = await guest.evaluate(() => outbox.find(message => message.command));
    expect(useCommand.command.type).toBe("itemImmediate");
    await host.evaluate(command => onlineHandleMessage({ ...command, type: "command", protocol: ONLINE_PROTOCOL_VERSION }), useCommand);
    await expect.poll(() => host.evaluate(() => state.players.opponent.hand[0]?.baseId)).toBe("general_student");
    await expect.poll(() => host.evaluate(() => battlePresentationBusy())).toBe(false);
    const afterUse = await host.evaluate(() => onlineCreateSnapshot());
    await guest.evaluate(snapshot => onlineHandleMessage({ type: "gameState", protocol: ONLINE_PROTOCOL_VERSION, snapshot }), afterUse);
    expect(await guest.evaluate(() => ({ cost: effectiveCardCost(state.players.player.hand[0]), will: state.players.player.will })))
      .toEqual({ cost: 1, will: 8 });
    await expect.poll(() => guest.evaluate(() => battlePresentationBusy())).toBe(false);
    await guest.evaluate(() => onlineSendCommand("playCard", { instanceId: state.players.player.hand[0].instanceId, zone: "seat", owner: "player", index: 0 }));
    const playCommand = await guest.evaluate(() => outbox.find(message => message.command?.type === "playCard"));
    expect(playCommand).toBeTruthy();
    await host.evaluate(command => onlineHandleMessage({ ...command, type: "command", protocol: ONLINE_PROTOCOL_VERSION }), playCommand);
    await expect.poll(() => host.evaluate(() => state.players.opponent.board.seats[0]?.baseId)).toBe("general_student");
    const afterPlay = await host.evaluate(() => onlineCreateSnapshot());
    await guest.evaluate(snapshot => onlineHandleMessage({ type: "gameState", protocol: ONLINE_PROTOCOL_VERSION, snapshot }), afterPlay);
    expect(await host.evaluate(() => state.players.opponent.will)).toBe(7);
    expect(await guest.evaluate(() => state.players.player.will)).toBe(7);
  } finally {
    await guest.close();
  }
});

test("カード一覧のテストから外部の状態変更なしで3枚を使い軽減と下限を確認できる", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator('[data-case-view="cards"]').click();
  await page.locator("#cardsCatalogSearch").fill("発煙筒");
  await page.locator('[data-catalog-card="smoke_flare"]').click();
  await expect(page.locator("#cardTestText")).toContainText("ただし、1未満にはならない。");
  await page.locator("#cardTestStartButton").click();
  const initial = await page.evaluate(() => ({ maxWill: state.players.player.maxWill, will: state.players.player.will }));
  for (const [baseId, expectedCost] of [["general_teacher", 2], ["general_student", 1], ["aggro_student", 1]]) {
    await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
    await page.evaluate(() => beginItemUse(state.players.player.hand.find(card => card.baseId === "smoke_flare")));
    await expect.poll(() => page.evaluate(baseId => {
      const card = state.players.player.hand.find(card => card.baseId === baseId);
      return card ? effectiveCardCost(card) : null;
    }, baseId)).toBe(expectedCost);
  }
  expect(await page.evaluate(() => ({ maxWill: state.players.player.maxWill, will: state.players.player.will })))
    .toEqual({ maxWill: initial.maxWill, will: initial.will - 6 });
  expect(errors).toEqual([]);
});
