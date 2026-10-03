const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const chapterNames = ["基本編", "配置編", "講義編", "陽気編", "注目編", "遅刻編", "眠気編", "余裕編", "装備編", "吸血編", "進化編", "融合編", "負荷編"];
const screenGuideTargets = [
  ["講義室", "#playerBoardPanel"],
  ["環境マス", "#environmentSlot"],
  ["自分の手札", "#playerHand"],
  ["相手の手札", ".opponent-hand-zone"],
  ["自分のデッキ", "#playerDeckPile"],
  ["相手のデッキ", "#opponentDeckPile"],
  ["自分の気力", "#playerLifeTarget"],
  ["相手の気力", "#opponentLifeTarget"],
  ["自分の戦意", ".battle-v16-player-mana"],
  ["相手の戦意", ".battle-v16-opponent-mana"],
  ["ターン表示", ".battle-v16-turn"],
  ["遅刻ゾーン", "#playerLateZone"],
  ["自分の校外エリア", "#playerTrashButton"],
  ["相手の校外エリア", "#opponentTrashButton"],
  ["相手の継続効果", "#opponentActiveEffectsButton"],
  ["自分の継続効果", "#playerActiveEffectsButton"],
  ["カード確認", "#opponentSeatGrid .board-card"],
  ["ログ", "#battleLogButton"],
  ["MENU", "#battleMenuButton"]
];

async function openList(page) {
  await page.goto(gameUrl);
  await page.locator("#homeNavSoloButton").click();
  await page.locator("#soloTutorialButton").click();
}

async function startBasic(page) {
  await openList(page);
  await page.locator('[data-tutorial-chapter="basic"]').click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("基本編：練習を始めよう");
}

async function advanceTo(page, title) {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    await expect(page.locator("#tutorialCoachText")).not.toContainText(/今回は|この練習では|練習用|残り2|今は0人/);
    if (await page.locator("#tutorialCoachTitle").textContent() === title) return;
    await page.locator("#tutorialNextButton").click();
  }
  throw new Error(`説明に到達できませんでした：${title}`);
}

const seat = (page, side, index) => page.locator(`.slot[data-owner="${side}"][data-zone="seat"][data-index="${index}"]`);
const coachLayout = (page) => page.evaluate(() =>
  ["tutorialCoach", "tutorialBackStepButton", "tutorialNextButton"].map((id) => {
    const rect = document.getElementById(id).getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));

test("13編を合意した順番で表示し、基本編のみ開始できる", async ({ page }) => {
  await openList(page);
  await expect(page.locator("#tutorialChapterList .solo-mode-main")).toHaveText(chapterNames.map((name, index) => `${index + 1}. ${name}`));
  await expect(page.locator('[data-tutorial-chapter="basic"]')).toBeEnabled();
  await expect(page.locator("#tutorialChapterList button:disabled")).toHaveCount(12);
  await expect(page.locator("#homeNavSoloButton")).toHaveAttribute("aria-current", "page");
  await page.locator("#tutorialBackHomeButton").click();
  await expect(page.locator("#soloMenuScreen")).toBeVisible();
});

test("5タイプを紹介し、出席・ターン終了・反撃を体験して自由なリーサルで勝利できる", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await startBasic(page);
  const fixedLayout = await coachLayout(page);
  const initial = await page.evaluate(() => {
    const state = window.__chibattle.state;
    return { types: state.players.player.hand.map((card) => card.type), will: state.players.player.will, life: state.players.opponent.life };
  });
  expect(initial).toEqual({ types: ["student", "teacher", "vampire", "item", "environment"], will: 3, life: 2 });
  for (const title of ["タイプ：学生", "タイプ：教師", "タイプ：ヴァンパイア", "タイプ：持ち物", "タイプ：環境"]) {
    await advanceTo(page, title);
    expect(await page.evaluate(() => window.__chibattle.state.players.player.hand.length)).toBe(5);
  }
  await advanceTo(page, "一般学生を出席させよう");
  expect(await coachLayout(page)).toEqual(fixedLayout);
  await expect(page.locator("#tutorialNextButton")).toBeHidden();
  await expect(page.locator('#playerHand [data-base-id="ruler"]')).toBeDisabled();
  await page.locator('#playerHand [data-base-id="general_student"]').click();
  await seat(page, "player", 4).click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("出席の結果");
  expect(await coachLayout(page)).toEqual(fixedLayout);
  expect(await page.evaluate(() => window.__chibattle.state.players.player.will)).toBe(1);
  await page.locator("#tutorialNextButton").click();
  await page.locator("#endTurnButton").click();
  await expect.poll(() => page.evaluate(() => window.__chibattle.state.currentSide)).toBe("player");
  await expect(page.locator("#tutorialNextButton")).toBeEnabled();
  expect(await page.evaluate(() => window.__chibattle.state.players.player.will)).toBe(4);
  await page.locator("#tutorialNextButton").click();
  await seat(page, "player", 4).click();
  await seat(page, "opponent", 0).click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("攻撃・反撃・校外エリア");
  await expect.poll(() => page.evaluate(() => window.__chibattle.state.players.player.board.seats[4].currentHp)).toBe(1);
  expect(await page.evaluate(() => window.__chibattle.state.players.opponent.board.seats[0])).toBeNull();
  await page.locator("#tutorialNextButton").click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("自由にプレイしよう");
  await expect(page.locator("#tutorialCoachText")).toHaveText("ここからは自由にプレイして、勝利を目指そう！\n勝利後は「戻る」で一覧に戻れます。");
  await expect(page.locator("#tutorialNextButton")).toHaveText("プレイする");
  await page.screenshot({ path: test.info().outputPath("free-play-guide.png") });
  expect(await coachLayout(page)).toEqual(fixedLayout);
  await page.locator("#tutorialNextButton").click();
  await expect(page.locator("#tutorialLayer")).toBeHidden();
  expect(await page.evaluate(() => window.__chibattle.state.message)).toBe("ここからは自由にプレイして、勝利を目指そう！");
  await expect(page.locator('#playerHand [data-base-id="ruler"]')).toBeEnabled();
  await seat(page, "player", 8).click();
  await page.locator("#opponentLifeTarget").click();
  await expect(page.locator("#resultOverlay")).toBeVisible();
  await expect(page.locator("#resultOverlay")).toContainText("勝利");
  expect(await page.evaluate(() => window.__chibattle.state.screen)).toBe("battle");
  await expect(page.locator("#resultOverlay button")).toHaveCount(1);
  await page.locator("[data-result-tutorial-back]").click();
  await expect(page.locator("#tutorialScreen")).toBeVisible();
  await expect(page.locator("#tutorialChapterList button")).toHaveCount(13);
  expect(errors).toEqual([]);
});

test("一つ戻るで出席前の手札と戦意を復元し、終了から一覧へ戻って再開できる", async ({ page }) => {
  await startBasic(page);
  await advanceTo(page, "一般学生を出席させよう");
  await page.locator('#playerHand [data-base-id="general_student"]').click();
  await seat(page, "player", 4).click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("出席の結果");
  await page.locator("#tutorialBackStepButton").click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("一般学生を出席させよう");
  expect(await page.evaluate(() => {
    const player = window.__chibattle.state.players.player;
    return { will: player.will, hand: player.hand.length, seat: player.board.seats[4] };
  })).toEqual({ will: 3, hand: 5, seat: null });
  await page.locator("#tutorialExitButton").click();
  await expect(page.locator("#tutorialScreen")).toBeVisible();
  await page.locator('[data-tutorial-chapter="basic"]').click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("基本編：練習を始めよう");
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`PC ${viewport.width}×${viewport.height}で画面の各エリアを隠さず順に紹介する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await startBasic(page);
    const fixedLayout = await coachLayout(page);
    for (const [name, selector] of screenGuideTargets) {
      await advanceTo(page, `画面の見方：${name}`);
      await expect(page.locator(selector).first()).toBeVisible();
      await expect.poll(() => page.evaluate((targetSelector) => {
        const target = document.querySelector(targetSelector).getBoundingClientRect();
        const spotlight = document.getElementById("tutorialSpotlight").getBoundingClientRect();
        const coach = document.getElementById("tutorialCoach").getBoundingClientRect();
        const coversTarget = coach.left < target.right && coach.right > target.left
          && coach.top < target.bottom && coach.bottom > target.top;
        // 画面端では余白を切り詰め、対象ではなく枠だけを画面内に収める。
        const left = Math.max(4, target.left - 8);
        const top = Math.max(4, target.top - 8);
        const width = Math.max(24, Math.min(innerWidth - 4, target.right + 8) - left);
        const height = Math.max(24, Math.min(innerHeight - 4, target.bottom + 8) - top);
        const aligned = Math.abs(spotlight.left - left) < 2 && Math.abs(spotlight.top - top) < 2
          && Math.abs(spotlight.width - width) < 2 && Math.abs(spotlight.height - height) < 2;
        return aligned && !coversTarget;
      }, selector)).toBe(true);
      await expect(page.locator("#tutorialNextButton")).toBeEnabled();
      expect(await coachLayout(page)).toEqual(fixedLayout);
      if (name.includes("校外エリア") || name.includes("継続効果") || name === "ログ") {
        await page.locator(selector).click();
        await expect(page.locator("#battleLogDrawer")).toHaveClass(/open/);
        const drawerTitle = name.replace("校外エリア", "校外");
        await expect(page.locator("#battleDrawerTitle")).toHaveText(drawerTitle);
        await page.locator("#battleLogCloseButton").click();
        await expect(page.locator("#battleLogDrawer")).not.toHaveClass(/open/);
      }
    }
    expect(await page.evaluate(() => {
      const state = window.__chibattle.state;
      return { will: state.players.player.will, hand: state.players.player.hand.length, side: state.currentSide };
    })).toEqual({ will: 3, hand: 5, side: "player" });
  });

  test(`PC ${viewport.width}×${viewport.height}で説明が手札・ターン終了に重ならない`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await startBasic(page);
    const rects = await page.evaluate(() => ["tutorialCoach", "playerHand", "endTurnButton"].map((id) => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
    }));
    const [coach, hand, endTurn] = rects;
    const overlaps = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
    expect(overlaps(coach, hand)).toBe(false);
    expect(overlaps(coach, endTurn)).toBe(false);
    expect(coach.x).toBeGreaterThanOrEqual(0);
    expect(coach.bottom).toBeLessThanOrEqual(viewport.height);
    const next = await page.locator("#tutorialNextButton").boundingBox();
    expect(next.y + next.height).toBeLessThanOrEqual(coach.bottom);
    const fixedLayout = await coachLayout(page);
    await page.locator("#tutorialNextButton").hover();
    expect(await coachLayout(page)).toEqual(fixedLayout);
    await page.locator("#tutorialNextButton").click();
    expect(await coachLayout(page)).toEqual(fixedLayout);
    await page.locator("#tutorialBackStepButton").click();
    expect(await coachLayout(page)).toEqual(fixedLayout);
  });
}
