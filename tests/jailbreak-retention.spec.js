const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    startCardTest("general_student");
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.phase = "battle";
    state.actionTurn = 5;
    for (const side of ["player", "opponent"]) {
      Object.assign(state.players[side], { hand: [], deck: [], trash: [], late: [], will: 20, maxWill: 20,
        board: { seats: Array(9).fill(null), teacher: null }, life: 20 });
    }
  });
});

for (const side of ["player", "opponent"]) test(`次の使用だけ残し、再使用には戦意を払って校外へ送る ${side}`, async ({ page }) => {
  const result = await page.evaluate(side => {
    state.currentSide = side;
    const p = state.players[side];
    const jailbreak = createCardFromBase("jailbreak_tutuapp", side);
    const item = createCardFromBase("onigiri_draw", side);
    p.hand = [jailbreak, item];
    p.deck = Array.from({ length: 6 }, () => createCardFromBase("general_student", side));
    const used = castImmediateItem(side, jailbreak, false);
    const active = p.retainNextUsedItem;
    const snapshotActive = onlineCreateSnapshot().state.players[side].retainNextUsedItem;
    const willBefore = p.will;
    castImmediateItem(side, item, false);
    const first = { count: p.hand.filter(c => c.instanceId === item.instanceId).length,
      trash: p.trash.some(c => c.instanceId === item.instanceId), flag: p.retainNextUsedItem,
      cost: willBefore - p.will, drawn: p.hand.filter(c => c.baseId === "general_student").length };
    const beforeSecond = p.will;
    castImmediateItem(side, item, false);
    return { used, active, snapshotActive, first, second: { inHand: p.hand.includes(item),
      trash: p.trash.filter(c => c.instanceId === item.instanceId).length, cost: beforeSecond - p.will },
      printedCost: effectiveCardCost(item), sourceInTrash: p.trash.some(c => c.instanceId === jailbreak.instanceId) };
  }, side);
  expect(result.used).toBe(true);
  expect(result.active).toBe(true);
  expect(result.snapshotActive).toBe(true);
  expect(result.sourceInTrash).toBe(true);
  expect(result.first).toEqual({ count: 1, trash: false, flag: false, cost: result.printedCost, drawn: 2 });
  expect(result.second).toEqual({ inHand: false, trash: 1, cost: result.printedCost });
});

test("装備・効果による手札捨て・ターン終了では消費しない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = state.players.player;
    p.retainNextUsedItem = true;
    const target = makeBoardCard(createCardFromBase("general_student", "player"));
    p.board.seats[0] = target;
    const equipment = createCardFromBase("illness", "player");
    const discarded = createCardFromBase("hondara", "player");
    p.hand = [equipment, discarded];
    const equipped = castItemOnCard("player", equipment, "player", "seat", 0, false);
    moveHandCardToTrash("player", discarded, { effectDiscard: true });
    resolveEndTurnEffects("player");
    resolveEndTurnEffects("opponent");
    return { equipped, flag: p.retainNextUsedItem, handHasEquipment: p.hand.includes(equipment),
      illness: target.illnessEquipments?.length, discarded: p.trash.some(c => c.instanceId === discarded.instanceId) };
  });
  expect(result).toEqual({ equipped: true, flag: true, handHasEquipment: false, illness: 1, discarded: true });
});

test("対象不正・戦意不足では消費せず、対象確定後の使用だけ残す", async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = state.players.player;
    p.retainNextUsedItem = true;
    const target = makeBoardCard(createCardFromBase("general_student", "opponent"));
    state.players.opponent.board.seats[0] = target;
    const item = createCardFromBase("fire_touch", "player");
    p.hand = [item];
    const invalid = castItemOnCard("player", item, "opponent", "seat", 8, false);
    p.will = 0;
    const tooCheap = castItemOnCard("player", item, "opponent", "seat", 0, false);
    const flag = p.retainNextUsedItem;
    p.will = 20;
    castItemOnCard("player", item, "opponent", "seat", 0, false);
    return { invalid, tooCheap, flag, kept: p.hand.some(c => c.instanceId === item.instanceId), after: p.retainNextUsedItem };
  });
  expect(result).toEqual({ invalid: false, tooCheap: false, flag: true, kept: true, after: false });
});

test("2枚目のジェイルブレイクを残しても、次の使用権だけを新しく設定する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = state.players.player;
    const first = createCardFromBase("jailbreak_tutuapp", "player");
    const second = createCardFromBase("jailbreak_tutuapp", "player");
    p.hand = [first, second];
    castImmediateItem("player", first, false);
    castImmediateItem("player", second, false);
    return { flag: p.retainNextUsedItem, hand: p.hand.map(c => c.instanceId), trash: p.trash.map(c => c.instanceId),
      first: first.instanceId, second: second.instanceId };
  });
  expect(result.flag).toBe(true);
  expect(result.hand).toEqual([result.second]);
  expect(result.trash).toEqual([result.first]);
});

test("本文・変化条件・初期値を維持し、幼き日の思い出は持ち物だけを手札に加える", async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = state.players.player;
    const memory = createCardFromBase("childhood_memory_tutuapp", "player");
    const search = createCardFromBase("hondara", "player");
    p.deck = [createCardFromBase("general_student", "player"), search];
    p.hand = [memory];
    const rules = cardRulesText(memory);
    resolveHandTurnEffects("player"); resolveHandTurnEffects("player");
    const before = p.hand[0].baseId;
    resolveHandTurnEffects("player");
    const transformed = p.hand[0].baseId;
    p.hand = [memory];
    castImmediateItem("player", memory, false);
    return { rules, before, transformed, found: p.hand.some(c => c.instanceId === search.instanceId),
      deck: p.deck.map(c => c.baseId), jailbreakRules: cardRulesText(createCardFromBase("jailbreak_tutuapp", "player")) };
  });
  expect(result.rules).toBe("自分のデッキから持ち物カード1枚をランダムに手札に加える。\nこのカードが手札にある状態で自分のターン開始を3回迎えたとき、このカードを「ジェイルブレイクソフト-⚪︎u⚪︎uApp」にする。");
  expect(result.jailbreakRules).toBe("次に自分が使用する持ち物カードは、使用後に校外エリアへ送られず、手札に残る。");
  expect(result.before).toBe("childhood_memory_tutuapp");
  expect(result.transformed).toBe("jailbreak_tutuapp");
  expect(result.found).toBe(true);
  expect(result.deck).toEqual(["general_student"]);
});

test("通常演出でも校外ではなく手札に向かい、演出完了後に1回だけ効果が出る", async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => {
    state.training.skipAnimations = false;
    state.players.player.retainNextUsedItem = true;
    window.retained = createCardFromBase("onigiri_draw", "player");
    state.players.player.hand = [window.retained];
    state.players.player.deck = Array.from({ length: 4 }, () => createCardFromBase("general_student", "player"));
    render();
    castImmediateItem("player", window.retained, true);
  });
  await expect(page.locator("#playRevealCard")).toHaveClass(/to-hand/);
  expect(await page.evaluate(() => state.players.player.deck.length)).toBe(4);
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => ({ deck: state.players.player.deck.length,
    hand: state.players.player.hand.filter(c => c.instanceId === window.retained.instanceId).length,
    trash: state.players.player.trash.length }))).toEqual({ deck: 2, hand: 1, trash: 0 });
});

test("オンラインのゲスト使用コマンドと継続効果表示に反映し、再送で二重使用しない", async ({ page }) => {
  const result = await page.evaluate(async () => {
    state.currentSide = "opponent";
    state.online.role = "host";
    state.online.started = true;
    state.online.connected = true;
    onlineSend = () => true;
    battlePresentationBusy = () => false;
    const p = state.players.opponent;
    const jailbreak = createCardFromBase("jailbreak_tutuapp", "opponent");
    const item = createCardFromBase("onigiri_draw", "opponent");
    p.hand = [jailbreak, item];
    p.deck = Array.from({ length: 6 }, () => createCardFromBase("general_student", "opponent"));
    await onlineApplyRemoteCommand({ id: "retain-enable", type: "itemImmediate", payload: { instanceId: jailbreak.instanceId } });
    const activeText = playerActiveEffectLines("opponent").join("\n");
    const command = { id: "retain-use", type: "itemImmediate", payload: { instanceId: item.instanceId } };
    await onlineApplyRemoteCommand(command);
    await onlineApplyRemoteCommand(command);
    return { activeText, count: p.hand.filter(c => c.instanceId === item.instanceId).length,
      deck: p.deck.length, trash: p.trash.filter(c => c.instanceId === item.instanceId).length,
      flag: onlineCreateSnapshot().state.players.opponent.retainNextUsedItem };
  });
  expect(result.activeText).toContain("次に自分が使用する持ち物カード");
  expect(result).toMatchObject({ count: 1, deck: 4, trash: 0, flag: false });
});

test("AIも出席者選択を開かず新効果を使う", async ({ page }) => {
  const result = await page.evaluate(() => {
    state.currentSide = "opponent";
    const p = state.players.opponent;
    const jailbreak = createCardFromBase("jailbreak_tutuapp", "opponent");
    const item = createCardFromBase("onigiri_draw", "opponent");
    p.hand = [jailbreak, item];
    const score = baseScoreAiItem(jailbreak);
    const used = useAiItem(jailbreak);
    return { score, used, flag: p.retainNextUsedItem, pending: state.pendingCardChoice,
      afterScore: baseScoreAiItem(jailbreak) };
  });
  expect(result.score).toBeGreaterThan(0);
  expect(result).toMatchObject({ used: true, flag: true, pending: null, afterScore: 0 });
});
