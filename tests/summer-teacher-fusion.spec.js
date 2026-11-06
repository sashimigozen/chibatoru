const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function settle(page) {
  await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
}

async function startSummer(page, throughCatalog = false) {
  await page.goto(gameUrl);
  if (throughCatalog) {
    await page.locator("#homeNavDeckButton").click();
    await page.locator('[data-case-view="cards"]').click();
    await page.locator("#cardsCatalogSearch").fill("夏井先生");
    await page.locator('[data-catalog-card="summer_teacher"]').click();
    await page.locator("#cardTestStartButton").click();
  } else {
    await page.evaluate(() => startCardTest("summer_teacher"));
  }
  await page.evaluate(() => { state.training.skipAnimations = true; });
  await settle(page);
}

test("カード一覧からテストを始め、指定された1枚だけを融合する", async ({ page }) => {
  await startSummer(page, true);
  expect(await page.evaluate(() => {
    const hand = state.players.player.hand;
    const summer = hand.find(card => card.baseId === "summer_teacher");
    const ruler = hand.find(card => card.baseId === "ruler");
    const before = placeCardFromHand("player", summer.instanceId, "seat", "player", 4, false);
    const wrong = fuseAnyHandCards("player", summer.instanceId, [ruler.instanceId], false);
    showBattleCardPreview(summer);
    return [before, wrong, hand.includes(summer), hand.includes(ruler)];
  })).toEqual([false, false, true, true]);
  await page.locator("[data-preview-any-hand-fusion]").click();
  expect(await page.evaluate(() => state.pendingCardChoice.cards.map(card => card.baseId).sort()))
    .toEqual(["extra_people", "kyoto_sound_i", "trendy_student"]);
  await page.evaluate(() => {
    toggleCardChoiceCard(state.pendingCardChoice.cards.find(card => card.baseId === "trendy_student").instanceId);
    confirmCardChoiceSelection();
  });
  await settle(page);
  expect(await page.evaluate(() => {
    const own = state.players.player;
    const summer = own.hand.find(card => card.baseId === "summer_teacher");
    const extra = own.hand.find(card => card.baseId === "extra_people");
    return [effectiveCardCost(summer), own.hand.some(card => card.baseId === "trendy_student"),
      canFuseAnyHandCard("player", summer, extra), hasKeyword(summer, "陽気")];
  })).toEqual([4, false, false, true]);
});

for (const [material, zone, cost] of [
  ["trendy_student", "seat", 4],
  ["extra_people", "teacher", 9],
  ["kyoto_sound_i", "teacher", 6],
  ["kyoto_sound_i", "seat", 6]
]) {
  test(`${material}を融合して${zone}へ出席すると対応する効果が働く`, async ({ page }) => {
    await startSummer(page);
    const index = zone === "seat" ? 4 : null;
    expect(await page.evaluate(({ material, zone, index }) => {
      const own = state.players.player;
      const summer = own.hand.find(card => card.baseId === "summer_teacher");
      const ingredient = own.hand.find(card => card.baseId === material);
      if (!fuseAnyHandCards("player", summer.instanceId, [ingredient.instanceId], false)) return null;
      return effectiveCardCost(summer, zone, index);
    }, { material, zone, index })).toBe(cost);
    await settle(page);
    await page.evaluate(({ zone, index }) => {
      const summer = state.players.player.hand.find(card => card.baseId === "summer_teacher");
      playCard(summer.instanceId, zone, "player", index);
    }, { zone, index });
    await expect.poll(() => page.evaluate(({ zone, index }) => getBoardCard("player", zone, index)?.baseId, { zone, index }))
      .toBe("summer_teacher");
    await settle(page);
    if (material === "extra_people") {
      expect(await page.evaluate(() => state.players.player.board.seats.map(card =>
        [card?.baseId, card?.attack, card?.currentHp, hasKeyword(card, "陽気")]))).toEqual(Array(9).fill(["extra_student", 2, 2, true]));
    } else if (material === "kyoto_sound_i") {
      const result = await page.evaluate(({ zone, index }) => {
        const opponent = state.players.opponent.board;
        const summer = getBoardCard("player", zone, index);
        return { hp: summer.currentHp, low: opponent.seats.slice(0, 2).map(card => card?.baseId ?? null),
          desk: opponent.teacher.currentHp, strong: opponent.seats[4] && [opponent.seats[4].attack, opponent.seats[4].currentHp] };
      }, { zone, index });
      expect(result.hp).toBe(zone === "teacher" ? 5 : 2);
      expect(result.low).toEqual(zone === "teacher" ? [null, null] : ["general_student", "single_cell"]);
      expect(result.desk).toBe(2);
      expect(result.strong).toEqual(zone === "teacher" ? [9, 4] : [7, 7]);
    } else {
      expect(await page.evaluate(() => {
        const summer = getBoardCard("player", "seat", 4);
        const target = index => ({ owner: "opponent", zone: "seat", index });
        const attack = index => {
          markCardAttackUsed(summer);
          resolveCardAttackWithBoardCleanup(summer, target(index));
          return [summer.currentHp, summer.hasAttacked];
        };
        return [hasKeyword(summer, "陽気"), attack(0), attack(1), attack(4)];
      })).toEqual([true, [2, false], [2, false], [2, true]]);
    }
  });
}

test("AIは手札の素材と戦意を見て融合し、席マスへは未融合で出席しない", async ({ page }) => {
  await startSummer(page);
  expect(await page.evaluate(() => {
    const side = "opponent";
    state.currentSide = side;
    const own = state.players[side];
    const summer = createCardFromBase("summer_teacher", side);
    own.hand = [summer, createCardFromBase("kyoto_sound_i", side), createCardFromBase("trendy_student", side)];
    own.will = 4;
    return [canPlaceCard(side, summer, "seat", side, 0), tryFuseAnyHandCardForAi(side),
      summerTeacherFusionMaterial(summer), effectiveCardCost(summer)];
  })).toEqual([false, true, "trendy_student", 4]);
});
