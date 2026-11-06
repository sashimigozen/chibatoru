const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("カード一覧から裏U太を試し、赤はっぴを引き継いで2枚装備する", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator('[data-case-view="cards"]').click();
  await page.locator("#cardsCatalogSearch").fill("裏U太");
  await page.locator('[data-catalog-card="dark_yuta"]').click();
  await expect(page.locator("#cardTestStartButton")).toBeVisible();
  await page.locator("#cardTestStartButton").click();
  await page.evaluate(() => { state.training.skipAnimations = true; });
  const slot = page.locator('.board-card[data-owner="player"][data-zone="seat"][data-index="4"]');
  const settle = () => expect.poll(() => page.evaluate(() => !battlePresentationBusy())).toBe(true);
  const equipHappi = async () => {
    await settle();
    await page.evaluate(() => beginItemUse(state.players.player.hand.find((card) => card.baseId === "red_happi")));
    await expect(slot).toHaveClass(/effect-target-candidate/);
    await slot.click();
    await page.locator("#itemTargetConfirmButton").click();
  };
  const stats = () => page.evaluate(() => {
    const card = state.players.player.board.seats[4];
    return [card.baseId, card.attack, equipmentDetailText(card)];
  });

  await equipHappi();
  await expect.poll(stats).toEqual(["yuta", 5, "装備：赤はっぴ"]);
  await settle();
  await page.evaluate(() => {
    const card = state.players.player.hand.find((entry) => entry.baseId === "dark_yuta");
    playCard(card.instanceId, "seat", "player", 4);
  });
  await expect.poll(stats).toEqual(["dark_yuta", 7, "装備：赤はっぴ"]);
  await equipHappi();
  await expect.poll(stats).toEqual(["dark_yuta", 9, "装備：赤はっぴ / 赤はっぴ"]);
  expect(await page.evaluate(() => {
    const player = state.players.player;
    const chameleon = player.hand.find((card) => card.baseId === "chameleon");
    const before = player.will;
    const offered = canUseItemOnBoardTarget(chameleon, "player", "seat", 4);
    const used = castItemOnCard("player", chameleon, "player", "seat", 4, false);
    return [offered, used, player.will === before, player.hand.includes(chameleon)];
  })).toEqual([false, false, true, true]);
});

test("裏U太のストレスヘアー2枚は同期され、それぞれ解除して強化する", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    startCardTest("dark_yuta");
    state.training.skipAnimations = true;
    const player = state.players.player;
    const card = player.hand.find((entry) => entry.baseId === "dark_yuta");
    evolveCard("player", card, "player", "seat", 4, { skipEvolutionAnimation: true });
    const evolved = player.board.seats[4];
    const hairs = player.hand.filter((entry) => entry.baseId === "stress_hair");
    const used = hairs.map((hair) => castItemOnCard("player", hair, "player", "seat", 4, false));
    const before = [evolved.attack, evolved.currentHp];
    const snapshot = onlineCreateSnapshot();
    const synced = equipmentDetailText(snapshot.state.players.player.board.seats[4]);
    state.actionTurn += 1;
    resolveItemEndTurnEffects("opponent");
    return {
      used, before, synced,
      after: [evolved.attack, evolved.currentHp, equipmentDetailText(evolved)],
      returned: player.trash.filter((entry) => entry.baseId === "stress_hair").map((entry) => entry.instanceId),
      hairIds: hairs.map((entry) => entry.instanceId)
    };
  });
  expect(result.used).toEqual([true, true]);
  expect(result.before).toEqual([5, 3]);
  expect(result.synced).toBe("装備：ストレスヘアー / ストレスヘアー");
  expect(result.after).toEqual([13, 13, "装備：なし"]);
  expect(result.returned).toEqual(result.hairIds);
});

test("イヤホンを引き継いだ裏U太は空き枠にだけ装備でき、破壊時に両方外れる", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    startCardTest("dark_yuta");
    state.training.skipAnimations = true;
    const player = state.players.player;
    const useEquipment = (baseId) => {
      const item = createCardFromBase(baseId, "player");
      player.hand.push(item);
      return castItemOnCard("player", item, "player", "seat", 4, false);
    };
    const earphones = useEquipment("earphones");
    const card = player.hand.find((entry) => entry.baseId === "dark_yuta");
    evolveCard("player", card, "player", "seat", 4, { skipEvolutionAnimation: true });
    const happi = useEquipment("red_happi");
    const padlock = useEquipment("padlock");
    const equipped = equipmentDetailText(player.board.seats[4]);
    destroyBoardCard({ owner: "player", zone: "seat", index: 4 });
    return { earphones, happi, padlock, equipped, trash: player.trash.map((entry) => entry.baseId) };
  });
  expect(result).toEqual({
    earphones: true, happi: true, padlock: false, equipped: "装備：赤はっぴ / イヤホン",
    trash: ["dark_yuta", "red_happi", "earphones"]
  });
});
