const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const profileStorageKey = "chibattle-player-profile-v1";
const lectureNoticeKey = "chibattle-lecture-experiment-notice-v1";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(({ profileKey, noticeKey }) => {
    localStorage.setItem(noticeKey, "shown");
    localStorage.setItem(profileKey, JSON.stringify({
      username: "ホーム確認",
      avatarId: "glasses",
      favoriteCardId: "aggro_king",
      favoriteCardStyle: "normal",
      commentParts: ["対戦よろしく", "お願いします", "エンジョイ"]
    }));
  }, { profileKey: profileStorageKey, noticeKey: lectureNoticeKey });
  await page.reload();
});

test("ホームの好きなカードをめくり、表だけでカード名と拡大表示を出す", async ({ page }) => {
  const cardButton = page.locator("#homeFavoriteCardButton");
  const cardLabel = page.locator("#homeFavoriteCardLabel");

  const cardBack = await page.locator("#homeFavoriteCardImage").evaluate((image) => ({
    src: image.getAttribute("src"),
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    stageRatio: image.closest(".home-favorite-card-flip-stage").getBoundingClientRect().width
      / image.closest(".home-favorite-card-flip-stage").getBoundingClientRect().height
  }));
  expect(cardBack.src).toContain("assets/card-back.png");
  expect(cardBack.naturalWidth).toBe(420);
  expect(cardBack.naturalHeight).toBe(640);
  expect(cardBack.stageRatio).toBeCloseTo(21 / 32, 3);

  await cardButton.hover();
  await expect.poll(() => cardLabel.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
  await expect(cardButton).toHaveAttribute("aria-disabled", "true");
  await cardButton.dispatchEvent("click");
  await expect(page.locator("#homeFavoriteCardPreview")).toBeHidden();

  await page.locator("#homeFavoriteCardFlipButton").click();
  await expect(cardButton).toHaveClass(/is-flipped/);
  await expect(cardButton).toHaveAttribute("aria-disabled", "false");
  await expect.poll(() => page.locator("#homeFavoriteCardFront .card-scale-stage").evaluate((stage) => {
    const shell = stage.parentElement;
    const actual = Number.parseFloat(getComputedStyle(stage).getPropertyValue("--card-template-scale"));
    const expected = Math.min(shell.offsetWidth / 420, shell.offsetHeight / 640);
    return Math.abs(actual - expected);
  })).toBeLessThan(.001);
  await expect.poll(() => page.locator("#homeFavoriteCardFront .home-favorite-card-render").evaluate((card) => getComputedStyle(card).transform)).toBe("none");
  await cardButton.hover();
  await expect.poll(() => cardLabel.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await expect(cardLabel).toHaveText("アグロキング");

  await cardButton.click();
  await expect(page.locator("#homeFavoriteCardPreview")).toBeVisible();
  await expect(page.locator("#homeFavoriteCardPreviewCard .card-name")).toHaveText("アグロキング");
  await page.locator("#homeFavoriteCardPreviewCloseButton").click();
  await expect(page.locator("#homeFavoriteCardPreview")).toBeHidden();
});

test("デッキケースからカード画面を開き、ランダムマッチは検索画面へ直接進む", async ({ page }) => {
  const navigationMetrics = () => page.locator("#homeNavigation").evaluate((navigation) => {
    const navigationRect = navigation.getBoundingClientRect();
    const itemRect = navigation.querySelector(".home-nav-item").getBoundingClientRect();
    return {
      x: navigationRect.x,
      y: navigationRect.y,
      width: navigationRect.width,
      itemY: itemRect.y,
      itemHeight: itemRect.height
    };
  });
  const homeNavigation = await navigationMetrics();
  const expectSameNavigationPosition = async () => {
    const current = await navigationMetrics();
    Object.keys(homeNavigation).forEach((property) => {
      expect(current[property]).toBeCloseTo(homeNavigation[property], 3);
    });
  };

  const deckButton = page.locator("#homeDeckButton");
  await deckButton.hover();
  await expect.poll(() => page.locator("#homeDeckName").evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await deckButton.click();
  await expect(page.locator("#deckScreen")).toBeVisible();
  await expectSameNavigationPosition();

  await page.locator("#homeNavHomeButton").click();
  await page.locator("#homeBattleButton").click();
  await expect(page.locator("#onlineScreen")).toBeVisible();
  await expect(page.locator("#onlineRandomSetupPanel")).toBeVisible();
  await expect(page.locator("#onlineRandomMainText")).toContainText(/マッチング中|マッチしました/);
  await expectSameNavigationPosition();
});

test("ホームの背景・操作オブジェクト・ホームバーは画面サイズが変わっても同じ座標で追従する", async ({ page }) => {
  const viewports = [
    { width: 1670, height: 1026 },
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 1122, height: 706 },
    { width: 900, height: 900 },
    { width: 390, height: 844 },
    { width: 1600, height: 700 },
    { width: 1920, height: 800 },
    { width: 1920, height: 640 }
  ];
  const objectIds = [
    "homeProfileButton",
    "homeCommentSticky",
    "homeFavoriteCardObject",
    "homeDeckButton",
    "homeBattleButton",
    "homeUtilityMenuButton"
  ];
  let baseline = null;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.reload();
    const metrics = await page.evaluate((ids) => {
      const bounds = (id) => {
        const rect = document.getElementById(id).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const frame = bounds("homeDeskStageFrame");
      const stage = bounds("homeDeskStage");
      const navigation = bounds("homeNavigation");
      const normalize = (rect) => ({
        x: (rect.x - frame.x) / stage.width,
        y: (rect.y - frame.y) / stage.height,
        width: rect.width / stage.width,
        height: rect.height / stage.height
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        frame,
        stage,
        navigation,
        compact: document.getElementById("homeDeskStage").classList.contains("home-desk-compact"),
        objects: Object.fromEntries(ids.map((id) => [id, normalize(bounds(id))]))
      };
    }, objectIds);

    expect(metrics.stage.width / metrics.stage.height).toBeCloseTo(1670 / 942, 3);
    expect(Math.abs(metrics.frame.width - metrics.stage.width)).toBeLessThan(1.1);
    expect(Math.abs(metrics.navigation.x - metrics.frame.x)).toBeLessThan(1.1);
    expect(Math.abs(metrics.navigation.width - metrics.frame.width)).toBeLessThan(1.1);
    expect(Math.abs(metrics.navigation.y - (metrics.frame.y + metrics.frame.height))).toBeLessThan(1.1);
    expect(Math.abs(metrics.navigation.y + metrics.navigation.height - metrics.viewport.height)).toBeLessThan(1.1);
    expect(metrics.frame.x).toBeGreaterThanOrEqual(-.6);
    expect(Math.abs(metrics.frame.y)).toBeLessThan(1.1);
    expect(Math.abs(metrics.frame.width - metrics.viewport.width)).toBeLessThan(1.1);
    objectIds.forEach((id) => {
      expect(metrics.objects[id].y + metrics.objects[id].height).toBeLessThanOrEqual(metrics.frame.height / metrics.stage.height + .001);
    });
    if (metrics.compact) continue;

    if (!baseline) {
      baseline = metrics.objects;
      continue;
    }
    objectIds.forEach((id) => {
      ["x", "y", "width", "height"].forEach((property) => {
        expect(metrics.objects[id][property]).toBeCloseTo(baseline[id][property], 3);
      });
    });
  }
});

test("同じ日付と同じメジャー・マイナー系統の更新情報は最小バージョンへ統合する", async ({ page }) => {
  await page.locator("#homeUpdatesButton").click();
  const sameDaySeries = page.locator("#updateList .update-entry > summary").filter({ hasText: "2026年9月13日" });
  await expect(sameDaySeries).toHaveCount(1);
  await expect(sameDaySeries).toContainText("ver.0.23.3");
});
