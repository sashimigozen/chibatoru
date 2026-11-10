const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function settle(page) {
  await expect.poll(() => page.evaluate(() => battlePresentationBusy()), { timeout: 15000 }).toBe(false);
}

test("UU太は盤面の外側の背景を変え、次のターンに出たU太のとどめで文字演出を流す", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator('[data-case-view="cards"]').click();
  await page.locator("#cardsCatalogSearch").fill("U太");
  await page.locator('[data-catalog-card="yuta"]').click();
  await page.locator('#cardTestModal [data-related-card="ultimate_yuta"]').click();
  await page.locator("#cardTestStartButton").click();
  await settle(page);
  const battle = page.locator("#battleScreen");
  const phrase = page.locator("#ultimateYutaOverlay");
  const surface = () => battle.evaluate(node => {
    const shell = node.querySelector(".game-shell");
    const classroom = getComputedStyle(shell, "::before");
    return {
      outer: [getComputedStyle(node).backgroundColor, getComputedStyle(node).backgroundImage],
      controls: getComputedStyle(shell.parentElement, "::before").backgroundImage,
      classroom: [classroom.backgroundColor, classroom.backgroundImage]
    };
  });
  const before = await surface();
  await page.locator('#playerHand [data-base-id="ultimate_yuta"]').first().click({ position: { x: 15, y: 65 } });
  await page.locator('#playerSeatGrid .slot[data-index="4"]').click();
  await expect(battle).toHaveClass(/ultimate-yuta-field/);
  const after = await surface();
  expect(after.outer).toEqual(before.outer);
  expect(before.controls).toBe("none");
  expect(after.controls).toContain("ultimate-yuta-ink.svg");
  expect(after.classroom).toEqual(before.classroom);
  await expect(phrase).toBeHidden();
  expect(await page.evaluate(() => [
    listBoardRefs("opponent").length, listBoardRefs("player").length, state.players.player.will,
    state.players.player.ultimateYutaAttendance, state.gameOver
  ])).toEqual([0, 2, 7, true, false]);
  await page.screenshot({ path: test.info().outputPath("ultimate-yuta-backdrop.png") });

  await page.locator("#endTurnButton").click();
  const yuta = page.locator('.board-card[data-owner="player"][data-base-id="yuta"]');
  await expect(yuta).toBeVisible({ timeout: 15000 });
  await settle(page);
  await yuta.click();
  await page.locator("#opponentLifeTarget").press("Enter");
  await expect(phrase.locator('[data-ultimate-phrase="tsurai_nara"]')).toHaveClass(/active/);
  await expect(page.locator("#resultOverlay")).toBeHidden();
  expect(await page.evaluate(() => [state.players.opponent.life, state.gameWinner])).toEqual([0, "player"]);
  await expect(phrase).toBeHidden({ timeout: 8000 });
  await expect(page.locator("#resultOverlay")).toContainText("勝利");
});

test("Ultimate U太が2枚出ても本体がいなくなった後のU太は1人で、空席を順に使う", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    startCardTest("ultimate_yuta");
    state.training.skipAnimations = true;
  });
  await settle(page);
  for (const index of [4, 5]) {
    await page.evaluate(seat => {
      const card = state.players.player.hand.find(entry => entry.baseId === "ultimate_yuta");
      playCard(card.instanceId, "seat", "player", seat);
    }, index);
    await expect.poll(() => page.evaluate(seat => state.players.player.board.seats[seat]?.baseId, index)).toBe("ultimate_yuta");
    await settle(page);
  }
  expect(await page.evaluate(() => {
    const own = state.players.player;
    for (const index of [4, 5]) destroyBoardCard({ owner: "player", zone: "seat", index });
    scheduleOpponentAI = () => {};
    state.currentSide = "opponent";
    startTurn("opponent");
    const noOpponentUta = listBoardRefs("opponent").length;
    state.currentSide = "player";
    state.actionTurn += 1;
    startTurn("player");
    const seats = own.board.seats;
    const after = seats.map(card => card?.baseId ?? null);
    const fast = hasKeyword(seats[1], "超陽気");
    const sync = onlineCreateSnapshot().state.players.player.ultimateYutaAttendance;
    for (const index of PLAYER_SEAT_ORDER) {
      seats[index] ||= makeBoardCard(createCardFromBase("general_student", "player"));
    }
    startTurn("player");
    return { after, fast, sync, noOpponentUta, full: seats.filter(card => card?.baseId === "yuta").length };
  })).toEqual({
    after: ["general_student", "yuta", null, null, null, null, null, null, null],
    fast: true, sync: true, noOpponentUta: 0, full: 1
  });
});

test("あえー女学生の注目と、3枚の表示・デッキ登録が一致する", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    startCardTest("ae_female_student");
    const own = state.players.player;
    const card = own.hand.find(entry => entry.baseId === "ae_female_student");
    const played = placeCardFromHand("player", card.instanceId, "seat", "player", 1, false, { revealAlreadyShown: true });
    return {
      played, attention: listAttentionCards("player").map(entry => entry.baseId),
      text: cardRulesText(card), cost: card.cost,
      deckOrder: getDeckEditorIds(""),
      summer: cardRulesText(createCardFromBase("summer_teacher", "player")),
      ultimate: cardRulesText(createCardFromBase("ultimate_yuta", "player")),
      generatedOnly: !DIRECT_DECK_CARD_IDS.has("ultimate_yuta")
    };
  });
  const catalog = require("../server/card-catalog.json");
  expect(result.deckOrder).toEqual(catalog.deckOrder);
  expect(catalog.specialties.common).toContain("ae_female_student");
  expect(catalog.direct).toContain("ae_female_student");
  expect(catalog.direct).not.toContain("ultimate_yuta");
  expect(result.generatedOnly).toBe(true);
  expect([result.played, result.attention, result.text, result.cost]).toEqual([true, ["ae_female_student"], "[注目]", 1]);
  expect(result.summer).toMatch(/^\[融合\]\n/);
  expect(result.ultimate).toMatch(/^\[超陽気\]\n/);
  expect(result.ultimate).toContain("この効果は重複しない。");
});
