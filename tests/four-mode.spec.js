const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
});

test("オンラインメニューのチバトルふぉーは他のボタンと同じ色で準備中表示にする", async ({ page }) => {
  await page.locator("#homeBattleButton").click();
  const buttons = page.locator("#onlineMatchActions .online-match-button");
  await expect(buttons.nth(1)).toHaveAttribute("id", "onlinePrivateMatchButton");
  await expect(buttons.nth(2)).toHaveAttribute("id", "onlineFourMatchButton");
  const privateButton = page.locator("#onlinePrivateMatchButton");
  const fourButton = page.locator("#onlineFourMatchButton");
  await expect(fourButton).toBeDisabled();
  await expect(fourButton).toContainText("COMING SOON");
  await expect(fourButton).toContainText("現在準備中です");
  const colors = await page.evaluate(() => {
    const privateStyle = getComputedStyle(document.getElementById("onlinePrivateMatchButton"));
    const fourStyle = getComputedStyle(document.getElementById("onlineFourMatchButton"));
    return {
      privateBackground: privateStyle.backgroundColor,
      fourBackground: fourStyle.backgroundColor,
      privateBorder: privateStyle.borderColor,
      fourBorder: fourStyle.borderColor,
      privateColor: privateStyle.color,
      fourColor: fourStyle.color
    };
  });
  expect(colors.fourBackground).toBe(colors.privateBackground);
  expect(colors.fourBorder).toBe(colors.privateBorder);
  expect(colors.fourColor).toBe(colors.privateColor);
  await fourButton.evaluate((button) => button.click());
  await expect(page.locator("#fourSetupScreen")).toBeHidden();
});

test("ターン強度、隣接関係、共通敵得点を基準仕様どおり処理する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const four = window.__chibattleFour;
    const game = four.initialState(4);
    four.startPlayerTurn(game, 0);
    const student = four.createCard("general_student", 0);
    student.hasAttacked = false;
    game.players[0].board.seats[0] = student;
    game.enemy.life = 1;
    const attacked = four.attackEnemy(game, 0, student.id);
    return {
      early: four.strengthForRound(6, () => .99),
      midWeak: four.strengthForRound(7, () => .39),
      midMedium: four.strengthForRound(7, () => .4),
      lateWeak: four.strengthForRound(13, () => .19),
      lateMedium: four.strengthForRound(13, () => .2),
      lateStrong: four.strengthForRound(13, () => .5),
      adjacent01: four.adjacent(0, 1),
      adjacent03: four.adjacent(0, 3),
      opposite02: four.adjacent(0, 2),
      attacked,
      points: game.players[0].points,
      enemyLife: game.enemy.life,
      gameOver: game.gameOver
    };
  });
  expect(result).toEqual({
    early: "weak", midWeak: "weak", midMedium: "medium",
    lateWeak: "weak", lateMedium: "medium", lateStrong: "strong",
    adjacent01: true, adjacent03: true, opposite02: false,
    attacked: true, points: 11, enemyLife: 0, gameOver: true
  });
});

test("4人の行動後に共通敵の行動内容を表示してから次ターンへ進む", async ({ page }) => {
  await page.evaluate(() => {
    window.__chibattle.state.screen = "fourSetup";
    window.__chibattle.render();
    document.getElementById("fourLocalHumanCount").value = "4";
    window.__chibattleFour.startLocal();
  });
  for (let index = 0; index < 4; index += 1) await page.locator("#fourEndTurnButton").click();
  await expect(page.locator("#fourEnemyActionReveal")).toBeVisible();
  await expect(page.locator("#fourEnemyActionReveal")).toContainText("共通敵の行動");
  await expect(page.locator("#fourEnemyActionReveal")).toBeHidden({ timeout: 2500 });
  await expect(page.locator("#fourTurnBanner")).toContainText("2ターン目");
});

test("共通敵の戦意-1は最大戦意を変えず次の1ターンに反映する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const four = window.__chibattleFour;
    const game = four.initialState(4);
    game.round = 3;
    game.players[0].maxWill = 4;
    four.resolveEnemyAction(game, "willDown", () => 0);
    game.round = 4;
    four.startPlayerTurn(game, 0);
    return {
      maxWill: game.players[0].maxWill,
      will: game.players[0].will,
      penaltyUntil: game.players[0].willPenaltyUntilRound
    };
  });
  expect(result).toEqual({ maxWill: 5, will: 4, penaltyUntil: 4 });
});

test("パス、手札上限、共有校外の再利用を処理する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const four = window.__chibattleFour;
    const game = four.initialState(4);
    game.sharedDeck = [];
    game.sharedTrash = [four.createCard("general_teacher")];
    game.players[0].hand = Array.from({ length: 9 }, () => four.createCard("general_student", 0));
    const overflow = four.drawOne(game, 0);

    const passGame = four.initialState(4);
    passGame.sharedDeck = [four.createCard("general_teacher")];
    passGame.players[0].hand = [four.createCard("general_student", 0)];
    passGame.players[0].life = 18;
    passGame.activeIndex = 0;
    passGame.players[0].acted = false;
    const discardId = passGame.players[0].hand[0].id;
    const passed = four.passTurn(passGame, 0, discardId);
    return {
      overflow: overflow.overflow,
      overflowHand: game.players[0].hand.length,
      overflowTrash: game.sharedTrash.length,
      passed,
      healedLife: passGame.players[0].life,
      nextPlayer: passGame.activeIndex,
      passHand: passGame.players[0].hand.length
    };
  });
  expect(result).toEqual({
    overflow: true, overflowHand: 9, overflowTrash: 1,
    passed: true, healedLife: 19, nextPlayer: 1, passHand: 1
  });
});

test("共通敵の対象不在は再抽選せず、最大2人は重複しない", async ({ page }) => {
  const result = await page.evaluate(() => {
    const four = window.__chibattleFour;
    const empty = four.initialState(4);
    empty.players.forEach((player) => { player.board.seats = [null, null, null]; player.board.teacher = null; });
    four.resolveEnemyAction(empty, "destroyCard", () => 0);

    const game = four.initialState(4);
    const first = four.createCard("general_student", 0);
    const second = four.createCard("general_student", 1);
    const third = four.createCard("general_student", 2);
    first.currentHp = second.currentHp = third.currentHp = 5;
    game.players[0].board.seats[0] = first;
    game.players[1].board.seats[0] = second;
    game.players[2].board.seats[0] = third;
    four.resolveEnemyAction(game, "twoCards4", () => 0);
    return {
      noTargetLogged: empty.log[0].includes("破壊"),
      noFailureWord: !empty.log[0].includes("不発") && !empty.log[0].includes("対象がいません"),
      damaged: [first, second, third].filter((card) => card.currentHp === 1).length,
      untouched: [first, second, third].filter((card) => card.currentHp === 5).length
    };
  });
  expect(result).toEqual({ noTargetLogged: true, noFailureWord: true, damaged: 2, untouched: 1 });
});

test("各強度の行動抽選境界と強行動の比率を保つ", async ({ page }) => {
  const actions = await page.evaluate(() => {
    const four = window.__chibattleFour;
    const pick = (strength, category, value) => four.enemyActionDefinition(strength, category, () => value);
    return {
      weakAttack: [pick("weak", "attack", .39), pick("weak", "attack", .4), pick("weak", "attack", .8)],
      mediumDisruption: [pick("medium", "disruption", .19), pick("medium", "disruption", .2), pick("medium", "disruption", .4)],
      strongAttack: [
        pick("strong", "attack", .14), pick("strong", "attack", .15), pick("strong", "attack", .25),
        pick("strong", "attack", .3), pick("strong", "attack", .8)
      ],
      strongHeal: [pick("strong", "selfBuff", .59), pick("strong", "selfBuff", .6), pick("strong", "selfBuff", .9)]
    };
  });
  expect(actions).toEqual({
    weakAttack: ["body1", "card2", "allBody1"],
    mediumDisruption: ["willDown", "handTrash", "seatBlock"],
    strongAttack: ["body3", "destroyCard", "room3", "twoCards4", "lecture"],
    strongHeal: ["heal3", "heal5", "heal8"]
  });
});

test("ドロー不能で終了し、同点は同順位にする", async ({ page }) => {
  const result = await page.evaluate(() => {
    const four = window.__chibattleFour;
    const game = four.initialState(4);
    game.sharedDeck = [];
    game.sharedTrash = [];
    four.drawOne(game, 0);
    const drawReason = game.endReason;

    const rankingGame = four.initialState(4);
    rankingGame.players[0].points = 5;
    rankingGame.players[0].life = 15;
    rankingGame.players[1].points = 2;
    rankingGame.players[1].life = 18;
    rankingGame.players[2].points = 0;
    rankingGame.players[2].life = 10;
    rankingGame.players[3].points = 0;
    rankingGame.players[3].life = 10;
    four.finishGame(rankingGame, "test");
    return { drawGameOver: game.gameOver, drawReason, ranks: rankingGame.rankings.map((entry) => entry.rank) };
  });
  expect(result.drawGameOver).toBe(true);
  expect(result.drawReason).toContain("ドローができない");
  expect(result.ranks).toEqual([1, 1, 2, 2]);
});

test("通常のプライベートマッチ画面は引き続き使用できる", async ({ page }) => {
  await page.locator("#homeBattleButton").click();
  await page.locator("#onlinePrivateMatchButton").click();
  await expect(page.locator("#onlinePrivatePanel")).toBeVisible();
  await expect(page.locator("#onlineSubviewTitle")).toHaveText("プライベートマッチ");
});
