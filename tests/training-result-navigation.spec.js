const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function showTrainingResult(page) {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.chaosDecks = {
      "再戦確認用": { counts: { general_student: 40 } }
    };
    Object.assign(api.state.soloSelection, {
      ruleId: "chaos",
      leftController: "ai",
      playerDeckName: "再戦確認用",
      opponentDeckName: "再戦確認用",
      initiative: "random"
    });
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.state.currentSide = "player";
    api.state.gameOver = false;
    api.state.training.active = true;
    api.state.training.leftController = "ai";
    api.state.training.currentConfigKey = "chaos|ai|再戦確認用|再戦確認用";
    api.state.training.replayRemaining = 0;
    api.state.training.series = null;
    api.state.players.player.will = api.state.players.player.maxWill = 10;
    api.state.players.opponent.life = 4;
    api.attendCard(
      "player",
      api.makeBoardCard(api.createCardFromBase("general_student", "player")),
      "seat",
      0,
      { attendanceSource: api.ATTENDANCE_SOURCE.HAND }
    );
    const king = api.createCardFromBase("king_ghidorah_bed", "player");
    api.state.players.player.hand = [king];
    api.resolveKingGhidorahBed("player", king, "3", null, null, true);
  });
  await expect(page.locator("#resultOverlay")).toBeVisible();
  expect(await page.evaluate(() => {
    const match = window.__chibattle.state.training.series.matches[0];
    return {
      lifeDamage: match.lifeDamage.player,
      totalDamage: match.totalDamage.player,
      attendance: match.attendance.player,
      finalBoard: match.finalBoard.player
    };
  })).toEqual({ lifeDamage: 4, totalDamage: 4, attendance: 1, finalBoard: 1 });
}

test("リザルトのデータを閉じるとリザルトに戻る", async ({ page }) => {
  await showTrainingResult(page);

  await page.locator("[data-result-training-data]").click();
  await expect(page.locator("#soloTrainingDataOverlay")).toBeVisible();
  await expect(page.locator("#resultOverlay")).toBeVisible();
  expect(await page.evaluate(() => window.__chibattle.state.screen)).toBe("battle");

  await page.locator("#soloTrainingDataCloseButton").click();
  await expect(page.locator("#soloTrainingDataOverlay")).toBeHidden();
  await expect(page.locator("#resultOverlay")).toBeVisible();
  expect(await page.evaluate(() => ({
    screen: window.__chibattle.state.screen,
    trainingActive: window.__chibattle.state.training.active
  }))).toEqual({ screen: "battle", trainingActive: true });
});

test("リザルトの再戦設定をその場で開き、指定回数で開始できる", async ({ page }) => {
  await showTrainingResult(page);

  await page.locator("[data-result-training-replay]").click();
  await expect(page.locator("#soloTrainingReplayOverlay")).toBeVisible();
  await expect(page.locator("#resultOverlay")).toBeVisible();
  expect(await page.evaluate(() => window.__chibattle.state.screen)).toBe("battle");

  await page.locator("#soloTrainingReplayCount").fill("3");
  await page.locator("#soloTrainingReplayForm button[type=submit]").click();
  await expect(page.locator("#soloTrainingReplayOverlay")).toBeHidden();
  await expect(page.locator("#resultOverlay")).toBeHidden();
  expect(await page.evaluate(() => ({
    screen: window.__chibattle.state.screen,
    replayTotal: window.__chibattle.state.training.replayTotal,
    replayRemaining: window.__chibattle.state.training.replayRemaining,
    trainingActive: window.__chibattle.state.training.active
  }))).toEqual({
    screen: "battle",
    replayTotal: 3,
    replayRemaining: 2,
    trainingActive: true
  });
});

test("対戦データを左右別の勝率とカード別マリガン確率で表示する", async ({ page }) => {
  await showTrainingResult(page);
  await page.evaluate(() => {
    const state = window.__chibattle.state;
    const base = state.training.series.matches[0];
    const card = (cardId, cardName) => ({ cardId, cardName });
    const leftMulligans = [
      {
        initialCards: [card("general_student", "一般学生"), card("general_student", "一般学生"), card("trpg_member", "TRPGサークルメンバー")],
        returnedCards: [card("trpg_member", "TRPGサークルメンバー")],
        finalCards: [card("general_student", "一般学生"), card("general_student", "一般学生"), card("yocchan", "よっちゃん")]
      },
      {
        initialCards: [card("general_student", "一般学生"), card("yocchan", "よっちゃん")],
        returnedCards: [card("general_student", "一般学生")],
        finalCards: [card("yocchan", "よっちゃん"), card("trpg_member", "TRPGサークルメンバー")]
      },
      {
        initialCards: [card("trpg_member", "TRPGサークルメンバー"), card("yocchan", "よっちゃん")],
        returnedCards: [],
        finalCards: [card("trpg_member", "TRPGサークルメンバー"), card("yocchan", "よっちゃん")]
      },
      {
        initialCards: [card("general_student", "一般学生"), card("trpg_member", "TRPGサークルメンバー")],
        returnedCards: [card("trpg_member", "TRPGサークルメンバー")],
        finalCards: [card("general_student", "一般学生"), card("yocchan", "よっちゃん")]
      }
    ];
    state.training.series.matches = [
      { ...base, winner: "player", firstSide: "player" },
      { ...base, winner: "opponent", firstSide: "opponent" },
      { ...base, winner: "player", firstSide: "opponent" },
      { ...base, winner: "opponent", firstSide: "player" }
    ].map((match, index) => ({
      ...match,
      life: { player: 12 - index, opponent: 8 + index },
      lifeDamage: { player: 12 + index, opponent: 8 + index },
      attendeeDamage: { player: 6 + index, opponent: 4 + index },
      totalDamage: { player: 18 + (index * 2), opponent: 12 + (index * 2) },
      damageTaken: { player: 12 + (index * 2), opponent: 18 + (index * 2) },
      lifeHealing: { player: 2, opponent: 1 },
      attendeeHealing: { player: 3, opponent: 1 },
      totalHealing: { player: 5, opponent: 2 },
      played: { player: 7, opponent: 6 },
      attendance: { player: 10, opponent: 8 },
      finalBoard: { player: 4, opponent: 2 },
      boardDepartures: { player: 6, opponent: 6 },
      attacks: { player: 8, opponent: 5 },
      lifeAttacks: { player: 2, opponent: 1 },
      attendeeAttacks: { player: 6, opponent: 4 },
      draws: { player: 8, opponent: 7 },
      maxHand: { player: 7, opponent: 6 },
      maxBoard: { player: 8, opponent: 6 },
      unusedWill: { player: 1, opponent: 2 },
      mulligan: {
        player: leftMulligans[index],
        opponent: {
          initialCards: [card("aggro_student", "アグロ大学生")],
          returnedCards: index % 2 ? [card("aggro_student", "アグロ大学生")] : [],
          finalCards: [card("aggro_student", "アグロ大学生")]
        }
      }
    }));
  });

  await page.locator("[data-result-training-data]").click();
  await expect(page.locator(".training-player-data.player")).toContainText("左プレイヤー");
  await expect(page.locator(".training-player-data.opponent")).toContainText("右プレイヤー");
  await expect(page.locator(".training-player-data.player")).toContainText("先攻時勝率");
  await expect(page.locator(".training-player-data.player")).toContainText("後攻時勝率");
  await expect(page.locator(".training-player-data.player")).toContainText("平均総ダメージ");
  await expect(page.locator(".training-player-data.player")).toContainText("平均総回復量");
  await expect(page.locator(".training-player-data.player")).toContainText("平均盤面離脱数");
  await expect(page.locator(".training-player-data.player .training-rate-card", { hasText: "盤面残存率" })).toContainText("40%");
  await expect(page.locator(".training-player-data.player .training-rate-card", { hasText: "本体攻撃率" })).toContainText("25%");
  await expect(page.locator(".training-player-data.opponent .training-rate-card", { hasText: "盤面残存率" })).toContainText("25%");
  const generalStudentRow = page.locator(".training-player-data.player .training-mulligan-table tbody tr", { hasText: "一般学生" });
  await expect(generalStudentRow).toContainText("75%");
  await expect(generalStudentRow).toContainText("25%");
  await expect(generalStudentRow).toContainText("50%");
  await expect(page.locator(".training-player-data.opponent .training-mulligan-table")).toContainText("アグロ大学生");
});

test("BATTLEボタンから準備完了時の「開始」表示を削除する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.deckBuilder.chaosDecks = {
      "BATTLE表示確認用": { counts: { general_student: 40 } }
    };
    api.startSoloBattleFromHome();
  });
  await expect(page.locator(".training-avatar-note")).toHaveCount(0);
  await expect(page.locator(".training-avatar")).toHaveCount(2);
  await expect(page.locator(".training-avatar[aria-label]")).toHaveCount(0);
  await page.selectOption("#soloRuleSelect", "chaos");
  await page.locator("#soloPlayerSlot").click();
  await page.locator("#soloDeckGrid .deck-library-card", { hasText: "BATTLE表示確認用" }).click();
  await page.locator("#soloAiSlot").click();
  await page.locator("#soloDeckGrid .deck-library-card", { hasText: "BATTLE表示確認用" }).click();
  await expect(page.locator("#soloBattleStartButton")).toBeEnabled();
  await expect(page.locator("#soloBattleStartButton")).toContainText("BATTLE!");
  await expect(page.locator("#soloBattleStartButton")).not.toContainText("開始");
});
