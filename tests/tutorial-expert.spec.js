const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const hand = (p, id) => p.locator(`#playerHand [data-base-id="${id}"]`).first();
const slot = (p, owner, zone, index = null) => p.locator(`.slot[data-owner="${owner}"][data-zone="${zone}"][data-index="${index ?? ""}"]`);
async function open(p, chapter) {
  await p.goto(gameUrl);
  await p.evaluate(id => window.__chibattle.startTutorialBattle(id, { stage: "expert" }), chapter);
  await expect(p.locator("#tutorialStepCounter")).toHaveText("3/3");
  await p.locator("#tutorialToggleButton").click();
}
async function play(p, id, index = 4, zone = "seat") {
  await hand(p, id).click();
  await (zone === "environment" ? p.locator("#environmentSlot") : slot(p, "player", zone, zone === "seat" ? index : null)).click();
  await expect.poll(() => p.evaluate(() => !window.__chibattle.state.pendingCardPlay && !window.__chibattle.state.resolvingOrderedAttendance)).toBe(true);
}
async function attack(p, id, target = null, occurrence = 0) {
  await p.locator(`#playerBoardPanel [data-base-id="${id}"]`).nth(occurrence).click();
  if (await p.locator("#teacherActionModal").isVisible()) await p.locator("#teacherAttackChoiceButton").click();
  await (target ? slot(p, "opponent", target.zone || "seat", target.index ?? null) : p.locator("#opponentLifeTarget")).click({ force: true });
  await expect.poll(() => p.evaluate(() => !window.__chibattle.state.attackInProgress)).toBe(true);
}
async function drag(p, id, target, position = { x: .5, y: .5 }) {
  const from = await hand(p, id).boundingBox();
  const to = await target.boundingBox();
  await p.mouse.move(from.x + from.width / 2, from.y + 16);
  await p.mouse.down();
  await p.mouse.move(to.x + to.width * position.x, to.y + to.height * position.y, { steps: 16 });
  await p.mouse.up();
  if (await p.locator("#itemTargetConfirmButton").isVisible()) await p.locator("#itemTargetConfirmButton").click();
}
const item = (p, id, owner, index, zone = "seat") => drag(p, id, slot(p, owner, zone, zone === "seat" ? index : null));
const face = (p, id) => drag(p, id, p.locator("#opponentLifeTarget"));
const immediate = (p, id) => drag(p, id, p.locator(".playmat"), { x: .95, y: .12 });
async function fuse(p) {
  await hand(p, "ruler").click();
  await p.locator("[data-preview-ruler-fuse]").click();
  await p.locator("#threeGesturesHand button").first().click();
  await p.locator("#threeGesturesConfirmButton").click();
}
async function lecture(p) {
  await slot(p, "player", "teacher").click();
  await p.locator("#teacherLectureChoiceButton").click();
}
async function end(p) {
  // 推奨のパルス表示で安定待ちを続けない。実際のクリックからターンを終了する。
  await p.locator("#endTurnButton").click({ force: true });
  if (await p.locator("#threeGesturesStage").isVisible()) {
    await expect(p.locator("#threeGesturesTitle")).toContainText("校外エリアへ送る");
    await p.locator("#threeGesturesHand button").first().click();
    await p.locator("#threeGesturesConfirmButton").click();
  }
}
// 解答はテスト側のみ。問題開始後は状態へ手を加えず、すべて通常UIから操作する。
const solutions = {
  placement: async (p, mistake = false) => {
    await attack(p, "yuta", { index: 0 });
    await item(p, "destructive_lie", "player", mistake ? 0 : 4);
    await play(p, "student_comedy", mistake ? 0 : 4);
    await face(p, "ruler");
    for (let i = 0; i < (mistake ? 3 : 4); i++) await attack(p, "general_student", null, i);
  },
  lecture: async p => {
    await item(p, "ruler", "opponent", 8);
    await item(p, "ruler", "opponent", 8);
    await item(p, "destructive_lie", "player", null, "teacher");
    await fuse(p);
    await item(p, "double_diamond", "opponent", 0);
    await play(p, "general_teacher", null, "teacher");
    await lecture(p);
    await attack(p, "strong_student");
  },
  cheerful: async (p, mistake = false) => {
    await attack(p, "zombie", { index: 0 });
    await play(p, "zombie", 5);
    await attack(p, "zombie", { index: 2 }, 1);
    await play(p, "aggro_princess", 6);
    if (!mistake) await attack(p, "aggro_princess");
    await item(p, "go_home", "player", 6);
    await play(p, "aggro_princess", 6);
    await attack(p, "aggro_princess");
    await attack(p, "strong_student");
  },
  attention: async p => {
    await item(p, "ruler", "opponent", 0);
    await item(p, "ruler", "opponent", 0);
    await fuse(p);
    await item(p, "double_diamond", "opponent", 1);
    await attack(p, "trendy_student", { index: 2 });
    await attack(p, "trendy_student", { index: 8 });
    await attack(p, "trendy_student");
    await attack(p, "strong_student");
  },
  late: async p => {
    await play(p, "eaten_student", 5);
    await play(p, "no_late_time", null, "environment");
    await attack(p, "hurried_student", { index: 0 });
    await attack(p, "general_student", { index: 0 });
    await attack(p, "yuta");
    await attack(p, "eaten_student");
  },
  sleepy: async p => {
    await item(p, "destructive_lie", "player", null, "teacher");
    await item(p, "seriously_hit", "opponent", null, "teacher");
    await item(p, "ruler", "opponent", 0);
    await attack(p, "general_student", { index: 0 });
    await item(p, "red_happi", "player", 4);
    await attack(p, "yuta");
    await play(p, "aggro_princess", 5);
    await attack(p, "aggro_princess");
  },
  composure: async (p, mistake = false) => {
    if (!mistake) await attack(p, "yuta", { index: 0 });
    await item(p, "destructive_lie", "player", 4);
    await face(p, "ruler");
    await face(p, "ruler");
    await item(p, "earphones", "player", 8);
    await play(p, "yocchan", 4);
    await attack(p, "yocchan");
    await attack(p, "general_student");
  },
  equipment: async (p, mistake = false) => {
    await item(p, "ruler", "opponent", 0);
    await item(p, "ruler", "opponent", 0);
    await item(p, "destructive_lie", "player", null, "teacher");
    await fuse(p);
    await item(p, "double_diamond", "opponent", 1);
    await item(p, "earphones", "player", 4);
    await attack(p, "yuta", { index: 2 });
    await item(p, "red_happi", "player", mistake ? 4 : 8);
    await attack(p, "yuta", null, 1);
    await play(p, "aggro_princess", 5);
    await attack(p, "aggro_princess");
  },
  drain: async (p, mistake = false) => {
    if (mistake) await face(p, "ruler");
    else await item(p, "ruler", "opponent", 0);
    await attack(p, "apprentice_vampire", { index: 0 });
    await expect(p.locator('#playerBoardPanel [data-base-id="apprentice_vampire"]')).toBeVisible();
    await item(p, "destructive_lie", "player", 4);
    await face(p, "ruler");
    await item(p, "earphones", "player", 8);
    await play(p, "yocchan", 4);
    await attack(p, "yocchan");
    await attack(p, "general_student");
  },
  evolution: async p => {
    await item(p, "red_happi", "player", 8);
    await play(p, "dark_yuta", 8);
    for (let i = 0; i < 6; i++) {
      const index = await p.evaluate(() => window.__chibattle.state.players.player.board.seats.findIndex(c => !c));
      await play(p, "single_cell", index);
    }
    await expect(p.locator('#playerBoardPanel [data-base-id="perfect_mutant"]')).toBeVisible();
    await attack(p, "dark_yuta");
    await attack(p, "perfect_mutant");
  },
  fusion: async p => {
    await item(p, "ruler", "opponent", 0);
    await item(p, "ruler", "opponent", 0);
    await fuse(p);
    await item(p, "double_diamond", "opponent", 1);
    await item(p, "earphones", "player", null, "teacher");
    await attack(p, "wood_gitch", { index: 2 });
    await immediate(p, "grudge");
    await play(p, "yocchan", 4);
    await attack(p, "yocchan");
  },
  load: async (p, mistake = false) => {
    await expect(hand(p, "grudge")).toHaveClass(/hand-high-load/);
    await immediate(p, "full_throttle");
    await expect(p.locator("#threeGesturesHand")).not.toContainText("怨念");
    await p.locator('#threeGesturesHand button').nth(0).click();
    await p.locator('#threeGesturesHand button').nth(1).click();
    if (mistake) await p.locator('#threeGesturesHand button').nth(2).click();
    await p.locator("#threeGesturesConfirmButton").click();
    await item(p, "earphones", "player", 4);
    if (!mistake) {
      await attack(p, "yuta", { index: 0 });
      await face(p, "ruler");
    }
    await immediate(p, "grudge");
    await play(p, "yocchan", 5);
    await attack(p, "yocchan");
  }
};
for (const [chapter, solve] of Object.entries(solutions)) {
  test(`${chapter}超難問：初期状態のまま通常操作で確定リーサル`, async ({ page }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await open(page, chapter);
    // ランダム対象がある問題も、極端な乱数で正解が変わらない。
    await page.evaluate(() => { Math.random = () => .99999; });
    await solve(page);
    if (!await page.evaluate(() => window.__chibattle.state.gameOver)) {
      console.log(chapter, await page.evaluate(() => {
        const s = window.__chibattle.state;
        return { message: s.message, log: s.log.slice(0, 20), will: s.players.player.will, life: s.players.opponent.life,
          board: s.players.opponent.board, hand: s.players.player.hand.map(c => c.baseId) };
      }));
    }
    await expect(page.locator("#resultOverlay")).toContainText("勝利");
    expect(await page.evaluate(() => {
      const s = window.__chibattle.state;
      return { winner: s.gameWinner, side: s.currentSide, turn: s.actionTurn, stage: s.tutorial.stage, will: s.players.player.will };
    })).toEqual({ winner: "player", side: "player", turn: 1, stage: "expert", will: 0 });
    const decoy = ({ placement: "bento", lecture: "seriously_hit", late: "bento", sleepy: "bento", composure: "bento", drain: "bento" })[chapter] || "general_student";
    expect(await page.evaluate(id => window.__chibattle.state.players.player.hand.some(c => c.baseId === id), decoy)).toBe(true);
    expect(errors).toEqual([]);
  });
  test(`${chapter}超難問：相手へターンが返ると失敗、再挑戦も超難問の同じ状態`, async ({ page }) => {
    await open(page, chapter);
    const snapshot = () => page.evaluate(() => {
      const s = window.__chibattle.state;
      return { player: s.players.player, opponent: s.players.opponent, stage: s.tutorial.stage };
    });
    const initial = await snapshot();
    await end(page);
    await expect(page.locator("#resultOverlay")).toContainText("失敗");
    await page.locator("[data-result-tutorial-retry]").click();
    expect(await snapshot()).toEqual(initial);
    await expect(page.locator("#tutorialStepCounter")).toHaveText("3/3");
    await page.locator("#tutorialNextButton").click();
    expect(await snapshot()).toEqual(initial);
  });
}

const mistakes = {
  placement: p => solutions.placement(p, true),
  lecture: p => item(p, "destructive_lie", "player", 4),
  cheerful: p => solutions.cheerful(p, true),
  attention: p => attack(p, "strong_student", { index: 0 }),
  late: p => item(p, "bento", "player", 4),
  sleepy: p => item(p, "destructive_lie", "player", 4),
  composure: p => solutions.composure(p, true),
  equipment: p => solutions.equipment(p, true),
  drain: p => solutions.drain(p, true),
  evolution: async p => {
    await attack(p, "single_cell", { index: 0 });
    await item(p, "red_happi", "player", 8);
    await play(p, "dark_yuta", 8);
    for (let i = 0; i < 6; i++) {
      const index = await p.evaluate(() => window.__chibattle.state.players.player.board.seats.findIndex(c => !c));
      await play(p, "single_cell", index);
    }
    await expect(p.locator('#playerBoardPanel [data-base-id="perfect_mutant"]')).toHaveCount(0);
  },
  fusion: async p => {
    await item(p, "ruler", "opponent", 0);
    await item(p, "ruler", "opponent", 0);
    await item(p, "ruler", "opponent", 1);
    await item(p, "ruler", "opponent", 1);
    await item(p, "earphones", "player", null, "teacher");
    await attack(p, "wood_gitch", { index: 1 });
    await immediate(p, "grudge");
    await play(p, "yocchan", 4);
    await attack(p, "yocchan", { index: 1 });
  },
  load: p => solutions.load(p, true)
};
for (const [chapter, makeMistake] of Object.entries(mistakes)) {
  test(`${chapter}超難問：重要な配置・順番・対象を誤ると勝利にならない`, async ({ page }) => {
    test.setTimeout(60000);
    await open(page, chapter);
    await makeMistake(page);
    expect(await page.evaluate(() => window.__chibattle.state.gameWinner)).not.toBe("player");
    await end(page);
    await expect(page.locator("#resultOverlay")).toContainText("失敗");
  });
}

test("乱数の反対端でも進化・負荷の解答が成立する", async ({ page }) => {
  test.setTimeout(60000);
  for (const chapter of ["evolution", "load"]) {
    await open(page, chapter);
    await page.evaluate(() => { Math.random = () => 0; });
    await solutions[chapter](page);
    await expect(page.locator("#resultOverlay")).toContainText("勝利");
  }
});
