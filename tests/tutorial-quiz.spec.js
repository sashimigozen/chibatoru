const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const hand = (page, id) => page.locator(`#playerHand [data-base-id="${id}"]`).first();
const slot = (page, owner, zone, index = null) => page.locator(
  `.slot[data-owner="${owner}"][data-zone="${zone}"][data-index="${index ?? ""}"]`);
const board = (page, owner, id) => page.locator(`#${owner}BoardPanel [data-base-id="${id}"]`).first();

async function openQuiz(page, chapter) {
  await page.goto(gameUrl);
  // 本番と同じ初期化入口。練習からのUI遷移はtutorial-abilities.spec.jsで全編を検証する。
  await page.evaluate((id) => window.__chibattle.startTutorialBattle(id, { stage: "quiz" }), chapter);
  await expect(page.locator("#tutorialStepCounter")).toHaveText("2/3");
  await page.locator("#tutorialToggleButton").click();
}

async function play(page, id, zone = "seat", index = 4) {
  await hand(page, id).click();
  await (zone === "environment" ? page.locator("#environmentSlot")
    : slot(page, "player", zone, zone === "seat" ? index : null)).click();
  await expect.poll(() => page.evaluate(() => !window.__chibattle.state.pendingCardPlay
    && !window.__chibattle.state.resolvingOrderedAttendance)).toBe(true);
}

async function attack(page, id, target = null, occurrence = 0) {
  await page.locator(`#playerBoardPanel [data-base-id="${id}"]`).nth(occurrence).click();
  if (await page.locator("#teacherActionModal").isVisible()) await page.locator("#teacherAttackChoiceButton").click();
  await (target ? board(page, "opponent", target) : page.locator("#opponentLifeTarget")).click({ force: true });
  await expect.poll(() => page.evaluate(() => !window.__chibattle.state.attackInProgress)).toBe(true);
}

async function drag(page, id, target, position = null) {
  const from = await hand(page, id).boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 16);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width * (position?.x ?? .5), to.y + to.height * (position?.y ?? .5), { steps: 16 });
  await page.mouse.up();
  if (await page.locator("#itemTargetConfirmButton").isVisible()) await page.locator("#itemTargetConfirmButton").click();
}
const itemOn = (page, id, owner, zone, index = null) => drag(page, id, slot(page, owner, zone, index));
const itemBody = (page, id) => drag(page, id, page.locator("#opponentLifeTarget"));
const immediate = (page, id) => drag(page, id, page.locator(".playmat"), { x: .95, y: .12 });

async function fuse(page) {
  await hand(page, "ruler").click();
  await page.locator("[data-preview-ruler-fuse]").click();
  await page.locator("#threeGesturesHand button").first().click();
  await page.locator("#threeGesturesConfirmButton").click();
}

const solutions = {
  placement: async (p) => {
    await play(p, "student_comedy");
    await attack(p, "general_student");
    await attack(p, "general_student", null, 1);
  },
  lecture: async (p) => {
    await play(p, "general_teacher", "teacher");
    await slot(p, "player", "teacher").click();
    await p.locator("#teacherLectureChoiceButton").click();
    await attack(p, "strong_student");
  },
  cheerful: async (p) => {
    await play(p, "zombie");
    await attack(p, "zombie", "ae_student");
    await play(p, "aggro_princess", "seat", 5);
    await attack(p, "aggro_princess");
    await attack(p, "general_student");
  },
  attention: async (p) => {
    await itemOn(p, "ruler", "opponent", "seat", 0);
    await itemOn(p, "ruler", "opponent", "seat", 0);
    await attack(p, "general_student", "ae_student");
    await attack(p, "strong_student");
  },
  late: async (p) => {
    await play(p, "no_late_time", "environment");
    await play(p, "eaten_student");
    await attack(p, "eaten_student");
  },
  sleepy: async (p) => {
    await itemOn(p, "seriously_hit", "opponent", "teacher");
    await attack(p, "strong_student");
  },
  composure: async (p) => {
    await attack(p, "yuta", "college_student_vibe");
    await itemOn(p, "destructive_lie", "player", "seat", 4);
    await itemOn(p, "earphones", "player", "seat", 8);
    await play(p, "yocchan", "seat", 4);
    await attack(p, "yocchan");
    await attack(p, "general_student");
  },
  equipment: async (p) => {
    await itemOn(p, "earphones", "player", "seat", 4);
    await attack(p, "yuta", "college_student_vibe");
    await attack(p, "general_student");
  },
  drain: async (p) => {
    await attack(p, "apprentice_vampire", "college_student_vibe");
    await expect(board(p, "player", "apprentice_vampire")).toBeVisible();
    await itemOn(p, "destructive_lie", "player", "seat", 4);
    await itemOn(p, "earphones", "player", "seat", 8);
    await play(p, "yocchan", "seat", 4);
    await attack(p, "yocchan");
    await attack(p, "general_student");
  },
  evolution: async (p) => {
    await play(p, "dark_yuta");
    await play(p, "single_cell", "seat", 1);
    await expect(board(p, "player", "midge")).toBeVisible();
    await expect(board(p, "opponent", "super_ae_student")).toHaveCount(0);
    await attack(p, "dark_yuta");
  },
  fusion: async (p) => {
    await fuse(p);
    await itemBody(p, "double_diamond");
  },
  load: async (p) => {
    await expect(hand(p, "grudge")).toHaveClass(/hand-high-load/);
    await expect(hand(p, "ruler")).toHaveClass(/hand-load/);
    await immediate(p, "full_throttle");
    await expect(p.locator("#threeGesturesHand button")).toHaveCount(1);
    await expect(p.locator("#threeGesturesHand")).not.toContainText("怨念");
    await p.locator("#threeGesturesHand button").click();
    await p.locator("#threeGesturesConfirmButton").click();
    await immediate(p, "grudge");
    await play(p, "yocchan");
    await attack(p, "yocchan");
  }
};

const decoys = {
  placement: "general_student", lecture: "diligent_student", cheerful: "general_student",
  attention: "general_student", late: "hurried_student", sleepy: "diligent_student",
  composure: "general_student", equipment: "general_student", drain: "general_student",
  evolution: "aggro_student", fusion: "general_student", load: "general_student"
};

for (const [chapter, solve] of Object.entries(solutions)) {
  test(`${chapter}：初期手札・盤面を変更せず通常操作で自分のターン中に解ける`, async ({ page }) => {
    test.setTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openQuiz(page, chapter);
    expect(await page.evaluate(() => window.__chibattle.state.players.player.deck
      .every(c => c.baseId === "suspicious_document" && c.unusable))).toBe(true);
    expect(await page.evaluate(() => window.__chibattle.state.players.player.hand.map(c => c.baseId)))
      .toHaveLength(["load", "composure", "drain"].includes(chapter) ? 5 : 3);
    await expect(hand(page, decoys[chapter])).toBeVisible();
    await solve(page);
    await expect(page.locator("#resultOverlay")).toContainText("勝利");
    expect(await page.evaluate(() => {
      const s = window.__chibattle.state;
      return { winner: s.gameWinner, side: s.currentSide, turn: s.actionTurn, stage: s.tutorial.stage };
    })).toEqual({ winner: "player", side: "player", turn: 1, stage: "quiz" });
    expect(await page.evaluate((id) => window.__chibattle.state.players.player.hand.some(c => c.baseId === id), decoys[chapter])).toBe(true);
    await page.locator("[data-result-tutorial-back]").click();
    await expect(page.locator("#tutorialScreen")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("引っ掛けの学生を出席させても即攻撃できず、再挑戦で手札が戻る", async ({ page }) => {
  await openQuiz(page, "fusion");
  await play(page, "general_student");
  expect(await page.evaluate(() => {
    const s = window.__chibattle.state;
    return { will: s.players.player.will, life: s.players.opponent.life, over: s.gameOver };
  })).toEqual({ will: 0, life: 4, over: false });
  await attack(page, "general_student");
  expect(await page.evaluate(() => window.__chibattle.state.players.opponent.life)).toBe(4);
  await page.locator("#endTurnButton").click();
  await expect(page.locator("#resultOverlay")).toContainText("失敗");
  await page.locator("[data-result-tutorial-retry]").click();
  expect(await page.evaluate(() => window.__chibattle.state.players.player.hand.map(c => c.baseId)))
    .toEqual(["ruler", "ruler", "general_student"]);
});

test("基本編と全12編の練習の初期手札は変えない", async ({ page }) => {
  await page.goto(gameUrl);
  const expected = {
    basic: ["general_student", "general_teacher", "vampire", "ruler", "cafeteria"],
    placement: ["diligent_student", "general_teacher", "cafeteria"],
    lecture: ["general_student", "ruler"], cheerful: ["zombie", "aggro_princess"],
    attention: ["ruler", "ruler"], late: ["hurried_student"], sleepy: ["general_student", "ruler"],
    composure: ["general_student", "ruler"], equipment: ["earphones"], drain: ["general_student", "ruler"],
    evolution: ["dark_yuta", "single_cell"], fusion: ["ruler", "ruler"], load: ["white_student", "ruler", "cafeteria"]
  };
  for (const [chapter, cards] of Object.entries(expected)) {
    const handIds = await page.evaluate((id) => {
      window.__chibattle.startTutorialBattle(id);
      return window.__chibattle.state.players.player.hand.map(c => c.baseId);
    }, chapter);
    expect(handIds).toEqual(cards);
  }
});

test("融合を使わず定規を単独使用しても勝てず、失敗から状態をリセットできる", async ({ page }) => {
  await openQuiz(page, "fusion");
  await itemBody(page, "ruler");
  await itemBody(page, "ruler");
  expect(await page.evaluate(() => window.__chibattle.state.players.opponent.life)).toBe(2);
  // 攻撃・使用可能カードがなくなった際の推奨パルスで、安定待ちが続かないようにする。
  await page.locator("#endTurnButton").click({ force: true });
  await expect(page.locator("#resultOverlay")).toContainText("失敗");
  await page.locator("[data-result-tutorial-retry]").click();
  await expect(page.locator("#tutorialStepCounter")).toHaveText("2/3");
  expect(await page.evaluate(() => {
    const p = window.__chibattle.state.players.player;
    return { hand: p.hand.map((c) => c.baseId), will: p.will, trash: p.trash.length };
  })).toEqual({ hand: ["ruler", "ruler", "general_student"], will: 2, trash: 0 });
  await page.locator("#tutorialToggleButton").click();
  await solutions.fusion(page);
  await expect(page.locator("#resultOverlay")).toContainText("勝利");
});

test("眠気の原因を除去した正解は、眠気の乱数が必ず失敗する値でも成功する", async ({ page }) => {
  await openQuiz(page, "sleepy");
  await page.evaluate(() => { Math.random = () => 0; });
  await solutions.sleepy(page);
  await expect(page.locator("#resultOverlay")).toContainText("勝利");
});

for (const chapter of ["composure", "drain"]) {
  test(`${chapter}：吸血・余裕で反撃を耐える手順を飛ばすと、文書を引いても勝てない`, async ({ page }) => {
    await openQuiz(page, chapter);
    await itemOn(page, "destructive_lie", "player", "seat", 4);
    await itemOn(page, "earphones", "player", "seat", 8);
    await play(page, "yocchan", "seat", 4);
    await attack(page, "yocchan", "college_student_vibe");
    await attack(page, "general_student", await board(page, "opponent", "college_student_vibe").count() ? "college_student_vibe" : null);
    expect(await page.evaluate(() => window.__chibattle.state.gameWinner)).not.toBe("player");
    await page.locator("#endTurnButton").click({ force: true });
    await expect(page.locator("#resultOverlay")).toContainText("失敗");
  });
}

test("負荷編も相手のターンに移ったら失敗し、相手の負荷ダメージまで待たない", async ({ page }) => {
  await openQuiz(page, "load");
  await page.locator("#endTurnButton").click();
  await expect(page.locator("#resultOverlay")).toContainText("失敗");
  expect(await page.evaluate(() => {
    const s = window.__chibattle.state;
    return { opponentTurns: s.players.opponent.turnsTaken, life: s.players.opponent.life, ownLife: s.players.player.life };
  })).toEqual({ opponentTurns: 0, life: 4, ownLife: 17 });
});

test("相手のターン開始時に発動する効果で期限を超えて勝つことはできない", async ({ page }) => {
  await openQuiz(page, "fusion");
  await page.evaluate(() => {
    const a = window.__chibattle;
    const c = a.makeBoardCard(a.createCardFromBase("ninety_three_teacher", "player"));
    a.state.players.player.board.teacher = c;
    a.state.players.opponent.life = 1;
    a.render();
  });
  await page.locator("#endTurnButton").click();
  await expect(page.locator("#resultOverlay")).toContainText("失敗");
  expect(await page.evaluate(() => window.__chibattle.state.players.opponent.life)).toBe(1);
});

test("自分のターン終了時に勝利した場合は成功し、相手のターンを開始しない", async ({ page }) => {
  await openQuiz(page, "fusion");
  await page.evaluate(() => {
    window.__chibattle.state.players.player.crabCountdown = 1;
    window.__chibattle.render();
  });
  await page.locator("#endTurnButton").click();
  await expect(page.locator("#resultOverlay")).toHaveClass(/victory/);
  expect(await page.evaluate(() => {
    const s = window.__chibattle.state;
    return { winner: s.gameWinner, opponentTurns: s.players.opponent.turnsTaken };
  })).toEqual({ winner: "player", opponentTurns: 0 });
});

test("負荷による自分の敗北も失敗と表示され、再挑戦で気力を戻せる", async ({ page }) => {
  await openQuiz(page, "load");
  await page.evaluate(() => {
    window.__chibattle.state.players.player.life = 2;
    window.__chibattle.render();
  });
  await page.locator("#endTurnButton").click();
  await expect(page.locator("#resultOverlay")).toContainText("失敗");
  await page.locator("[data-result-tutorial-retry]").click();
  await expect(page.locator("#tutorialStepCounter")).toHaveText("2/3");
  expect(await page.evaluate(() => window.__chibattle.state.players.player.life)).toBe(20);
});

test("クイズの説明切替・再挑戦ボタンの固定・終了・基本編の再開", async ({ page }) => {
  await openQuiz(page, "fusion");
  await page.locator("#tutorialToggleButton").click();
  const box = await page.locator("#tutorialNextButton").boundingBox();
  await itemBody(page, "ruler");
  expect(await page.locator("#tutorialNextButton").boundingBox()).toEqual(box);
  await page.screenshot({ path: test.info().outputPath("quiz.png") });
  await page.locator("#tutorialNextButton").click();
  await expect(page.locator("#tutorialStepCounter")).toHaveText("2/3");
  await expect(hand(page, "ruler")).toHaveCount(1);
  expect(await page.evaluate(() => window.__chibattle.state.players.player.hand.length)).toBe(3);
  await page.locator("#tutorialExitButton").click();
  await page.locator('[data-tutorial-chapter="basic"]').click();
  await page.locator("#tutorialStartButton").click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("基本編：練習を始めよう");
  expect(await page.evaluate(() => window.__chibattle.state.tutorial.stage)).toBe("practice");
});
