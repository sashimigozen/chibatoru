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

  await page.locator("#battleLogCloseButton").click();
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

test("効果のある環境を両者の継続効果へ表示し、上書きすると入れ替わる", async ({ page }) => {
  test.setTimeout(60000);
  await prepareEffectState(page);
  const environments = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.abyssTurns = 0;
    api.state.players.player.internTurnsRemaining = 0;
    api.state.players.opponent.effectUseLockTurnsRemaining = 0;
    api.state.fullLockSeatBlocks = ["player", "opponent"].flatMap((owner) => [0, 1, 2].map((index) => ({ owner, index })));
    return Object.entries(api.CARD_BASES).filter(([, card]) => card.type === "environment" && card.name !== "一般教室")
      .map(([id, card]) => ({ id, name: card.name }));
  });
  for (const environment of environments) {
    await page.evaluate((id) => {
      const api = window.__chibattle;
      api.state.environment = api.makeBoardCard(api.createCardFromBase(id, "player"));
      api.render();
    }, environment.id);
    for (const side of ["player", "opponent"]) {
      await expect(page.locator(`#${side}ActiveEffectsSummary`)).toContainText(environment.name);
      await expect(page.locator(`#${side}ActiveEffectsCount`)).toHaveText("1");
      await page.locator(`#${side}ActiveEffectsButton`).click();
      await expect(page.locator("#battleDrawerInspector")).toContainText(environment.name);
      if (environment.id === "academic_move" && side === "player") {
        await page.screenshot({ path: test.info().outputPath("academic-move-effects.png") });
      }
      await page.locator("#battleLogCloseButton").click();
    }
  }
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.environment = api.makeBoardCard(api.createCardFromBase("classroom", "player"));
    api.render();
  });
  await expect(page.locator("#playerActiveEffectsCount")).toHaveText("0");
  await expect(page.locator("#opponentActiveEffectsCount")).toHaveText("0");
  await page.locator("#playerActiveEffectsButton").click();
  await expect(page.locator("#battleDrawerInspector")).toContainText("継続中の効果はありません");
});

test("アカデミックムーブの退場は環境変更後も対象の側だけに表示する", async ({ page }) => {
  await prepareEffectState(page);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.abyssTurns = 0;
    api.state.players.player.internTurnsRemaining = 0;
    api.state.players.opponent.effectUseLockTurnsRemaining = 0;
    api.state.players.player.board.seats = Array(9).fill(null);
    api.state.players.player.board.teacher = null;
    const card = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    card.academicMoveMarked = true;
    api.state.players.player.board.seats[0] = card;
    api.render();
  });
  await expect(page.locator("#playerActiveEffectsSummary")).toContainText("アカデミックムーブ");
  await expect(page.locator("#opponentActiveEffectsCount")).toHaveText("0");
  await page.locator("#playerActiveEffectsButton").click();
  await expect(page.locator("#battleDrawerInspector")).toContainText("出席者1人");
  await expect(page.locator("#battleDrawerInspector")).toContainText("自分のターン終了時");
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.board.seats[0] = null;
    api.render();
  });
  await expect(page.locator("#playerActiveEffectsCount")).toHaveText("0");
});

test("図書館の手札を送る効果は設置した側だけ、学友会は残り回数も表示する", async ({ page }) => {
  await prepareEffectState(page);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.environment = api.makeBoardCard(api.createCardFromBase("meguro_library", "opponent"));
    api.render();
  });
  await page.locator("#playerActiveEffectsButton").click();
  await expect(page.locator("#battleDrawerInspector")).toContainText("環境を設置した相手だけ");
  await page.locator("#battleLogCloseButton").click();
  await page.locator("#opponentActiveEffectsButton").click();
  await expect(page.locator("#battleDrawerInspector")).toContainText("自分のターン終了時、手札1枚");
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.environment = api.makeBoardCard(api.createCardFromBase("student_council", "player"));
    api.state.environment.councilTurnsUntilTransform = 1;
    api.render();
  });
  await expect(page.locator("#battleDrawerInspector")).toContainText("あと1回");
  await expect(page.locator("#battleDrawerInspector")).toContainText("体力を+2");
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
