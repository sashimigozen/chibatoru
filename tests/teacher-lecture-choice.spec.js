const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function prepareTeacherBattle(page, teacherBaseId = "general_teacher") {
  await page.goto(gameUrl);
  await page.evaluate((baseId) => {
    const api = window.__chibattle;
    api.startCardTest(baseId);
    const teacher = api.makeBoardCard(api.createCardFromBase(baseId, "player"));
    teacher.playedOnTurn = 0;
    api.state.players.player.board.teacher = teacher;
    api.render();
  }, teacherBaseId);
}

test("攻撃可能な教師を押すと攻撃か講義かを選べる", async ({ page }) => {
  await prepareTeacherBattle(page);

  await page.locator("#playerProfessorLane .board-card").click();
  await expect(page.locator("#teacherActionModal")).toBeVisible();
  await expect(page.locator("#teacherAttackChoiceButton")).toHaveText("攻撃する");
  await expect(page.locator("#teacherLectureChoiceButton")).toHaveText("講義を行う");

  await page.locator("#teacherAttackChoiceButton").click();
  await expect(page.locator("#teacherActionModal")).toBeHidden();
  const selected = await page.evaluate(() => window.__chibattle.state.selectedAttacker);
  expect(selected).toMatchObject({ owner: "player", zone: "teacher" });
});

test("講義を選ぶと対象の学生だけに1ダメージを与えて教師が行動済みになる", async ({ page }) => {
  await prepareTeacherBattle(page);

  const before = await page.evaluate(() => {
    const { state } = window.__chibattle;
    return {
      loud: state.players.opponent.board.seats[0].currentHp,
      vampire: state.players.opponent.board.seats[4].currentHp,
      general: state.players.opponent.board.seats[8].currentHp
    };
  });

  await page.locator("#playerProfessorLane .board-card").click();
  await page.locator("#teacherLectureChoiceButton").click();

  const after = await page.evaluate(() => {
    const { state } = window.__chibattle;
    return {
      teacherUsed: state.players.player.board.teacher.hasAttacked,
      loud: state.players.opponent.board.seats[0]?.currentHp ?? 0,
      vampire: state.players.opponent.board.seats[4]?.currentHp ?? 0,
      general: state.players.opponent.board.seats[8]?.currentHp ?? 0
    };
  });

  expect(after.teacherUsed).toBe(true);
  expect(after.loud).toBe(before.loud - 1);
  expect(after.vampire).toBe(before.vampire);
  expect(after.general).toBe(before.general - 1);
});

test("ターン終了時には講義を自動発動しない", async ({ page }) => {
  await prepareTeacherBattle(page);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const target = api.state.players.opponent.board.seats[8];
    const before = target.currentHp;
    api.resolveEndTurnEffects("player");
    return {
      before,
      after: target.currentHp,
      teacherUsed: api.state.players.player.board.teacher.hasAttacked
    };
  });

  expect(result.after).toBe(result.before);
  expect(result.teacherUsed).toBe(false);
});

test("講義を持たない教師には行動選択を表示しない", async ({ page }) => {
  await prepareTeacherBattle(page, "summer_teacher");

  await page.locator("#playerProfessorLane .board-card").click();
  await expect(page.locator("#teacherActionModal")).toBeHidden();
});

test("講義の試験変更ポップアップはホームで一度だけ表示する", async ({ page }) => {
  await page.addInitScript(() => {
    window.__forceLectureExperimentNotice = true;
  });
  await page.goto(gameUrl);

  const notice = page.locator("#lectureExperimentNoticeModal");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("これは一旦試しの仕様です");
  await page.locator("#lectureExperimentNoticeCloseButton").click();
  await expect(notice).toBeHidden();

  await page.reload();
  await expect(notice).toBeHidden();
});

test("更新情報に講義操作の試験変更を表示する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeUpdatesButton").click();
  const update = page.locator(".update-entry", { hasText: "ver.0.22.0" }).first();
  await update.locator("summary").click();
  const change = update.locator(".update-change", { hasText: "講義の操作（テスト）" });
  await expect(change).toContainText("攻撃する");
  await expect(change).toContainText("講義を行う");
  await expect(change).toContainText("初回の1回だけ表示");
});
