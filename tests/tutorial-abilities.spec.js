const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

const slot = (page, owner, zone = "seat", index = 4) => page.locator(
  `.slot[data-owner="${owner}"][data-zone="${zone}"][data-index="${zone === "seat" ? index : ""}"]`);
const hand = (page, baseId) => page.locator(`#playerHand [data-base-id="${baseId}"]`).first();
const board = (page, owner, baseId) => page.locator(`#${owner}BoardPanel [data-base-id="${baseId}"]`).first();
const play = (baseId, zone = "seat", index = 4) => async (page) => {
  await hand(page, baseId).click();
  await (zone === "environment" ? page.locator("#environmentSlot") : slot(page, "player", zone, index)).click();
};
const attack = (baseId, targetBaseId) => async (page) => {
  await board(page, "player", baseId).click();
  await board(page, "opponent", targetBaseId).click();
};
const item = (baseId, owner, index) => async (page) => {
  // 手札は画面下で切れることがあるため、見えている上部から通常のドラッグを行う。
  const source = await hand(page, baseId).boundingBox();
  const target = await slot(page, owner, "seat", index).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + 16);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 16 });
  await page.mouse.up();
};
const endTurn = async (page) => page.locator("#endTurnButton").click();

const chapters = [
  { id: "placement", title: "配置編", actions: {
    "指定された行に出席しよう": play("diligent_student", "seat", 1),
    "教卓マスに出席しよう": play("general_teacher", "teacher"),
    "環境マスに出席しよう": play("cafeteria", "environment")
  }, check: (s) => s.players.player.board.seats[1]?.baseId === "diligent_student"
    && s.players.player.board.teacher?.baseId === "general_teacher" && s.environment?.baseId === "cafeteria" },
  { id: "lecture", title: "講義編", actions: {
    "講義を選ぼう": async (page) => {
      await slot(page, "player", "teacher").click();
      await expect(page.locator("#teacherAttackChoiceButton")).toBeDisabled();
      await page.locator("#teacherLectureChoiceButton").click();
    }
  }, check: (s) => s.players.opponent.board.seats[0] === null
    && s.players.opponent.board.seats[1]?.currentHp === 1 && s.players.player.board.teacher?.hasAttacked },
  { id: "cheerful", title: "陽気編", actions: {
    "陽気を持つカードを出席させよう": play("zombie"),
    "出席したターンに攻撃しよう": attack("zombie", "aggro_student"),
    "超陽気を持つカードを出席させよう": play("aggro_princess", "seat", 5),
    "出席したターンに本体を攻撃しよう": async (page) => {
      await board(page, "player", "aggro_princess").click();
      await page.locator("#opponentLifeTarget").click({ force: true });
    }
  }, check: (s) => s.players.opponent.life === 2 && s.players.opponent.board.seats[0] === null
    && s.players.player.board.seats[5]?.hasAttacked },
  { id: "attention", title: "注目編", actions: {
    "超注目を指名しよう": item("ruler", "opponent", 1),
    "超注目を解除しよう": item("ruler", "opponent", 1),
    "注目を攻撃しよう": attack("strong_student", "ae_student")
  }, check: (s) => s.players.opponent.board.seats.every((card) => !card)
    && s.players.player.trash.filter((card) => card.baseId === "ruler").length === 2 },
  { id: "late", title: "遅刻編", actions: {
    "遅刻カードの出席先を選ぼう": play("hurried_student"),
    "次のターンを迎えよう": endTurn,
    "遅刻から出席したカードで攻撃しよう": attack("hurried_student", "aggro_student")
  }, check: (s) => s.players.player.late.length === 0 && s.players.player.board.seats[4]?.baseId === "hurried_student"
    && s.players.opponent.board.seats[0] === null },
  { id: "sleepy", title: "眠気編", actions: {
    "眠気を持つ出席者で攻撃しよう": attack("strong_student", "general_student")
  }, check: (s) => s.players.player.board.seats[4]?.hasAttacked },
  { id: "composure", title: "余裕編", actions: {
    "ターンを終了して回復しよう": endTurn
  }, check: (s) => s.players.player.board.seats[4]?.currentHp === 2 && s.players.player.life === 20 },
  { id: "equipment", title: "装備編", actions: {
    "イヤホンを装備しよう": item("earphones", "player", 4),
    "装備したU太で攻撃しよう": attack("yuta", "aggro_student")
  }, check: (s) => s.players.player.board.seats[4]?.earphoneEquipment?.baseId === "earphones"
    && s.players.opponent.board.seats[0] === null },
  { id: "drain", title: "吸血編", actions: {
    "ヴァンパイアで攻撃しよう": attack("apprentice_vampire", "super_ae_student")
  }, check: (s) => s.players.player.board.seats[4]?.currentHp === 2
    && s.players.player.life === 20 && s.players.opponent.board.seats[0] === null },
  { id: "evolution", title: "進化編", actions: {
    "U太を進化させよう": play("dark_yuta"),
    "特殊進化の条件を満たそう": play("single_cell", "seat", 1)
  }, check: (s) => s.players.player.board.seats[4]?.baseId === "dark_yuta"
    && s.players.player.board.seats[4]?.currentHp === 4
    && s.players.player.board.seats[0]?.baseId === "midge" && s.players.player.board.seats[1] === null },
  { id: "fusion", title: "融合編", actions: {
    "定規を融合しよう": async (page) => {
      await hand(page, "ruler").click();
      await page.locator("[data-preview-ruler-fuse]").click();
      await page.locator("#threeGesturesHand button").first().click();
      await page.locator("#threeGesturesConfirmButton").click();
    },
    "融合したカードを使おう": item("double_diamond", "opponent", 0)
  }, check: (s) => s.players.player.trash.filter((card) => card.baseId === "ruler").length === 2
    && s.players.player.trash.some((card) => card.baseId === "double_diamond")
    && s.players.opponent.board.seats[0]?.currentHp === 3 },
  { id: "load", title: "負荷編", actions: {
    "負荷を高負荷にしよう": play("white_student"),
    "負荷のダメージを確認しよう": endTurn
  }, check: (s) => s.players.player.life === 17 && s.players.opponent.life === 2
    && s.players.opponent.hand.some((card) => card.handLoadLevel === 2) }
];

async function openChapter(page, chapter) {
  await page.goto(gameUrl);
  await page.locator("#homeNavSoloButton").click();
  await page.locator("#soloTutorialButton").click();
  await page.locator(`[data-tutorial-chapter="${chapter.id}"]`).click();
  await page.locator("#tutorialStartButton").click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText(`${chapter.title}：練習を始めよう`);
}

const layout = (page) => page.evaluate(() => ["tutorialCoach", "tutorialNextButton"].map((id) => {
  const r = document.getElementById(id).getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}));
const snapshot = (page) => page.evaluate(() => {
  const s = window.__chibattle.state;
  const card = (c) => c && ({ id: c.instanceId, base: c.baseId, hp: c.currentHp, used: c.hasAttacked,
    load: c.handLoadLevel, equipment: c.earphoneEquipment?.baseId });
  const player = (p) => ({ life: p.life, will: p.will, hand: p.hand.map(card), deck: p.deck.map((c) => c.instanceId),
    seats: p.board.seats.map(card), teacher: card(p.board.teacher), late: p.late, trash: p.trash.map(card) });
  return { player: player(s.players.player), opponent: player(s.players.opponent),
    environment: card(s.environment), side: s.currentSide, turn: s.actionTurn };
});

for (const chapter of chapters) {
  test(`${chapter.title}：練習・結果・一つ戻る・クイズへの遷移・失敗と再挑戦`, async ({ page }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openChapter(page, chapter);
    const fixed = await layout(page);
    let testedUndo = false;
    let completedActions = 0;
    for (let step = 0; step < 24; step += 1) {
      const title = await page.locator("#tutorialCoachTitle").textContent();
      await expect.poll(() => layout(page)).toEqual(fixed);
      await expect(page.locator("#tutorialCoachText")).not.toContainText(/今回は|練習用|気力が2/);
      if (chapter.id === "evolution") await expect(page.locator("#tutorialCoachTitle")).not.toHaveText("特殊進化のつながり");
      if (title === "リーサルクイズに挑戦しよう") break;
      const action = chapter.actions[title];
      if (!action) {
        await expect(page.locator("#tutorialNextButton")).toBeVisible();
        await page.locator("#tutorialNextButton").click();
        continue;
      }
      await expect(page.locator("#tutorialNextButton")).toBeHidden();
      const before = await snapshot(page);
      await action(page);
      await expect(page.locator("#tutorialCoachTitle")).not.toHaveText(title);
      await expect.poll(() => page.evaluate(() => {
        const s = window.__chibattle.state;
        return s.currentSide === "player" && !s.aiThinking && !s.attackInProgress;
      })).toBe(true);
      if (!testedUndo) {
        await page.locator("#tutorialBackStepButton").click();
        await expect(page.locator("#tutorialCoachTitle")).toHaveText(title);
        expect(await snapshot(page)).toEqual(before);
        await action(page);
        await expect(page.locator("#tutorialCoachTitle")).not.toHaveText(title);
        testedUndo = true;
      }
      completedActions += 1;
    }
    expect(completedActions).toBe(Object.keys(chapter.actions).length);
    await expect(page.locator("#tutorialCoachTitle")).toHaveText("リーサルクイズに挑戦しよう");
    await expect.poll(async () => chapter.check(await page.evaluate(() => ({
      players: window.__chibattle.state.players, environment: window.__chibattle.state.environment
    })))).toBe(true);
    if (chapter.id === "load") {
      const damageLogs = await page.evaluate(() => window.__chibattle.state.log.filter((line) => /^\[(高負荷|負荷)\]/.test(line)));
      expect(damageLogs).toHaveLength(3);
      expect(damageLogs.some((line) => line.includes("[負荷]") && line.includes("1ダメージ"))).toBe(true);
      expect(damageLogs.filter((line) => line.includes("[高負荷]") && line.includes("2ダメージ"))).toHaveLength(2);
      expect(damageLogs.join("\n")).not.toMatch(/定規|食堂/);
    }
    await expect(page.locator("#tutorialCoachText")).toContainText("相手のターンになったら失敗");
    await page.screenshot({ path: test.info().outputPath(`${chapter.id}.png`) });
    await page.locator("#tutorialNextButton").click();
    await expect(page.locator("#tutorialCoachTitle")).toHaveText(`${chapter.title}：リーサルクイズ`);
    await expect(page.locator("#tutorialStepCounter")).toHaveText("2/2");
    const initial = await snapshot(page);
    await page.locator("#endTurnButton").click();
    await expect(page.locator("#resultOverlay")).toContainText("失敗");
    expect(await page.evaluate(() => window.__chibattle.state.players.opponent.turnsTaken)).toBe(0);
    await page.locator("[data-result-tutorial-retry]").click();
    await expect(page.locator("#tutorialCoachTitle")).toHaveText(`${chapter.title}：リーサルクイズ`);
    expect(await snapshot(page)).toEqual(initial);
    await page.locator("#endTurnButton").click();
    await page.locator("[data-result-tutorial-back]").click();
    await expect(page.locator("#tutorialScreen")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("眠気で攻撃に失敗しても結果確認へ進める", async ({ page }) => {
  await openChapter(page, chapters.find((chapter) => chapter.id === "sleepy"));
  await page.locator("#tutorialNextButton").click();
  await page.evaluate(() => { Math.random = () => 0; });
  await attack("strong_student", "general_student")(page);
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("眠気の結果");
  expect(await page.evaluate(() => window.__chibattle.state.players.opponent.board.seats[0].currentHp)).toBe(2);
  expect(await page.evaluate(() => window.__chibattle.state.players.player.board.seats[4].hasAttacked)).toBe(true);
});

test("負荷の初期表示と戦意、別の編へ切り替えたときのリセット", async ({ page }) => {
  await openChapter(page, chapters.find((chapter) => chapter.id === "load"));
  await expect(hand(page, "ruler")).toHaveClass(/hand-load(?!-high)/);
  await expect(hand(page, "cafeteria")).toHaveClass(/hand-high-load/);
  expect(await page.evaluate(() => {
    const api = window.__chibattle;
    const card = api.state.players.player.hand.find((entry) => entry.baseId === "cafeteria");
    return api.effectiveCardCost(card) - api.CARD_BASES.cafeteria.cost;
  })).toBe(1);
  await page.locator("#tutorialExitButton").click();
  await page.locator('[data-tutorial-chapter="lecture"]').click();
  await page.locator("#tutorialStartButton").click();
  await expect(page.locator("#tutorialCoachTitle")).toHaveText("講義編：練習を始めよう");
  expect(await page.evaluate(() => window.__chibattle.state.players.player.hand.map((card) => card.baseId))).toEqual(["general_student", "ruler"]);
});
