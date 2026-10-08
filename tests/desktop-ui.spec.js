const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const nativeGameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const gameUrl = `${nativeGameUrl}?menu=folders`;
const storageKey = "chibattle-desktop-folders-v1";

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  test(`従来のメニューを同じPC内に表示する ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(nativeGameUrl);
    await page.locator("#homeNavBattleButton").click();
    await expect(page.locator("#modeComputer")).toHaveClass(/native-menu/);
    const frame = await page.locator("#modeComputer").boundingBox();
    expect(frame.x).toBe(0);
    expect(frame.y).toBe(0);
    expect(frame.width).toBe(viewport.width);
    await expect(page.locator(".computer-display")).toHaveCSS("border-radius", "0px");
    await expect(page.locator(".computer-taskbar")).toHaveCount(0);
    const lowerBezel = await page.locator(".computer-display").evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
    expect(lowerBezel).toBeCloseTo(Math.max(10, Math.min(viewport.width * .01, 14)), 1);
    const keyboard = await page.locator(".computer-base").boundingBox();
    expect(keyboard.height).toBeCloseTo(Math.max(32, Math.min(viewport.width * .04, 56)), 1);
    const navigation = await page.locator("#homeNavigation").boundingBox();
    expect(keyboard.x).toBeCloseTo(0, 1);
    expect(keyboard.width).toBeCloseTo(viewport.width, 1);
    expect(keyboard.y + keyboard.height).toBeCloseTo(navigation.y, 1);
    const keyboardImage = await page.locator(".computer-base img").boundingBox();
    expect(keyboardImage.x).toBeLessThan(0);
    expect(keyboardImage.x + keyboardImage.width).toBeGreaterThan(viewport.width);
    expect(keyboardImage.y + keyboardImage.height).toBeGreaterThan(navigation.y);
    await expect(page.locator(".computer-folder-icon")).toHaveCount(0);
    await expect(page.locator("#onlineMenuHead h1")).toHaveText("オンラインバトル");
    await expect(page.locator("#onlinePrivateMatchButton")).toContainText("プライベートマッチ");
    await expect(page.locator("#onlinePrivateMatchButton .online-match-sub")).toBeVisible();
    await expect(page.locator("#onlineFourMatchButton")).toBeDisabled();
    for (const selector of ["#onlineMatchActions button", "#soloMenuScreen .solo-mode-button"]) {
      if (selector.includes("soloMenuScreen")) {
        await page.locator(".computer-switch:not(.previous)").click();
        await expect(page.locator("#soloMenuScreen h1")).toHaveText("ソロ");
        await expect(page.locator("#soloTrainingButton .solo-mode-sub")).toBeVisible();
        await expect(page.locator("#soloAiBattleButton")).toBeDisabled();
        expect(await page.locator("#modeComputer").boundingBox()).toEqual(frame);
      }
      const area = await page.locator(".computer-content").boundingBox();
      for (const button of await page.locator(selector).all()) {
        const box = await button.boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(area.y);
        expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);
        expect(box.x).toBeGreaterThanOrEqual(area.x);
        expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width);
      }
      await page.screenshot({ path: test.info().outputPath(selector.includes("soloMenuScreen") ? "native-solo.png" : "native-battle.png") });
    }
    await page.locator("#soloTrainingButton").click();
    await expect(page.locator("#modeComputer #soloDeckScreen")).toBeVisible();
    await page.locator("#soloDeckBackHomeButton").click();
    await page.locator("#soloMenuScreen .screen-head").hover();
    await page.mouse.wheel(70, 0);
    await expect(page.locator("#onlineScreen")).toBeVisible();
    await page.locator("#onlinePrivateMatchButton").click();
    await expect(page.locator("#modeComputer #onlinePrivatePanel")).toBeVisible();
    await page.locator("#onlineBackMenuButton").click();
    await page.locator("#onlineBackHomeButton").click();
    await expect(page.locator("#homeDeskStage")).toBeVisible();
    await expect(page.locator("#modeComputer")).toBeHidden();
    await expect(page.locator("body")).not.toHaveClass(/computer-active/);
  });
}

async function open(page, mode = "Battle") {
  await page.goto(gameUrl);
  await page.locator(`#homeNav${mode}Button`).click();
}
async function dragFolder(page, selector, x, y) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator(selector)).toHaveClass(/is-moving/);
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
}

test("同じPCの三角でバトルとソロを切り替え、ショートカット欄は表示しない", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await open(page);
  const frame = await page.locator("#modeComputer").boundingBox();
  await expect(page.locator("#onlineMenuHead h1")).toHaveText("バトル");
  await expect(page.locator(".computer-taskbar")).toHaveCount(0);
  const display = await page.locator(".computer-display").boundingBox();
  const base = await page.locator(".computer-base").boundingBox();
  const viewport = page.viewportSize();
  expect(display.width).toBe(viewport.width);
  expect(display.x).toBe(0);
  expect(display.y).toBe(0);
  expect(display.height).toBeGreaterThan(viewport.height * .7);
  expect(base.width).toBe(viewport.width);
  expect(base.height).toBeGreaterThanOrEqual(32);
  expect(base.height).toBeLessThanOrEqual(56);
  expect(Math.abs(display.y + display.height - base.y)).toBeLessThan(1);
  await expect.poll(() => page.locator(".computer-base img").evaluate(img => img.naturalWidth)).toBe(2123);
  await expect(page.locator("body")).toHaveCSS("background-image", /classroom-laptop-view.webp/);
  await expect(page.locator(".computer-base img")).toHaveAttribute("src", "assets/tutorial/laptop-keyboard-graphite-v2.webp");
  await expect(page.locator("#onlinePrivateMatchButton .computer-folder-icon")).toHaveAttribute("src", "assets/tutorial/folder-closed.svg");
  await expect(page.locator("#onlinePrivateMatchButton .computer-folder-icon")).toHaveCSS("filter", /drop-shadow/);
  const folderBox = await page.locator("#onlinePrivateMatchButton").boundingBox();
  await page.locator("#onlinePrivateMatchButton").hover();
  expect(await page.locator("#onlinePrivateMatchButton").boundingBox()).toEqual(folderBox);
  await expect(page.locator("#onlineFourMatchButton")).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("desktop-battle.png") });
  await page.locator(".computer-switch:not(.previous)").click();
  await expect(page.locator("#soloMenuScreen")).toBeVisible();
  expect(await page.locator("#modeComputer").boundingBox()).toEqual(frame);
  await expect(page.locator("#soloAiBattleButton")).toBeDisabled();
  await expect(page.locator("#homeNavSoloButton")).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: test.info().outputPath("desktop-solo.png") });
  await page.locator(".computer-switch.previous").click();
  await expect(page.locator("#onlineScreen")).toBeVisible();
  expect(await page.locator("#modeComputer").boundingBox()).toEqual(frame);
  expect(errors).toEqual([]);
});

test("1回クリックで開き、準備・選択はPC内、実際の対戦ではPCを消す", async ({ page }) => {
  await open(page);
  await page.locator("#onlinePrivateMatchButton").click();
  await expect(page.locator("#modeComputer #onlinePrivatePanel")).toBeVisible();
  await expect(page.locator(".computer-switch:not(.previous)")).toBeHidden();
  await page.locator("#onlineBackMenuButton").click();
  await page.locator("#onlineSpectateButton").click();
  await expect(page.locator("#modeComputer #onlineSpectatePanel")).toBeVisible();
  await page.locator("#homeNavSoloButton").click();
  await page.locator("#soloTrainingButton").click();
  await expect(page.locator("#modeComputer #soloDeckScreen")).toBeVisible();
  const contentBox = await page.locator(".computer-content").boundingBox();
  for (const selector of ["#soloPlayerSlot", "#soloAiSlot", "#soloTrainingDataButton"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(contentBox.y + contentBox.height);
  }
  await page.screenshot({ path: test.info().outputPath("desktop-training.png") });
  await page.locator("#soloDeckBackHomeButton").click();
  await page.locator("#soloTutorialButton").click();
  await expect(page.locator("#modeComputer #tutorialScreen")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("desktop-tutorial.png") });
  await page.locator("#tutorialStartButton").click();
  await expect(page.locator("#battleScreen")).toBeVisible();
  await expect(page.locator("#modeComputer")).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/computer-active/);
});

test("長押し移動で開かず、画面別に配置を保存し再読み込み後も維持する", async ({ page }) => {
  await open(page, "Solo");
  const initial = await page.locator("#soloTutorialButton").boundingBox();
  const area = await page.locator("#soloMenuScreen .computer-desktop").boundingBox();
  await dragFolder(page, "#soloTutorialButton", area.x + area.width * .56, area.y + area.height * .8);
  await expect(page.locator("#soloMenuScreen")).toBeVisible();
  await expect(page.locator("#tutorialScreen")).toBeHidden();
  const moved = await page.locator("#soloTutorialButton").boundingBox();
  expect(moved.x).toBeGreaterThan(initial.x + 100);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.soloTutorialButton.x).toBeGreaterThan(.2);
  await page.locator("#homeNavBattleButton").click();
  const online = await page.locator("#onlinePrivateMatchButton").boundingBox();
  await page.reload();
  await page.locator("#homeNavSoloButton").click();
  const restored = await page.locator("#soloTutorialButton").boundingBox();
  expect(Math.abs(restored.x - moved.x)).toBeLessThan(1);
  expect(Math.abs(restored.y - moved.y)).toBeLessThan(1);
  await page.locator("#homeNavBattleButton").click();
  expect(await page.locator("#onlinePrivateMatchButton").boundingBox()).toEqual(online);
  await page.locator("#homeNavSoloButton").click();
  await page.locator("#soloTutorialButton").click();
  await expect(page.locator("#tutorialScreen")).toBeVisible();
});

test("画面外への移動を防ぎ、サイズ変更後もフォルダ・ホームバーが収まる", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "Solo");
  await dragFolder(page, "#soloTrainingButton", 3000, 3000);
  await page.setViewportSize({ width: 1000, height: 650 });
  await expect.poll(async () => page.locator("#soloTrainingButton").evaluate(el => {
    const rect = el.getBoundingClientRect();
    const area = el.parentElement.getBoundingClientRect();
    return rect.right <= area.right + 1 && rect.bottom <= area.bottom + 1;
  })).toBe(true);
  const frame = await page.locator("#modeComputer").boundingBox();
  const nav = await page.locator("#homeNavigation").boundingBox();
  expect(frame.y + frame.height).toBeLessThanOrEqual(nav.y);
  await page.screenshot({ path: test.info().outputPath("desktop-small.png") });
});

test("準備中のフォルダも移動できるが開かず、Escapeで移動を取り消せる", async ({ page }) => {
  await open(page, "Solo");
  const box = await page.locator("#soloAiBattleButton").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator("#soloAiBattleButton")).toHaveClass(/is-moving/);
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 20);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  const restored = await page.locator("#soloAiBattleButton").boundingBox();
  expect(Math.abs(restored.x - box.x)).toBeLessThan(1);
  await expect(page.locator("#soloMenuScreen")).toBeVisible();
  await dragFolder(page, "#soloAiBattleButton", box.x + box.width / 2 + 160, box.y + box.height / 2 + 30);
  await expect(page.locator("#soloMenuScreen")).toBeVisible();
  await expect(page.locator("#soloAiBattleButton")).toBeDisabled();
});

test("2本指スクロール相当の慣性イベントで1回だけ切り替える", async ({ page }) => {
  await open(page);
  await page.locator("#onlineMenuHead").hover();
  await page.mouse.wheel(70, 0);
  await expect(page.locator("#soloMenuScreen")).toBeVisible();
  await page.mouse.wheel(40, 0);
  await page.mouse.wheel(25, 0);
  await expect(page.locator("#soloMenuScreen")).toBeVisible();
});

test("壊れた保存値でも画面を開け、通常のカード画面にPC枠を持ち込まない", async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, '{"soloTutorialButton":{"x":"bad","y":null}}'), storageKey);
  await open(page, "Solo");
  await expect(page.locator("#soloTutorialButton")).toBeVisible();
  await page.locator("#homeNavDeckButton").click();
  await expect(page.locator("#deckScreen")).toBeVisible();
  await expect(page.locator("#modeComputer")).toBeHidden();
});
