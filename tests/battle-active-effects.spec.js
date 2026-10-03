const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function prepareEffectState(page) {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("abyss");
    api.state.environment = null;
    api.state.courseRegistration = null;
    api.state.cafeteriaEffectUntilActionTurn = -1;
    api.state.cafeteriaEffectPermanentlyActive = false;
    api.state.illegalCafeteriaResidualTurns = 0;
    api.state.temporarySeatBlocks = [];
    api.state.deckToHandLocks = [];
    ["player", "opponent"].forEach((side) => {
      const player = api.state.players[side];
      player.abyssTurns = 0;
      player.internTurnsRemaining = 0;
      player.effectUseLockTurnsRemaining = 0;
      player.crabCountdown = null;
      player.designTextbookUntilTurn = 0;
      player.handCostTaxUntilActionTurn = 0;
      player.lifeShieldUntilTurn = 0;
      player.lifeFloorShields = [];
      player.maxLifeOverride = null;
    });
    api.state.players.player.abyssTurns = 2;
    api.state.players.player.internTurnsRemaining = 2;
    api.state.players.opponent.effectUseLockTurnsRemaining = 1;
    api.render();
  });
}

test("自分と相手の継続効果を分けて表示し、詳細と残り回数を確認できる", async ({ page }) => {
  await prepareEffectState(page);

  const playerEffects = page.locator("#playerActiveEffectsButton");
  const opponentEffects = page.locator("#opponentActiveEffectsButton");
  await expect(playerEffects).toContainText("自分の継続効果");
  await expect(playerEffects).toContainText("深淵・インターン");
  await expect(page.locator("#playerActiveEffectsCount")).toHaveText("2");
  await expect(opponentEffects).toContainText("相手の継続効果");
  await expect(opponentEffects).toContainText("煩わしいなぁ");
  await expect(page.locator("#opponentActiveEffectsCount")).toHaveText("1");

  await playerEffects.click();
  await expect(page.locator("#battleLogDrawer")).toHaveClass(/open/);
  await expect(page.locator("#battleDrawerTitle")).toHaveText("自分の継続効果");
  await expect(page.locator("#battleDrawerInspector")).toContainText("深淵");
  await expect(page.locator("#battleDrawerInspector")).toContainText("残り2回");
  await expect(page.locator("#battleDrawerInspector")).toContainText("インターン");

  await opponentEffects.click();
  await expect(page.locator("#battleDrawerTitle")).toHaveText("相手の継続効果");
  await expect(page.locator("#battleDrawerInspector")).toContainText("煩わしいなぁ");
  await expect(page.locator("#battleDrawerInspector")).not.toContainText("深淵");
});

test("継続効果が終了すると件数と詳細がすぐに空表示へ戻る", async ({ page }) => {
  await prepareEffectState(page);

  await page.locator("#playerActiveEffectsButton").click();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.abyssTurns = 0;
    api.state.players.player.internTurnsRemaining = 0;
    api.render();
  });

  await expect(page.locator("#playerActiveEffectsSummary")).toHaveText("現在なし");
  await expect(page.locator("#playerActiveEffectsCount")).toHaveText("0");
  await expect(page.locator("#battleDrawerInspector")).toContainText("継続中の効果はありません");
});

test("継続効果ボタンはデスクトップとスマートフォンの盤面内に収まる", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await prepareEffectState(page);
    const boxes = await page.locator(".battle-active-effects").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }));
    expect(boxes).toHaveLength(2);
    boxes.forEach((box) => {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
      expect(box.bottom).toBeLessThanOrEqual(viewport.height);
    });
  }
});

test("相手の継続効果とターン表示の上辺が画面の拡大縮小後も揃う", async ({ page }) => {
  await prepareEffectState(page);
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1122, height: 768 },
    { width: 900, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => {
      const effects = document.getElementById("opponentActiveEffectsButton").getBoundingClientRect();
      const turn = document.querySelector(".battle-v16-turn").getBoundingClientRect();
      return Math.abs(effects.top - turn.top);
    })).toBeLessThan(0.5);
  }
});
