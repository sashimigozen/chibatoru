const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeNavSoloButton").click();
});

test("ソロの既存モードと準備中の状態を維持する", async ({ page }) => {
  const order = await page.locator("#soloMenuScreen .solo-mode-button").evaluateAll((buttons) =>
    buttons.map((button) => button.id));

  expect(order).toEqual(["soloAiBattleButton", "soloDungeonButton", "soloTrainingButton", "soloTutorialButton"]);
  await expect(page.locator("#soloAiBattleButton")).toBeEnabled();
  await expect(page.locator("#soloAiBattleButton")).not.toContainText("COMING SOON");
  await expect(page.locator("#soloAiBattleButton")).toContainText("ランダムなAIデッキ");
});

test("従来のAIバトルをトレーニングとして開く", async ({ page }) => {
  await page.locator("#soloTrainingButton").click();

  await expect(page.locator("#soloDeckScreen")).toBeVisible();
  await expect(page.locator("#soloDeckScreen h1")).toHaveText("TRAINING");
  await expect(page.locator("#soloDeckScreen")).not.toContainText("対戦設定");
  await expect(page.locator("#soloPlayerSlot")).toBeVisible();
  await expect(page.locator("#soloAiSlot")).toBeVisible();
  await expect(page.locator("#soloBattleStartButton")).toBeDisabled();
});

test("左側をCPUへ切り替えてCPU同士の観戦設定にできる", async ({ page }) => {
  await page.locator("#soloTrainingButton").click();
  await page.locator("#soloLeftControllerButton").click();

  await expect(page.locator("#soloLeftControllerLabel")).toHaveText("CPU");
  await expect(page.locator("#soloLeftRoleTitle")).toHaveText("CPU");
  await expect(page.locator("#soloObserverNote")).toHaveCount(0);
});

test("トレーニングの補足説明を表示せず、選択とデッキ確認は維持する", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#soloTrainingButton").click();
  await expect(page.locator("#soloRuleDescription, #soloObserverNote, #soloDeckPickerSubtitle")).toHaveCount(0);
  await expect(page.locator("#soloDeckScreen")).not.toContainText("使用デッキと手番を選んでください");
  await expect(page.locator("#soloRuleCycleButton")).toBeVisible();
  await expect(page.locator("#soloInitiativeCycleButton")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("training-setup.png") });

  await page.evaluate(() => {
    window.__chibattle.state.deckBuilder.chaosDecks = {
      "説明なし確認用": { counts: { general_student: 40 } }
    };
  });
  await page.selectOption("#soloRuleSelect", "chaos");
  await page.locator("#soloLeftControllerButton").click();
  await expect(page.locator("#soloDeckScreen")).not.toContainText("操作せずに観戦できます");
  await page.locator("#soloInitiativeCycleButton").click();
  await expect(page.locator("#soloInitiativeLabel")).toHaveText("左が先攻");
  for (const selector of ["#soloPlayerSlot", "#soloAiSlot"]) {
    await page.locator(selector).click();
    await expect(page.locator("#soloDeckPicker")).not.toContainText("選んでください");
    await page.locator("#soloDeckGrid .deck-library-card", { hasText: "説明なし確認用" }).click();
  }
  await expect(page.locator("#soloBattleStartButton")).toBeEnabled();
  await page.locator("#soloPlayerDeckConfirmButton").click();
  await expect(page.locator("#soloDeckDetail .card").first()).toBeVisible();
  await expect(page.locator("#soloDeckPicker")).not.toContainText("現在選択しているデッキの内容です");
  await page.screenshot({ path: test.info().outputPath("training-deck-confirm.png") });
  await page.locator("#soloDeckPickerCloseButton").click();
  await page.locator("#soloBattleStartButton").click();
  await expect(page.locator("#battleScreen")).toBeVisible();
  expect(errors).toEqual([]);
});

test("魔の1号館は3番目のボタンから開く", async ({ page }) => {
  await page.locator("#soloDungeonButton").click();
  await expect(page.locator("#dungeonEntranceScreen")).toBeVisible();
});

test("9月6日の更新情報にソロモードの変更を記載する", async ({ page }) => {
  await page.locator("#homeNavHomeButton").click();
  await page.locator("#homeUpdatesButton").click();
  const latest = page.locator(".update-entry").filter({ hasText: "ver.0.22.3" });

  await expect(latest).toContainText("ver.0.22.3");
  await expect(latest).toContainText("2026年9月6日");
  await expect(latest).toContainText("トレーニング");
  await expect(latest).toContainText("COMING SOON");
});
